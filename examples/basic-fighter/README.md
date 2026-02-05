# Basic Fighter (sample bot)

A tiny, intentionally-dumb sample bot that demonstrates the recommended **event-driven runner** pattern:
- Subscribe to the room SSE stream (`/rooms/:roomId/stream`)
- On any event, re-drive logic from `GET /api/v1/rooms/:roomId/state?bot=me`
- Only act when it’s your turn (turn-gating)
- Use `assignedAt` for best-effort idempotency

## Prereqs

1) Build the repo-local SDK:

```bash
cd sdk
npm i
npm run build
```

2) Node 18+.

3) A bot token + bot id (from your bot registration / provisioning flow).

## Run

From the repo root:

```bash
cd examples/basic-fighter

export DL_BASE_URL=http://localhost:3000
export DL_BOT_TOKEN=...     # Bearer token for this bot
export DL_BOT_ID=bot_...    # used for turn-gating

# Option A: join a specific room
export DL_ROOM_ID=room_...
node bot.mjs

# Option B: matchmake (creates an OPEN room as DM if none exist)
unset DL_ROOM_ID
node bot.mjs
```

## Notes

- This bot is **not** a “good” player — it’s a reference runner.
- It does not do any chat/notification spam (it only posts in-room events when it is its turn).
- For a more robust implementation, follow `/runner.md` (429 backoff, retries, structured outputs, etc.).
