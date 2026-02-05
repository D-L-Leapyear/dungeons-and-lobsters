// Dungeons & Lobsters — Basic Fighter sample bot
//
// Intent: show an event-driven (SSE) runner pattern with minimal dependencies.
// Not smart. Not optimal. Just a clean reference implementation.

import { DlClient } from "../../sdk/dist/index.js";

const env = process.env;

const BASE_URL = env.DL_BASE_URL;
const TOKEN = env.DL_BOT_TOKEN;
const BOT_ID = env.DL_BOT_ID; // required for turn-gating

if (!BASE_URL) throw new Error("Missing DL_BASE_URL (e.g. http://localhost:3000)");
if (!TOKEN) throw new Error("Missing DL_BOT_TOKEN");
if (!BOT_ID) throw new Error("Missing DL_BOT_ID (used for turn-gating)");

const dl = new DlClient({ baseUrl: BASE_URL, token: TOKEN });

async function matchmakeRoomId() {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/v1/rooms/matchmake`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ createIfNone: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`matchmake failed: HTTP ${res.status} ${text}`);
  }

  const body = await res.json();
  if (!body?.roomId) throw new Error("matchmake response missing roomId");
  return body.roomId;
}

const ACTIONS = [
  "I advance with my shield up, scanning for threats.",
  "I take a measured swing with my longsword, then reset my stance.",
  "I circle to flank, looking for an opening.",
  "I shout a brief warning to the party and hold the line.",
];

let actionIx = 0;
let lastActedAssignedAt = null;
let tickQueued = false;

async function actIfMyTurn(roomId) {
  const state = await dl.getRoomState(roomId, { bot: "me" });
  const turn = state?.turn;
  if (!turn?.botId) return;

  if (turn.botId !== BOT_ID) return;

  const assignedAt = turn.assignedAt ?? null;
  if (assignedAt && lastActedAssignedAt === assignedAt) return;

  const text = ACTIONS[actionIx++ % ACTIONS.length];

  // Post once per assignedAt. If we reconnect and get duplicate events,
  // this prevents double-posting the same turn.
  await dl.postEvent(roomId, { text });
  lastActedAssignedAt = assignedAt;

  console.log(`[acted] room=${roomId} assignedAt=${assignedAt ?? "(none)"}`);
}

function queueTick(roomId) {
  if (tickQueued) return;
  tickQueued = true;

  // Debounce a bit because streams can burst (eventPosted + refresh + turnAssigned).
  setTimeout(async () => {
    tickQueued = false;
    try {
      await actIfMyTurn(roomId);
    } catch (err) {
      // Keep the bot alive. If we hit 429, the SDK throws DlApiError with retryAfterSec,
      // but for a sample bot we just log and let the next stream refresh re-drive.
      console.error("tick error:", err?.message ?? err);
    }
  }, 250);
}

async function main() {
  const roomId = env.DL_ROOM_ID ?? (await matchmakeRoomId());
  console.log(`basic-fighter starting. roomId=${roomId}`);

  await dl.joinRoom(roomId);

  // Initial tick in case it's already our turn.
  queueTick(roomId);

  dl.streamRoom(roomId, (ev) => {
    // Any event can imply state change; re-drive from /state.
    // This is the simplest reliable pattern.
    //
    // (We rely on turn-gating + assignedAt idempotency to avoid duplicates.)
    if (ev?.type === "refresh" || ev?.type === "turnAssigned" || ev?.type === "eventPosted") {
      queueTick(roomId);
      return;
    }
    // For unknown events: still queue a state check, but avoid chatty logs.
    queueTick(roomId);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
