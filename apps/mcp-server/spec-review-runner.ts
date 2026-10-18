import {DomainError, requireCondition} from "../../packages/core/errors.ts";
import type {Project} from "../../packages/shared-types/domain.ts";
import {buildReviewBundle, validateReviewBundle, validateReviewResponse, reviewPolicyFingerprint} from "../../packages/core/spec-review-service.ts";
import type {ReviewBundle, SpecReviewStatus} from "../../packages/core/spec-review-service.ts";
import {SqliteSpecReviewStore} from "../../packages/storage/spec-review-store.ts";
import type {StoredSpecReview} from "../../packages/storage/spec-review-store.ts";
import {fingerprint} from "../../packages/core/validation.ts";

// Test injection is an internal dependency, not a CLI/env/MCP option. No live
// provider, credentials, protocol or arbitrary executable is selected in phase 1.
export type SyntheticSpecReviewer = {execution_kind: "TEST_ONLY";
  execute: (input: {material: string; bundle_sha256: string; signal: AbortSignal}) => Promise<unknown>};
export class SpecReviewRunner {
  private active = new Map<string, {binding: string; result: Promise<SpecReviewStatus>}>();
  private store?: SqliteSpecReviewStore;
  private synthetic?: SyntheticSpecReviewer;
  constructor(store?: SqliteSpecReviewStore, synthetic?: SyntheticSpecReviewer) {this.store = store; this.synthetic = synthetic;}
  get testConfigured() {return !!this.store && this.synthetic?.execution_kind === "TEST_ONLY";}
  unavailable(project: Project): SpecReviewStatus {
    return {schema_version: "XMI-SPEC-REVIEW/2", project_id: project.project_id, model_version: project.model_version,
      run_id: null, availability: "UNAVAILABLE", state: "UNAVAILABLE", gate_eligible: false, independent_review_status: "UNAVAILABLE",
      reviewed_model_version: null, bundle_sha256: null, findings: [], total_findings: 0, next_offset: null,
      coverage: {required_items: 0, covered_items: 0, required_documents: 0, covered_documents: 0, complete: false, scopes: []},
      reason: "阶段一尚未配置真实评审；未保存材料、未外发、未调用模型。服务、协议、凭据及调用授权需在第二阶段确定。"};
  }
  status(project: Project, runId?: string, offset = 0, limit = 20): SpecReviewStatus {
    if (!this.store) return this.unavailable(project);
    const base = {...this.unavailable(project), availability: "TEST_ONLY" as const, state: "NONE" as SpecReviewStatus["state"], reason: "仅合成记录；不能满足真实审核门槛。"};
    if (!runId) return base;
    try {
      const stored = this.store.get(project.project_id, runId);
      requireCondition(stored, "SPEC_REVIEW_RUN_NOT_FOUND");
      const {bundle, run} = stored;
      requireCondition(run.execution_kind === "TEST_ONLY", "SPEC_REVIEW_WRONG_EXECUTION_KIND");
      const result = {...base, run_id: run.run_id, reviewed_model_version: run.product_model_version, bundle_sha256: bundle.bundle_sha256};
      if (bundle.product_model_version !== project.model_version || bundle.policy_sha256 !== reviewPolicyFingerprint())
        return {...result, state: "STALE", reason: "冻结版本或评审规则已变化；原记录不适用于当前项目。"};
      validateReviewBundle(bundle, project);
      const response = run.response?.schema_version === "XMI-REVIEW-RESPONSE/1" ? run.response : null;
      requireCondition(!run.response || response, "SPEC_REVIEW_WRONG_RESPONSE_KIND");
      const findings = response?.findings ?? [];
      return {...result, state: run.state === "RUNNING" && ![...this.active.values()].some(v => v.binding === bundle.bundle_sha256) ? "UNKNOWN" : run.state,
        findings: findings.slice(offset, offset + limit), total_findings: findings.length,
        coverage: {required_items: bundle.required_ids.length, covered_items: response?.covered_ids.length ?? 0,
          required_documents: bundle.candidate.files.length, covered_documents: response?.covered_files.length ?? 0,
          complete: !!response, scopes: bundle.scope_requirements.map(scope => ({id: scope.id, required_items: scope.scope_ids.length,
            covered_items: response ? scope.scope_ids.length : 0, scope_ids_sha256: fingerprint(scope.scope_ids),
            minimum_mode: scope.minimum_mode, resolution: scope.resolution}))},
        next_offset: offset + limit < findings.length ? offset + limit : null,
        reason: "TEST_ONLY：合成结果不证明真实执行、来源或有效隔离，也不能批准产品或导出。"};
    } catch (error) {
      if (error instanceof DomainError && error.code === "SPEC_REVIEW_RUN_NOT_FOUND") throw error;
      if (error instanceof DomainError && error.code === "SPEC_REVIEW_STALE") return {...base, run_id: runId, state: "STALE", reason: "受审产品内容已变化；需要冻结新版本，不能复用旧记录。"};
      return {...base, run_id: runId, state: "UNVERIFIED", reason: "评审记录完整性、内容绑定或覆盖无法核验；真实门槛保持不可用。"};
    }
  }
  start(project: Project, key: string, signal: AbortSignal, readCurrent: () => Project,
    approve: (bundle: ReviewBundle) => Promise<void>): Promise<SpecReviewStatus> {
    if (!this.testConfigured) return Promise.resolve(this.unavailable(project));
    const bundle = buildReviewBundle(project), request = `${project.project_id}:${key}`;
    const active = this.active.get(request);
    if (active) {requireCondition(active.binding === bundle.bundle_sha256, "IDEMPOTENCY_KEY_REUSED"); return active.result;}
    // Defer execution until the request has been registered in the in-process map.
    const result = Promise.resolve().then(() => this.execute(bundle, key, signal, readCurrent, approve)).finally(() => this.active.delete(request));
    this.active.set(request, {binding: bundle.bundle_sha256, result});
    return result;
  }
  private async execute(bundle: ReviewBundle, key: string, signal: AbortSignal, readCurrent: () => Project,
    approve: (bundle: ReviewBundle) => Promise<void>): Promise<SpecReviewStatus> {
    const current = () => {requireCondition(!signal.aborted, "REQUEST_CANCELLED"); return validateReviewBundle(bundle, readCurrent());};
    current();
    let stored = this.store!.find(bundle.project_id, key);
    if (stored) {
      requireCondition(stored.bundle.bundle_sha256 === bundle.bundle_sha256, "IDEMPOTENCY_KEY_REUSED");
      if (stored.run.state === "RUNNING") stored = this.store!.append(stored, {state: "UNKNOWN", response: null, reason: "INTERRUPTED_RESULT_UNKNOWN_NO_RETRY"});
      if (stored.run.state !== "PREPARED") return this.status(readCurrent(), stored.run.run_id);
    } else {
      await approve(bundle); current();
      stored = this.store!.prepare(bundle, key);
    }
    stored = this.store!.append(stored, {state: "RUNNING", response: null, reason: "SYNTHETIC_EXECUTION_ONLY"});
    let next: Parameters<SqliteSpecReviewStore["append"]>[1];
    try {
      // Only immutable material strings cross this boundary, not a store, service,
      // filesystem path, tool registry, authentication value or mutation callback.
      const response = await new Promise<unknown>((resolve, reject) => {
        const cancel = () => {signal.removeEventListener("abort", cancel); reject(new DomainError("REQUEST_CANCELLED"));};
        signal.addEventListener("abort", cancel, {once: true});
        if (signal.aborted) {cancel(); return;}
        Promise.resolve().then(() => {
          requireCondition(!signal.aborted, "REQUEST_CANCELLED");
          return this.synthetic!.execute({material: bundle.material, bundle_sha256: bundle.bundle_sha256, signal});
        }).then(value => {signal.removeEventListener("abort", cancel); resolve(value);}, error => {
          signal.removeEventListener("abort", cancel); reject(error);
        });
      });
      current(); const parsed = validateReviewResponse(bundle, response);
      next = {state: parsed.unresolved_ids.length || parsed.findings.some(f => f.severity === "BLOCKING") ? "BLOCKING" : "COMPLETED",
        response: parsed, reason: "SYNTHETIC_RESULT_NOT_GATE_EVIDENCE"};
    } catch (error) {
      next = {state: signal.aborted ? "INTERRUPTED" : error instanceof DomainError ? "INCOMPLETE" : "UNKNOWN",
        response: null, reason: error instanceof DomainError ? error.code : "RESULT_UNKNOWN_NO_AUTOMATIC_RETRY"};
    }
    stored = this.store!.append(stored as StoredSpecReview, next);
    return this.status(readCurrent(), stored.run.run_id);
  }
}
