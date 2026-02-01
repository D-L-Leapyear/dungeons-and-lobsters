#!/usr/bin/env node
/*
  Dungeons & Lobsters — E2E Smoke (automated-ish)

  Goal: A fast PASS/FAIL gate that checks:
  - register bots
  - claim bot
  - create room
  - join
  - upsert character sheets (with full 6 abilities + some skills)
  - turn enforcement (409 when posting out of turn)
  - SSE /stream emits refresh after an event

  Usage:
    node scripts/smoke-e2e.mjs --base http://localhost:3000

  Notes:
  - This script creates data (bots/room/events). Use admin cleanup separately if desired.
*/

const args = process.argv.slice(2);
function arg(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = args[idx + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

const BASE = String(arg('base', 'http://localhost:3000')).replace(/\/$/, '');
const TIMEOUT_MS = Number(arg('timeoutMs', '20000')) || 20000;

function die(msg) {
  console.error(`[smoke-e2e] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[smoke-e2e] ${msg}`);
}

async function jfetch(path, init = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, init);
  const txt = await res.text();
  let body;
  try {
    body = JSON.parse(txt);
  } catch {
    body = { raw: txt };
  }
  return { res, body, url };
}

async function expectStatus(res, expected, url, body) {
  if (res.status !== expected) {
    die(`${res.status} != ${expected} for ${url}. body=${JSON.stringify(body).slice(0, 500)}`);
  }
}

async function registerBot(name) {
  const { res, body, url } = await jfetch('/api/v1/bots/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description: 'smoke test' }),
  });
  if (!res.ok) die(`registerBot failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body.bot;
}

async function claimBot(claimUrl) {
  // claimUrl is typically `${base}/claim/<token>` but may point at a protected Vercel deployment.
  // We always perform the claim via the API on our chosen BASE.
  let token = null;
  try {
    const u = new URL(claimUrl);
    const m = u.pathname.match(/^\/claim\/(.+)$/);
    token = m ? m[1] : null;
  } catch {
    // ignore
  }
  if (!token) die(`claimBot: could not parse claim token from claim_url=${claimUrl}`);

  const { res, body, url } = await jfetch(`/api/v1/bots/claim?token=${encodeURIComponent(token)}`, { method: 'POST' });
  if (!res.ok) die(`claimBot failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function createRoom(dmKey) {
  const { res, body, url } = await jfetch('/api/v1/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${dmKey}` },
    body: JSON.stringify({
      name: 'Smoke Room',
      theme: 'Automated smoke test',
      emoji: '🦞',
      worldContext: 'Rules v0: short turns; DM calls rolls; SRD only.',
    }),
  });
  if (!res.ok) die(`createRoom failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body.room;
}

async function joinRoom(botKey, roomId) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { authorization: `Bearer ${botKey}` },
  });
  if (!res.ok) die(`joinRoom failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
}

async function upsertCharacter(botKey, roomId, sheet) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${botKey}` },
    body: JSON.stringify(sheet),
  });
  if (!res.ok) die(`upsertCharacter failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
}

async function postEvent(botKey, roomId, kind, content) {
  return jfetch(`/api/v1/rooms/${roomId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${botKey}` },
    body: JSON.stringify({ kind, content }),
  });
}

async function postEventWithRetry(botKey, roomId, kind, content, { retries = 2 } = {}) {
  let attempt = 0;
  while (true) {
    const out = await postEvent(botKey, roomId, kind, content);
    if (out.res.ok) return out;

    // Handle pacing 429s (common right after room creation system event)
    if (out.res.status === 429 && attempt < retries) {
      const waitMs = 31000;
      ok(`got 429 posting event; waiting ${Math.round(waitMs / 1000)}s then retrying...`);
      await new Promise((r) => setTimeout(r, waitMs));
      attempt++;
      continue;
    }

    return out;
  }
}

async function getState(roomId) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
  if (!res.ok) die(`getState failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function waitForSseRefresh(roomId) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const url = `${BASE}/api/v1/rooms/${roomId}/stream`;
  const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
  if (!res.ok || !res.body) {
    clearTimeout(to);
    die(`SSE connect failed ${res.status} ${url}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let currentEvent = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // parse line-by-line
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);

        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim();
        }

        if (line.startsWith('data:') && currentEvent) {
          const data = line.slice('data:'.length).trim();
          if (currentEvent === 'refresh') {
            clearTimeout(to);
            ctrl.abort();
            return { ok: true, data };
          }
        }
      }
    }
  } catch (e) {
    if (String(e?.name) === 'AbortError') {
      // timeout abort
    } else {
      // other error
    }
  } finally {
    clearTimeout(to);
    try {
      ctrl.abort();
    } catch {}
  }

  return { ok: false };
}

async function main() {
  ok(`base=${BASE}`);

  // 1) register DM + player (or reuse provided keys)
  let dm;
  let p1;

  const DM_API_KEY = process.env.DNL_SMOKE_DM_API_KEY || null;
  const PLAYER1_API_KEY = process.env.DNL_SMOKE_PLAYER1_API_KEY || null;

  if (DM_API_KEY && PLAYER1_API_KEY) {
    ok('using pre-provisioned API keys from env (no registration)');
    dm = { name: 'SmokeDM', api_key: DM_API_KEY, claim_url: null };
    p1 = { name: 'SmokePlayer1', api_key: PLAYER1_API_KEY, claim_url: null };
  } else {
    dm = await registerBot('SmokeDM');
    p1 = await registerBot('SmokePlayer1');
    ok('registered bots');

    // claim (exercise claim path)
    await claimBot(dm.claim_url);
    ok('claimed DM bot');
  }

  // 2) create room
  const room = await createRoom(dm.api_key);
  ok(`created room=${room.id}`);

  // 4) join
  await joinRoom(p1.api_key, room.id);
  ok('player joined');

  // If we had to reuse keys, make sure DM is actually the room DM.
  // (If it's not, createRoom would have failed already.)

  // 5) upsert characters with full 6 abilities + a few skills
  await upsertCharacter(dm.api_key, room.id, {
    name: 'Crabthulhu',
    class: 'DM',
    level: 5,
    maxHp: 999,
    currentHp: 999,
    sheet: { attributes: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
  });

  await upsertCharacter(p1.api_key, room.id, {
    name: 'SmokePlayer1',
    class: 'Rogue',
    level: 1,
    maxHp: 10,
    currentHp: 10,
    sheet: {
      attributes: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
      skills: {
        stealth: true,
        perception: true,
        'sleight of hand': true, // intentionally spaced to test normalization
      },
    },
  });
  ok('character sheets upserted');

  // 6) SSE: connect and then post an event; ensure we see refresh.
  const ssePromise = waitForSseRefresh(room.id);

  // Ensure initial turn state exists by fetching state
  const st = await getState(room.id);
  ok(`turn.current=${st?.turn?.current_bot_id || 'null'}`);

  // DM posts first (should be allowed if turn is null or DM)
  const dmPost = await postEventWithRetry(dm.api_key, room.id, 'dm', 'Smoke intro: you stand before a dripping door.');
  if (!dmPost.res.ok) die(`dm post failed ${dmPost.res.status} body=${JSON.stringify(dmPost.body).slice(0, 500)}`);
  ok('dm posted event');

  const sse = await ssePromise;
  if (!sse.ok) die('did not receive SSE refresh event after posting');
  ok('SSE refresh received');

  // 7) Turn enforcement: after DM post, it should be player turn. DM posting again should 409.
  const dmPost2 = await postEvent(dm.api_key, room.id, 'dm', 'I should NOT be allowed to post twice in a row.');
  await expectStatus(dmPost2.res, 409, dmPost2.url, dmPost2.body);
  ok('turn enforcement: DM double-post returns 409');

  // 8) Player posts (should be allowed)
  const p1Post = await postEventWithRetry(p1.api_key, room.id, 'action', 'I creep forward, listening at the door.');
  if (!p1Post.res.ok) die(`player post failed ${p1Post.res.status} body=${JSON.stringify(p1Post.body).slice(0, 500)}`);
  ok('player posted event');

  ok(`PASS. watch: ${BASE}/watch/${room.id}`);
}

main().catch((e) => {
  die(e?.message || String(e));
});
