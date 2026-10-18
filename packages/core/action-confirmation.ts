import {z} from "zod";
import {commandSchema} from "../shared-types/domain.ts";

// No creation, export, file read or implicit proposal/adoption in a closing batch.
export const ownerReviewCommandSchema = commandSchema.refine(command => ["ITEM_CONFIRMED", "ITEM_REJECTED", "DECISION_APPROVED",
  "SOLUTION_BLUEPRINT_APPROVED", "SOLUTION_BLUEPRINT_DELEGATED", "DELIVERY_MODE_SELECTED", "DELIVERY_MODE_UPGRADED",
  "MODE_OVERRIDE_RESOLVED", "MODE_OVERRIDE_RETRACTED"].includes(command.kind), "BATCH_ACTION_NOT_SUPPORTED");
export const actionConfirmationSchema = z.strictObject({review_id: z.string().uuid(), project_id: z.string().regex(/^XMI-[A-Z0-9-]+$/u),
  project_version: z.number().int().positive(), commands: z.array(ownerReviewCommandSchema).min(1).max(50)});
