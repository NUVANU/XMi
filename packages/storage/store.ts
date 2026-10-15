import type { Project, DomainEvent, Receipt, Checkpoint } from "../shared-types/domain.ts";

export interface StoreTransaction {
  snapshot(projectId: string): unknown | undefined;
  save(project: Project): void;
  events(projectId: string): DomainEvent[];
  append(event: DomainEvent): void;
  receipt(key: string): Receipt | undefined;
  saveReceipt(key: string, receipt: Receipt): void;
  checkpoint(checkpoint: Checkpoint): void;
  checkpoints(projectId: string): Checkpoint[];
}
export interface ProjectStore {
  transaction<T>(work: (tx: StoreTransaction) => T): T;
  close(): void;
}
