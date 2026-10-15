import type { Checkpoint, DomainEvent, Project, Receipt } from "../shared-types/domain.ts";
import type { ProjectStore, StoreTransaction } from "./store.ts";
import { requireCondition } from "../core/errors.ts";

type State = { snapshots: Map<string, Project>; events: Map<string, DomainEvent[]>;
  receipts: Map<string, Receipt>; checkpoints: Map<string, Checkpoint[]> };
export class MemoryProjectStore implements ProjectStore {
  private state: State = {snapshots: new Map(), events: new Map(), receipts: new Map(), checkpoints: new Map()};
  transaction<T>(work: (tx: StoreTransaction) => T): T {
    const state = structuredClone(this.state);
    const tx: StoreTransaction = {
      snapshot: (id) => structuredClone(state.snapshots.get(id)),
      save: (p) => { state.snapshots.set(p.project_id, structuredClone(p)); },
      events: (id) => structuredClone(state.events.get(id) ?? []),
      append: (e) => {
        const events = state.events.get(e.project_id) ?? [];
        requireCondition(!events.some((old) => old.version === e.version) &&
          ![...state.events.values()].flat().some((old) => old.event_id === e.event_id), "DUPLICATE_EVENT");
        state.events.set(e.project_id, [...events, structuredClone(e)]);
      },
      receipt: (key) => structuredClone(state.receipts.get(key)),
      saveReceipt: (key, r) => {
        requireCondition(!state.receipts.has(key), "DUPLICATE_RECEIPT");
        state.receipts.set(key, structuredClone(r));
      },
      checkpoint: (c) => {
        const prior = state.checkpoints.get(c.project_id) ?? [];
        const existing = prior.find((p) => p.version === c.version && p.kind === c.kind);
        if (existing) {
          requireCondition(existing.hash === c.hash, "CHECKPOINT_CONFLICT");
          return;
        }
        state.checkpoints.set(c.project_id, [...prior, structuredClone(c)]);
      },
      checkpoints: (id) => structuredClone(state.checkpoints.get(id) ?? []),
    };
    const result = work(tx);
    this.state = state;
    return structuredClone(result);
  }
  close(): void { /* No external resources. */ }
}
