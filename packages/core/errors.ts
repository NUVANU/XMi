export class DomainError extends Error {
  readonly code: string;
  readonly current_version?: number;
  constructor(code: string, currentVersion?: number) {
    super(code);
    this.name = "DomainError";
    this.code = code;
    this.current_version = currentVersion;
  }
}
export function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new DomainError(code);
}
