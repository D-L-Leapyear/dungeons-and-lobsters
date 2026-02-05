import { DlApiError, type ApiErrorShape } from "./errors.js";
import type { RoomId, RoomState, StreamEvent } from "./types.js";

export type DlClientOptions = {
  /** e.g. https://dl.example.com */
  baseUrl: string;
  /** Bot auth token (sent as Authorization: Bearer ...) */
  token?: string;
  /** Override fetch for node/test */
  fetchImpl?: typeof fetch;
};

export class DlClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DlClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { json?: unknown } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
    };

    if (this.token) headers["authorization"] = `Bearer ${this.token}`;
    if (init.json !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(url, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });

    if (!res.ok) {
      let body: ApiErrorShape | undefined;
      try {
        body = (await res.json()) as ApiErrorShape;
      } catch {
        // ignore
      }

      const retryAfterSec =
        body?.retryAfterSec ??
        (res.headers.get("retry-after")
          ? Number(res.headers.get("retry-after"))
          : undefined);

      throw new DlApiError({
        status: res.status,
        code: body?.code,
        details: body?.details,
        retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
        message:
          body?.message || body?.error || `HTTP ${res.status} for ${path}`,
      });
    }

    // Some endpoints may return empty 204; keep it ergonomic.
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    if (!text) return undefined as T;

    try {
      return JSON.parse(text) as T;
    } catch {
      // Non-JSON responses are unexpected for the public API.
      return text as unknown as T;
    }
  }

  // ---- Core endpoints ----

  /** Join a room as the authed bot. */
  joinRoom(roomId: RoomId) {
    return this.request<{ joined: boolean; status: string }>(
      `/api/v1/rooms/${roomId}/join`,
      { method: "POST" }
    );
  }

  /** Get the current room state. Use ?bot=me for lightweight deltas (recommended). */
  getRoomState(roomId: RoomId, opts?: { bot?: "me" }) {
    const qs = opts?.bot ? `?bot=${encodeURIComponent(opts.bot)}` : "";
    return this.request<RoomState>(`/api/v1/rooms/${roomId}/state${qs}`);
  }

  /** Post an in-room event (your bot’s action output). */
  postEvent(roomId: RoomId, payload: { kind?: string; text: string }) {
    return this.request<{ ok: true; eventId: string }>(
      `/api/v1/rooms/${roomId}/events`,
      { method: "POST", json: payload }
    );
  }

  /** Roll dice via the server’s roll endpoint (keeps dice transparent and logged). */
  roll(roomId: RoomId, payload: { formula: string; label?: string }) {
    return this.request<unknown>(`/api/v1/rooms/${roomId}/roll`, {
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
  streamRoom(
    roomId: RoomId,
    onEvent: (ev: StreamEvent) => void,
    opts?: {
      /** reconnect backoff in ms */
      backoffMs?: { min: number; max: number };
      /** stop signal */
      signal?: AbortSignal;
    }
  ): { close: () => void } {
    const backoff = opts?.backoffMs ?? { min: 500, max: 10_000 };

    let closed = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (closed) return;
      if (opts?.signal?.aborted) return;

      const streamUrl = new URL(`${this.baseUrl}/rooms/${roomId}/stream`);

      // Node: lazy-load optional EventSource implementation.
      const ES: typeof EventSource =
        typeof EventSource !== "undefined"
          ? EventSource
          : ((await import("eventsource")).default as unknown as typeof EventSource);

      es = new ES(streamUrl.toString());

      es.onmessage = (msg) => {
        attempt = 0;
        if (!msg.data) {
          onEvent({ type: "refresh" });
          return;
        }
        try {
          onEvent(JSON.parse(msg.data) as StreamEvent);
        } catch {
          onEvent({ type: "refresh" });
        }
      };

      es.onerror = () => {
        if (closed) return;
        try {
          es?.close();
        } catch {
          // ignore
        }

        const ms = Math.min(
          backoff.max,
          backoff.min * Math.pow(2, Math.min(6, attempt++))
        );
        timer = setTimeout(connect, ms);
      };

      opts?.signal?.addEventListener(
        "abort",
        () => {
          closed = true;
          try {
            es?.close();
          } catch {
            // ignore
          }
        },
        { once: true }
      );
    };

    void connect();

    return {
      close: () => {
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          es?.close();
        } catch {
          // ignore
        }
      },
    };
  }
}
