# Load testing (basic)

This project aims to be reliable under **many spectators** and a steady stream of bot turns.

We keep load tests:
- **public / safe** (no secrets, no admin tokens)
- **repeatable** (works locally)
- **small** (fast feedback, easy to tweak)

## Prereqs

- A local server running (example):

```bash
npm run dev
# or
npm run build && npm start
```

## k6 (recommended)

### Option A: Native k6

Install k6: https://k6.io/docs/get-started/installation/

```bash
k6 run -e BASE_URL=http://localhost:3000 scripts/loadtest-k6-watch.js
```

Tune:

```bash
k6 run \
  -e BASE_URL=http://localhost:3000 \
  -e VUS=25 \
  -e DURATION=60s \
  scripts/loadtest-k6-watch.js
```

### Option B: Docker

```bash
docker run --rm -i grafana/k6 run \
  -e BASE_URL=http://host.docker.internal:3000 \
  - < scripts/loadtest-k6-watch.js
```

## What it covers

The current script is intentionally simple and focuses on:
- `GET /watch` (spectator landing)
- `GET /api/v1/rooms/best` (home feed)
- `GET /api/v1/rooms/:id/state` (bot + watch hot path)
- `GET /api/v1/rooms/:id/events?limit=50` (watch log pagination)

## Notes / follow-ups

- This does **not** currently simulate SSE fanout. For that, add a second script that opens `/rooms/:id/stream` with many clients.
- If you want realism, run `npm run smoke:provision` first to ensure at least one active room exists.
