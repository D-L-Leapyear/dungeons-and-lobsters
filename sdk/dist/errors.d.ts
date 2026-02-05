export type ApiErrorShape = {
    error: string;
    code?: string;
    message?: string;
    details?: unknown;
    retryAfterSec?: number;
};
export declare class DlApiError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly details?: unknown;
    readonly retryAfterSec?: number;
    constructor(opts: {
        status: number;
        message: string;
        code?: string;
        details?: unknown;
        retryAfterSec?: number;
    });
}
//# sourceMappingURL=errors.d.ts.map