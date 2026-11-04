import {createHash, randomBytes, randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {agentPlatform, accessView, bindingView, projectId, orderView} from "./contracts.ts";
const keySchema = z.string().regex(/^XMIK-[A-Za-z0-9_-]{43}$/);
const orderRequest = z.strictObject({market: z.enum(["domestic", "overseas"]), idempotency_key: z.string().min(1).max(100)});
const paymentReceipt = z.strictObject({
  order_id: z.uuid(), provider: z.string().min(1).max(80), transaction_id: z.string().min(1).max(200),
  amount: z.number().int().positive(), currency: z.enum(["CNY", "USD"]), status: z.literal("SUCCEEDED"),
});
export class AccessError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {super(code); this.code = code; this.status = status;}
}
function check(value: unknown, code: string, status = 409): asserts value {
  if (!value) throw new AccessError(code, status);
}
function keyHash(key: string) {
  check(keySchema.safeParse(key).success, "PROJECT_KEY_INVALID", 401);
  return createHash("sha256").update(key).digest("hex");
}

/** Separate cloud entitlement data. Never opens or migrates a Product Model database. */
export class ProjectAccessStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
    const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
    check([0, 301, 302].includes(version), "ACCESS_DATABASE_VERSION_UNSUPPORTED", 400);
    // A fresh, dedicated database is required. Refuse accidental use of the local product database.
    const names = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (names.some(row => !["access_projects", "access_orders", "access_bindings", "access_trial", "access_analysis", "access_grants"].includes(String(row.name)))) {
      throw new AccessError("ACCESS_DATABASE_NOT_DEDICATED", 400);
    }
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS access_projects (
        key_hash TEXT PRIMARY KEY, agent_platform TEXT NOT NULL, created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('TRIAL','PAYMENT_REQUIRED','PAID')));
      CREATE TABLE IF NOT EXISTS access_orders (
        order_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL REFERENCES access_projects(key_hash),
        idempotency_key TEXT NOT NULL, currency TEXT NOT NULL CHECK(currency IN ('CNY','USD')),
        amount INTEGER NOT NULL CHECK(amount=500), status TEXT NOT NULL CHECK(status IN ('PENDING','PAID')),
        provider TEXT, transaction_id TEXT, UNIQUE(key_hash,idempotency_key), UNIQUE(provider,transaction_id));
      CREATE TABLE IF NOT EXISTS access_bindings (
        key_hash TEXT PRIMARY KEY REFERENCES access_projects(key_hash), project_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS access_trial (
        key_hash TEXT PRIMARY KEY REFERENCES access_projects(key_hash), module_hash TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0 CHECK(used BETWEEN 0 AND 2));
      CREATE TABLE IF NOT EXISTS access_analysis (
        key_hash TEXT NOT NULL REFERENCES access_projects(key_hash), request_hash TEXT NOT NULL,
        PRIMARY KEY(key_hash,request_hash));
      CREATE TABLE IF NOT EXISTS access_grants (
        key_hash TEXT NOT NULL REFERENCES access_projects(key_hash), candidate_hash TEXT NOT NULL,
        PRIMARY KEY(key_hash,candidate_hash)); PRAGMA user_version=302; COMMIT;`);
    } catch (error) {if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.db.close(); throw error;}
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {const result = work(); this.db.exec("COMMIT"); return result;}
    catch (error) {this.db.exec("ROLLBACK"); throw error;}
  }
  private project(key: string) {
    const hash = keyHash(key), row = this.db.prepare("SELECT * FROM access_projects WHERE key_hash=?").get(hash);
    check(row, "PROJECT_KEY_INVALID", 401); return {hash, row};
  }
  issue(platform: unknown) {
    const selected = agentPlatform.parse(platform), key = "XMIK-" + randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO access_projects(key_hash,agent_platform,created_at,status) VALUES(?,?,?,'TRIAL')")
      .run(keyHash(key), selected, new Date().toISOString());
    return {project_key: key, ...this.status(key)};
  }
  status(key: string) {
    const {row} = this.project(key);
    return accessView.parse({status: row.status, agent_platform: row.agent_platform, created_at: row.created_at});
  }
  binding(key: string) {
    const {hash} = this.project(key);
    const trial = this.db.prepare("SELECT used FROM access_trial WHERE key_hash=?").get(hash), used = Number(trial?.used ?? 0);
    return bindingView.parse({...this.status(key), project_id:
      this.db.prepare("SELECT project_id FROM access_bindings WHERE key_hash=?").get(hash)?.project_id ?? null,
      trial: {module_confirmed: !!trial, grace_used: used, grace_remaining: 2 - used}});
  }
  /** Bind only after the cloud evaluator has validated the supplied project history. */
  bind(key: string, id: string) {
    projectId.parse(id);
    return this.transaction(() => {
      const {hash} = this.project(key), binding = this.binding(key);
      check(!binding.project_id || binding.project_id === id, "PROJECT_KEY_PROJECT_MISMATCH");
      const other = this.db.prepare("SELECT key_hash FROM access_bindings WHERE project_id=?").get(id);
      check(!other || other.key_hash === hash, "PROJECT_ALREADY_BOUND_TO_OTHER_KEY");
      if (!binding.project_id) this.db.prepare("INSERT INTO access_bindings VALUES(?,?)").run(hash, id);
      return this.binding(key);
    });
  }
  authorize(key: string, id: string, delivery = false) {
    const binding = this.binding(key);
    check(binding.project_id === id, "PROJECT_KEY_PROJECT_MISMATCH");
    check(binding.status !== "PAYMENT_REQUIRED" && (!delivery || binding.status === "PAID"), "PAYMENT_REQUIRED", 402);
    return binding;
  }
  authorizeLocalWrite(key: string, id: string, candidateHash?: string) {
    const {hash} = this.project(key), binding = this.binding(key);
    check(binding.project_id === id, "PROJECT_KEY_PROJECT_MISMATCH");
    if (binding.status === "PAYMENT_REQUIRED") {
      check(candidateHash && /^[a-f0-9]{64}$/.test(candidateHash) &&
        this.db.prepare("SELECT 1 FROM access_grants WHERE key_hash=? AND candidate_hash=?").get(hash, candidateHash), "PAYMENT_REQUIRED", 402);
    }
  }
  /** Store only a module digest and usage count, not module text or analysis results. */
  observeModule(key: string, moduleHash: string) {
    check(/^[a-f0-9]{64}$/.test(moduleHash), "HYBRID_MODEL_INVALID", 400);
    const {hash} = this.project(key);
    this.db.prepare("INSERT OR IGNORE INTO access_trial(key_hash,module_hash) VALUES(?,?)").run(hash, moduleHash);
  }
  analysisAllowed(key: string, requestHash: string) {
    const {hash, row} = this.project(key);
    const receipt = this.db.prepare("SELECT 1 FROM access_analysis WHERE key_hash=? AND request_hash=?").get(hash, requestHash);
    check(row.status !== "PAYMENT_REQUIRED" || receipt, "PAYMENT_REQUIRED", 402);
  }
  recordAnalysis(key: string, requestHash: string, candidateHashes: string[]) {
    check(/^[a-f0-9]{64}$/.test(requestHash), "HYBRID_MODEL_INVALID", 400);
    return this.transaction(() => {
      const {hash, row} = this.project(key);
      const prior = this.db.prepare("SELECT 1 FROM access_analysis WHERE key_hash=? AND request_hash=?").get(hash, requestHash);
      const grant = () => {for (const candidate of candidateHashes) {
        check(/^[a-f0-9]{64}$/.test(candidate), "HYBRID_MODEL_INVALID", 400);
        this.db.prepare("INSERT OR IGNORE INTO access_grants VALUES(?,?)").run(hash, candidate);
      }};
      if (prior) {grant(); return;}
      if (row.status === "PAID") return;
      this.analysisAllowed(key, requestHash);
      this.db.prepare("INSERT INTO access_analysis VALUES(?,?)").run(hash, requestHash);
      grant();
      const trial = this.db.prepare("SELECT used FROM access_trial WHERE key_hash=?").get(hash);
      if (trial) {
        const used = Number(trial.used) + 1;
        check(used <= 2, "PAYMENT_REQUIRED", 402);
        this.db.prepare("UPDATE access_trial SET used=? WHERE key_hash=?").run(used, hash);
        if (used === 2) this.db.prepare("UPDATE access_projects SET status='PAYMENT_REQUIRED' WHERE key_hash=? AND status='TRIAL'").run(hash);
      }
    });
  }
  /** Called by a future trusted server-side trial meter, never exposed as an MCP tool. */
  requirePayment(key: string) {
    const {hash} = this.project(key);
    this.db.prepare("UPDATE access_projects SET status='PAYMENT_REQUIRED' WHERE key_hash=? AND status='TRIAL'").run(hash);
    return this.status(key);
  }
  createOrder(key: string, raw: unknown) {
    const request = orderRequest.parse(raw), currency = request.market === "domestic" ? "CNY" : "USD";
    return this.transaction(() => {
      const {hash, row} = this.project(key);
      const existing = this.db.prepare("SELECT * FROM access_orders WHERE key_hash=? AND idempotency_key=?")
        .get(hash, request.idempotency_key);
      if (existing) {check(existing.currency === currency, "ORDER_IDEMPOTENCY_CONFLICT"); return this.order(existing);}
      check(row.status !== "PAID", "PROJECT_ALREADY_PAID");
      // Reuse an outstanding order rather than multiplying checkouts for the same project/currency.
      const pending = this.db.prepare("SELECT * FROM access_orders WHERE key_hash=? AND currency=? AND status='PENDING'").get(hash, currency);
      check(!pending, "PROJECT_ORDER_PENDING");
      const id = randomUUID();
      this.db.prepare("INSERT INTO access_orders(order_id,key_hash,idempotency_key,currency,amount,status) VALUES(?,?,?,?,500,'PENDING')")
        .run(id, hash, request.idempotency_key, currency);
      return this.order(this.db.prepare("SELECT * FROM access_orders WHERE order_id=?").get(id)!);
    });
  }
  private order(row: Record<string, unknown>) {
    return orderView.parse({order_id: row.order_id, currency: row.currency, amount: row.amount, status: row.status});
  }
  /**
   * INTERNAL ONLY: a payment adapter must authenticate/query the actual provider first.
   * This validates business matching, NOT provider authenticity. No HTTP/MCP settlement endpoint exists.
   */
  settleVerifiedOrder(raw: unknown) {
    const receipt = paymentReceipt.parse(raw);
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM access_orders WHERE order_id=?").get(receipt.order_id);
      check(row, "ORDER_NOT_FOUND", 404);
      check(row.amount === receipt.amount && row.currency === receipt.currency, "PAYMENT_ORDER_MISMATCH");
      if (row.status === "PAID") {
        check(row.provider === receipt.provider && row.transaction_id === receipt.transaction_id, "PAYMENT_RECEIPT_CONFLICT");
        return this.order(row);
      }
      const used = this.db.prepare("SELECT order_id FROM access_orders WHERE provider=? AND transaction_id=?")
        .get(receipt.provider, receipt.transaction_id);
      check(!used, "PAYMENT_TRANSACTION_REUSED");
      check(this.db.prepare("SELECT status FROM access_projects WHERE key_hash=?").get(row.key_hash!)?.status !== "PAID", "PROJECT_ALREADY_PAID");
      this.db.prepare("UPDATE access_orders SET status='PAID',provider=?,transaction_id=? WHERE order_id=?")
        .run(receipt.provider, receipt.transaction_id, receipt.order_id);
      this.db.prepare("UPDATE access_projects SET status='PAID' WHERE key_hash=?").run(row.key_hash!);
      return this.order(this.db.prepare("SELECT * FROM access_orders WHERE order_id=?").get(receipt.order_id)!);
    });
  }
  close() {this.db.close();}
}
