export type ApiErrorShape = {
  error: string;
  code?: string;
  message?: string;
  details?: unknown;
  retryAfterSec?: number;
};

export class DlApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly retryAfterSec?: number;

  constructor(opts: {
    status: number;
    message: string;
    code?: string;
    details?: unknown;
    retryAfterSec?: number;
  }) {
    super(opts.message);
    this.name = "DlApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    this.retryAfterSec = opts.retryAfterSec;
  }
}
