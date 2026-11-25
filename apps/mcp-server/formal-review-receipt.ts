import {createHmac, randomBytes, randomUUID, timingSafeEqual} from "node:crypto";
import {existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import type {Project} from "../../packages/shared-types/domain.ts";
import {canonical, fingerprint} from "../../packages/core/validation.ts";
import {requireCondition} from "../../packages/core/errors.ts";
import {buildReviewBundle, specReviewResponseSchema, validateReviewBundle, validateReviewResponse} from "../../packages/core/spec-review-service.ts";
import type {ReviewBundle, ReviewHistorySource} from "../../packages/core/spec-review-service.ts";
import {previousFormalBundles} from "./prior-formal-policy.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const bindingSchema = z.strictObject({
  run_id: z.uuid(), nonce: hash, project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u),
  model_version: z.number().int().positive(), snapshot_sha256: hash, bundle_sha256: hash, material_sha256: hash,
  candidate_sha256: hash, policy_sha256: hash,
});
export type FormalReviewBinding = z.infer<typeof bindingSchema>;
export function formalReviewBinding(bundle: ReviewBundle): FormalReviewBinding {
  return bindingSchema.parse({run_id: randomUUID(), nonce: randomBytes(32).toString("hex"), project_id: bundle.project_id,
    model_version: bundle.product_model_version, snapshot_sha256: bundle.model_sha256, bundle_sha256: bundle.bundle_sha256,
    material_sha256: bundle.material_sha256, candidate_sha256: bundle.candidate_sha256, policy_sha256: bundle.policy_sha256});
}

const receiptSchema = z.strictObject({
  schema_version: z.literal("XMI-WINDOWS-FORMAL-SPEC-REVIEW/1"),
  binding: bindingSchema, completed_at: z.iso.datetime(), executable_sha256: hash,
  isolation: z.strictObject({kind: z.literal("WINDOWS_APPCONTAINER_AND_TOOL_FREE_HOST"), evidence_sha256: hash}),
  native: z.strictObject({thread_id: z.string().min(1), turn_id: z.string().min(1), message_id: z.string().min(1),
    model: z.string().min(1), response_sha256: hash}),
  response: specReviewResponseSchema,
});
export type FormalReviewReceipt = z.infer<typeof receiptSchema>;
const envelopeSchema = z.strictObject({receipt: receiptSchema, mac: hash});

function checkedReceipt(value: unknown, bundle: ReviewBundle): FormalReviewReceipt {
  const receipt = receiptSchema.parse(value);
  const subject = {...formalReviewBinding(bundle), run_id: receipt.binding.run_id, nonce: receipt.binding.nonce};
  requireCondition(canonical(receipt.binding) === canonical(subject), "FORMAL_REVIEW_RECEIPT_BINDING");
  validateReviewResponse(bundle, receipt.response);
  return receipt;
}

function publishOnce(path: string, value: string | Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, value, {flag: "wx", mode: 0o600, flush: true});
  try {linkSync(temporary, path);}
  finally {unlinkSync(temporary);}
}

/** Local trusted broker storage. There is no MCP tool for submitting receipts or proof flags. */
export class FormalReviewReceipts {
  private readonly directory: string;
  constructor(directory: string) {this.directory = directory;}
  private snapshotPath(project: Project) {
    return join(this.directory, fingerprint({project: project.project_id, snapshot: fingerprint(project)}));
  }
  private path(project: Project, bundle: ReviewBundle, history?: ReviewHistorySource) {
    const snapshot = this.snapshotPath(project);
    return history ? join(snapshot, `${bundle.bundle_sha256}.json`) : snapshot + ".json";
  }
  private key(create = false) {
    const path = join(this.directory, "receipt.key");
    if (create) {
      mkdirSync(this.directory, {recursive: true});
      try {publishOnce(path, randomBytes(32));}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
    }
    requireCondition(lstatSync(path).isFile(), "FORMAL_REVIEW_KEY_INVALID");
    const key = readFileSync(path);
    requireCondition(key.length === 32, "FORMAL_REVIEW_KEY_INVALID");
    return key;
  }
  private authenticated(path: string): FormalReviewReceipt | null {
    try {
      const stat = lstatSync(path);
      requireCondition(stat.isFile() && stat.size <= 512 * 1024, "FORMAL_REVIEW_RECEIPT_INVALID");
      const signed = envelopeSchema.parse(JSON.parse(readFileSync(path, "utf8")));
      const authenticated = createHmac("sha256", this.key()).update(canonical(signed.receipt)).digest();
      requireCondition(timingSafeEqual(authenticated, Buffer.from(signed.mac, "hex")), "FORMAL_REVIEW_RECEIPT_SIGNATURE");
      return signed.receipt;
    } catch {return null;}
  }
  private exact(project: Project, bundle: ReviewBundle, history?: ReviewHistorySource): FormalReviewReceipt | null {
    const receipt = this.authenticated(this.path(project, bundle, history));
    try {return receipt ? checkedReceipt(receipt, bundle) : null;} catch {return null;}
  }
  read(project: Project, history?: ReviewHistorySource): FormalReviewReceipt | null {
    const snapshot = this.snapshotPath(project);
    try {
      if (!existsSync(history ? snapshot : snapshot + ".json")) return null;
      const bundle = buildReviewBundle(project, undefined, history);
      return this.exact(project, bundle, history) ?? (() => {
        if (history) for (const previous of previousFormalBundles(bundle)) {
          const receipt = this.exact(project, previous, history);
          if (receipt) return receipt;
        }
        return null;
      })();
    } catch {return null;}
  }
  previousForSnapshot(project: Project, bundle: ReviewBundle): FormalReviewReceipt | null {
    const snapshot = this.snapshotPath(project);
    const files = [snapshot + ".json"];
    if (existsSync(snapshot) && lstatSync(snapshot).isDirectory()) {
      files.push(...readdirSync(snapshot).filter(name => /^[a-f0-9]{64}\.json$/u.test(name)).map(name => join(snapshot, name)));
    }
    const sameSnapshot = files.map(path => this.authenticated(path)).filter((receipt): receipt is FormalReviewReceipt => !!receipt &&
      receipt.binding.project_id === bundle.project_id && receipt.binding.model_version === bundle.product_model_version &&
      receipt.binding.snapshot_sha256 === bundle.model_sha256 && receipt.binding.bundle_sha256 !== bundle.bundle_sha256);
    return sameSnapshot.sort((a, b) => b.completed_at.localeCompare(a.completed_at))[0] ?? null;
  }
  prepare(project: Project, history: ReviewHistorySource) {
    let bundle = buildReviewBundle(project, undefined, history);
    let receipt = this.exact(project, bundle, history);
    if (!receipt) {
      for (const previousBundle of previousFormalBundles(bundle)) {
        const previousReceipt = this.exact(project, previousBundle, history);
        if (previousReceipt) {
          bundle = previousBundle;
          receipt = previousReceipt;
          break;
        }
      }
    }
    const previous = receipt ? null : this.previousForSnapshot(project, bundle);
    const manifest = JSON.parse(bundle.candidate.files.find(file => file.path === "manifest.json")!.content);
    const proof = manifest.producer_evidence as {
      source_coverage: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
      item_confirmations: {item_id: string; event: object | null}[];
      mode_selection: {event: object | null};
      scope_dispositions: {event: object | null}[];
    };
    const previousUnresolved = new Set(previous?.response.unresolved_ids ?? []);
    const recovered = proof.item_confirmations.filter(row => previousUnresolved.has(row.item_id) && row.event);
    const recovery = {
      source_coverage: proof.source_coverage,
      verified_item_count: proof.item_confirmations.filter(row => row.event).length,
      mode_verified: proof.mode_selection.event !== null,
      verified_scope_count: proof.scope_dispositions.filter(row => row.event).length,
      previous_run_id: previous?.binding.run_id ?? null,
      recovered_confirmation_count: recovered.length,
      previous_unresolved_count: previousUnresolved.size,
      needs_formal_review: !receipt,
    };
    return {bundle, receipt, recovery};
  }
  hasRecord(project: Project): boolean {
    const snapshot = this.snapshotPath(project);
    return existsSync(snapshot) || existsSync(snapshot + ".json");
  }
  publish(value: unknown, bundle: ReviewBundle, readCurrent: () => Project, history?: ReviewHistorySource): FormalReviewReceipt {
    const project = readCurrent();
    validateReviewBundle(bundle, project, history);
    const receipt = checkedReceipt(value, bundle), path = this.path(project, bundle, history);
    const mac = createHmac("sha256", this.key(true)).update(canonical(receipt)).digest("hex");
    if (history) mkdirSync(this.snapshotPath(project), {recursive: true});
    try {publishOnce(path, canonical({receipt, mac}));}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      requireCondition(canonical(this.exact(project, bundle, history)) === canonical(receipt), "FORMAL_REVIEW_RECEIPT_EXISTS");
    }
    return receipt;
  }
}
