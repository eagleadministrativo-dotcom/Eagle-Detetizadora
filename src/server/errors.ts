export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = "Você não tem permissão para esta ação.") {
    super("forbidden", message);
  }
}
export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
