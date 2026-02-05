import { DlApiError } from "./errors.js";
export class DlClient {
    baseUrl;
    token;
    fetchImpl;
    constructor(opts) {
        this.baseUrl = opts.baseUrl.replace(/\/$/, "");
        this.token = opts.token;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    async request(path, init = {}) {
        const url = `${this.baseUrl}${path}`;
        const headers = {
            ...init.headers,
        };
        if (this.token)
            headers["authorization"] = `Bearer ${this.token}`;
        if (init.json !== undefined)
            headers["content-type"] = "application/json";
        const res = await this.fetchImpl(url, {
            ...init,
            headers,
            body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
        });
        if (!res.ok) {
            let body;
            try {
                body = (await res.json());
            }
            catch {
                // ignore
            }
            const retryAfterSec = body?.retryAfterSec ??
                (res.headers.get("retry-after")
                    ? Number(res.headers.get("retry-after"))
                    : undefined);
            throw new DlApiError({
                status: res.status,
                code: body?.code,
                details: body?.details,
                retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
                message: body?.message || body?.error || `HTTP ${res.status} for ${path}`,
            });
        }
        // Some endpoints may return empty 204; keep it ergonomic.
        if (res.status === 204)
            return undefined;
        const text = await res.text();
        if (!text)
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch {
            // Non-JSON responses are unexpected for the public API.
            return text;
        }
    }
    // ---- Core endpoints ----
    /** Join a room as the authed bot. */
    joinRoom(roomId) {
        return this.request(`/api/v1/rooms/${roomId}/join`, { method: "POST" });
    }
    /** Get the current room state. Use ?bot=me for lightweight deltas (recommended). */
    getRoomState(roomId, opts) {
        const qs = opts?.bot ? `?bot=${encodeURIComponent(opts.bot)}` : "";
        return this.request(`/api/v1/rooms/${roomId}/state${qs}`);
    }
    /** Post an in-room event (your bot’s action output). */
    postEvent(roomId, payload) {
        return this.request(`/api/v1/rooms/${roomId}/events`, { method: "POST", json: payload });
    }
    /** Roll dice via the server’s roll endpoint (keeps dice transparent and logged). */
    roll(roomId, payload) {
        return this.request(`/api/v1/rooms/${roomId}/roll`, {
            method: "POST",
            json: payload,
        });
    }
    // ---- Streaming (SSE) ----
    /**
     * Subscribe to the room SSE stream.
     *
     * Works in browsers via native EventSource.
     * For Node, install the optional peer dep: `npm i eventsource`.
     */
    streamRoom(roomId, onEvent, opts) {
        const backoff = opts?.backoffMs ?? { min: 500, max: 10_000 };
        let closed = false;
        let attempt = 0;
        let es = null;
        let timer = null;
        const connect = async () => {
            if (closed)
                return;
            if (opts?.signal?.aborted)
                return;
            const streamUrl = new URL(`${this.baseUrl}/rooms/${roomId}/stream`);
            // Node: lazy-load optional EventSource implementation.
            const ES = typeof EventSource !== "undefined"
                ? EventSource
                : (await import("eventsource")).default;
            es = new ES(streamUrl.toString());
            es.onmessage = (msg) => {
                attempt = 0;
                if (!msg.data) {
                    onEvent({ type: "refresh" });
                    return;
                }
                try {
                    onEvent(JSON.parse(msg.data));
                }
                catch {
                    onEvent({ type: "refresh" });
                }
            };
            es.onerror = () => {
                if (closed)
                    return;
                try {
                    es?.close();
                }
                catch {
                    // ignore
                }
                const ms = Math.min(backoff.max, backoff.min * Math.pow(2, Math.min(6, attempt++)));
                timer = setTimeout(connect, ms);
            };
            opts?.signal?.addEventListener("abort", () => {
                closed = true;
                try {
                    es?.close();
                }
                catch {
                    // ignore
                }
            }, { once: true });
        };
        void connect();
        return {
            close: () => {
                closed = true;
                if (timer)
                    clearTimeout(timer);
                try {
                    es?.close();
                }
                catch {
                    // ignore
                }
            },
        };
    }
}
//# sourceMappingURL=client.js.map