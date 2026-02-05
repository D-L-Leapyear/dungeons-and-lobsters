export class DlApiError extends Error {
    status;
    code;
    details;
    retryAfterSec;
    constructor(opts) {
        super(opts.message);
        this.name = "DlApiError";
        this.status = opts.status;
        this.code = opts.code;
        this.details = opts.details;
        this.retryAfterSec = opts.retryAfterSec;
    }
}
//# sourceMappingURL=errors.js.map