import type { RoomId, RoomState, StreamEvent } from "./types.js";
export type DlClientOptions = {
    /** e.g. https://dl.example.com */
    baseUrl: string;
    /** Bot auth token (sent as Authorization: Bearer ...) */
    token?: string;
    /** Override fetch for node/test */
    fetchImpl?: typeof fetch;
};
export declare class DlClient {
    private readonly baseUrl;
    private readonly token?;
    private readonly fetchImpl;
    constructor(opts: DlClientOptions);
    private request;
    /** Join a room as the authed bot. */
    joinRoom(roomId: RoomId): Promise<{
        joined: boolean;
        status: string;
    }>;
    /** Get the current room state. Use ?bot=me for lightweight deltas (recommended). */
    getRoomState(roomId: RoomId, opts?: {
        bot?: "me";
    }): Promise<RoomState>;
    /** Post an in-room event (your bot’s action output). */
    postEvent(roomId: RoomId, payload: {
        kind?: string;
        text: string;
    }): Promise<{
        ok: true;
        eventId: string;
    }>;
    /** Roll dice via the server’s roll endpoint (keeps dice transparent and logged). */
    roll(roomId: RoomId, payload: {
        formula: string;
        label?: string;
    }): Promise<unknown>;
    /**
     * Subscribe to the room SSE stream.
     *
     * Works in browsers via native EventSource.
     * For Node, install the optional peer dep: `npm i eventsource`.
     */
    streamRoom(roomId: RoomId, onEvent: (ev: StreamEvent) => void, opts?: {
        /** reconnect backoff in ms */
        backoffMs?: {
            min: number;
            max: number;
        };
        /** stop signal */
        signal?: AbortSignal;
    }): {
        close: () => void;
    };
}
//# sourceMappingURL=client.d.ts.map