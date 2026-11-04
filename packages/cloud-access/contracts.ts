import {z} from "zod";

export const agentPlatform = z.enum(["codex", "workbuddy", "claude-code", "other"]);
export const accessView = z.strictObject({
  status: z.enum(["TRIAL", "PAYMENT_REQUIRED", "PAID"]),
  agent_platform: agentPlatform, created_at: z.string(),
});
export const projectId = z.string().regex(/^XMI-[A-Z0-9-]+$/).max(100);
export const bindingView = accessView.extend({project_id: projectId.nullable(), trial: z.strictObject({
  module_confirmed: z.boolean(), grace_used: z.number().int().min(0).max(2), grace_remaining: z.number().int().min(0).max(2),
})});
// Only these derived computations leave the connector. Owner actions and filesystem tools never do.
export const remoteOperations = ["xmi_project_resume", "xmi_answer_analyze", "xmi_delivery_mode_recommend",
  "xmi_mode_risk_evaluate", "xmi_mode_gap_analyze"] as const;
export const hybridRequest = z.strictObject({
  operation: z.enum(["CHECK_LOCAL_WRITE", "CHECK_DELIVERY", ...remoteOperations]),
  project_id: projectId, expected_version: z.number().int().positive(),
  history: z.array(z.unknown()).min(1).max(10000),
  arguments: z.record(z.string(), z.unknown()),
});
export const hybridResponse = z.strictObject({
  project_id: projectId, model_version: z.number().int().positive(),
  state_sha256: z.string().regex(/^[a-f0-9]{64}$/), result: z.record(z.string(), z.unknown()),
});
export const hybridError = z.strictObject({code: z.enum(["PAYMENT_REQUIRED", "PROJECT_KEY_PROJECT_MISMATCH",
  "PROJECT_ALREADY_BOUND_TO_OTHER_KEY", "HYBRID_MODEL_INVALID", "HYBRID_PROJECT_VERSION_CONFLICT",
  "HYBRID_OPERATION_NOT_SUPPORTED", "HYBRID_INPUT_TOO_LARGE", "ACCESS_SERVICE_UNAVAILABLE"])});
export const hybridInputLimit = 1048576;
export const orderView = z.strictObject({
  order_id: z.uuid(), amount: z.literal(500), currency: z.enum(["CNY", "USD"]),
  status: z.enum(["PENDING", "PAID"]),
});
