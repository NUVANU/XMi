import type { Candidate, Command, DecisionDetail, Item, SourceRef } from "../shared-types/domain.ts";
import { requireCondition } from "./errors.ts";
import { itemFingerprint } from "./validation.ts";

export type DecisionProposalInput = {
  id: string;
  question: string;
  why_it_matters: string;
  options: DecisionDetail["options"];
  recommendation: DecisionDetail["recommendation"];
  owner_selection?: string | null;
  linked_requirements?: string[];
  linked_flows?: string[];
  source_ref: SourceRef;
  statement?: string;
};

export class DecisionService {
  propose(input: DecisionProposalInput): Candidate {
    requireCondition(input.options.some((option) => option.id === input.recommendation.option_id), "INVALID_DECISION_RECOMMENDATION");
    if (input.owner_selection) {
      requireCondition(input.options.some((option) => option.id === input.owner_selection), "INVALID_DECISION_SELECTION");
    }
    return {
      id: input.id,
      type: "decision",
      statement: input.statement ?? input.question,
      status: "PROPOSED",
      source_refs: [input.source_ref],
      priority: "P0",
      tags: ["material"],
      decision_detail: {
        question: input.question,
        why_it_matters: input.why_it_matters,
        options: input.options,
        recommendation: input.recommendation,
        owner_selection: input.owner_selection ?? null,
        linked_requirements: input.linked_requirements ?? [],
        linked_flows: input.linked_flows ?? [],
        supersession_history: [],
      },
    };
  }

  compare(item: Item) {
    requireCondition(item.type === "decision" && item.decision_detail, "DECISION_DETAIL_REQUIRED");
    return {
      decision_id: item.id,
      question: item.decision_detail.question,
      why_it_matters: item.decision_detail.why_it_matters,
      options: item.decision_detail.options.map((option) => ({...option})),
      recommendation: {...item.decision_detail.recommendation},
      owner_selection: item.decision_detail.owner_selection,
      linked_requirements: [...item.decision_detail.linked_requirements],
      linked_flows: [...item.decision_detail.linked_flows],
      supersession_history: [...item.decision_detail.supersession_history],
    };
  }

  approve(item: Item, selectedOptionId: string, ownerRef: SourceRef): Command {
    requireCondition(item.type === "decision" && item.decision_detail, "DECISION_DETAIL_REQUIRED");
    requireCondition(ownerRef.type === "owner_action", "OWNER_ACTION_REQUIRED");
    requireCondition(item.decision_detail.options.some((option) => option.id === selectedOptionId), "INVALID_DECISION_SELECTION");
    return {
      kind: "DECISION_APPROVED",
      item_id: item.id,
      fingerprint: itemFingerprint(item),
      selected_option_id: selectedOptionId,
      owner_action: {intent: "APPROVE_DECISION", source_ref: ownerRef as SourceRef & {type: "owner_action"}},
    };
  }

  supersede(item: Item, replacement: Item, ownerRef: SourceRef): Command {
    requireCondition(item.type === "decision" && replacement.type === "decision", "DECISION_DETAIL_REQUIRED");
    requireCondition(ownerRef.type === "owner_action", "OWNER_ACTION_REQUIRED");
    requireCondition(item.id !== replacement.id, "INVALID_SUPERSESSION");
    return {
      kind: "ITEM_SUPERSEDED",
      item_id: item.id,
      replacement_item_id: replacement.id,
      fingerprint: itemFingerprint(item),
      replacement_fingerprint: itemFingerprint(replacement),
      owner_action: {intent: "SUPERSEDE", source_ref: ownerRef as SourceRef & {type: "owner_action"}},
    };
  }
}
