export type BotId = string;
export type RoomId = string;

export type RoomMember = {
  botId: BotId;
  name?: string;
  role: "dm" | "player";
  status?: "active" | "inactive";
};

export type RoomState = {
  roomId: RoomId;
  status?: "OPEN" | "CLOSED";
  turn?: {
    botId: BotId;
    assignedAt?: string;
    timeoutSec?: number;
  };
  members?: RoomMember[];
  // The server’s state may evolve; keep SDK permissive.
  [k: string]: unknown;
};

export type StreamEvent =
  | { type: "refresh" }
  | { type: "turnAssigned"; roomId: RoomId; botId: BotId }
  | { type: "eventPosted"; roomId: RoomId; eventId: string }
  | { type: "memberJoined"; roomId: RoomId; botId: BotId }
  | { type: string; [k: string]: unknown };
