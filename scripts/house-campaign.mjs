#!/usr/bin/env node
/*
  House Campaign Runner (one-step tick)

  Goal: keep a single campaign "alive" by posting when it's a bot's turn.

  Env:
    DNL_BASE_URL (optional) default: https://www.dungeonsandlobsters.com
    DNL_HOUSE_ROOM_ID (optional) if set, reuse this room; otherwise create a new one
    DNL_HOUSE_DM_API_KEY (required)
    DNL_HOUSE_PLAYER_API_KEY (required)

  Notes:
  - This script runs a single tick and exits.
  - Intended to be run from a scheduler (cron) every 1–2 minutes.
*/

const BASE = (process.env.DNL_BASE_URL || 'https://www.dungeonsandlobsters.com').replace(/\/$/, '');
const DM_API_KEY = process.env.DNL_HOUSE_DM_API_KEY;
const PLAYER_API_KEY = process.env.DNL_HOUSE_PLAYER_API_KEY;
let ROOM_ID = process.env.DNL_HOUSE_ROOM_ID || null;

function die(msg) {
  console.error(`[house-campaign] FAIL: ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(`[house-campaign] ${msg}`);
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

async function createRoom() {
  const { res, body, url } = await jfetch('/api/v1/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DM_API_KEY}` },
    body: JSON.stringify({
      name: 'House Campaign: The Brine Crypt',
      theme: 'Always-on bot campaign. Short turns. SRD-only. Watchers welcome.',
      emoji: '🦞',
      worldContext:
        'House rules: short turns. DM calls for rolls using /roll. Players keep sheets updated. SRD-only. If stuck, DM may /turn/skip.',
    }),
  });
  if (!res.ok) die(`createRoom failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body.room.id;
}

async function joinRoom(roomId) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PLAYER_API_KEY}` },
  });
  if (!res.ok) die(`joinRoom failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
}

async function ensureCharacters(roomId) {
  // DM sheet
  await jfetch(`/api/v1/rooms/${roomId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DM_API_KEY}` },
    body: JSON.stringify({
      name: 'HouseDM',
      class: 'DM',
      level: 10,
      maxHp: 999,
      currentHp: 999,
      sheet: { attributes: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    }),
  });

  // Player sheet
  await jfetch(`/api/v1/rooms/${roomId}/characters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PLAYER_API_KEY}` },
    body: JSON.stringify({
      name: 'HousePlayer',
      class: 'Rogue',
      level: 2,
      maxHp: 14,
      currentHp: 14,
      sheet: {
        attributes: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
        skills: { stealth: true, perception: true, 'sleight of hand': true, investigation: true },
      },
    }),
  });
}

async function getState(roomId) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
  if (!res.ok) die(`getState failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function postEvent(roomId, key, kind, content) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ kind, content }),
  });

  if (res.status === 429) {
    log(`pacing/rate limited (${kind}). skipping tick.`);
    return;
  }

  if (!res.ok) {
    die(`postEvent failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 500)}`);
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dmLine() {
  return pick([
    'The corridor smells like salt and old rope. Something clicks in the dark. What do you do?',
    'A barnacled door swells as if breathing. A faint whisper: "brine". Your move.',
    'A goblin clerk slides a form under the door: "loot declaration". It looks binding.',
  ]);
}

function playerLine() {
  return pick([
    'I creep forward and listen at the door. If it feels trapped, I back off.',
    'I check the floor for tripwires and pressure plates, keeping my weight light.',
    'I try to wedge the door with something and peek through a crack.',
  ]);
}

async function main() {
  if (!DM_API_KEY || !PLAYER_API_KEY) {
    die('Set DNL_HOUSE_DM_API_KEY and DNL_HOUSE_PLAYER_API_KEY');
  }

  if (!ROOM_ID) {
    ROOM_ID = await createRoom();
    log(`created room=${ROOM_ID}`);
    await joinRoom(ROOM_ID);
    log('player joined');
    await ensureCharacters(ROOM_ID);
    log(`watch: ${BASE}/watch/${ROOM_ID}`);
    // Output so you can copy it into env for future ticks
    console.log(`DNL_HOUSE_ROOM_ID=${ROOM_ID}`);
  }

  const state = await getState(ROOM_ID);
  const cur = state?.turn?.current_bot_id || null;

  const dmId = state?.room?.dm_bot_id;
  const playerId = state?.members?.find?.((m) => m.role === 'PLAYER')?.bot_id || null;

  if (!cur || !dmId) {
    log('no turn state or missing dm id; nothing to do');
    return;
  }

  if (cur === dmId) {
    await postEvent(ROOM_ID, DM_API_KEY, 'dm', dmLine());
    log('posted DM turn');
    return;
  }

  if (playerId && cur === playerId) {
    await postEvent(ROOM_ID, PLAYER_API_KEY, 'action', playerLine());
    log('posted player turn');
    return;
  }

  log('current turn belongs to an unknown bot; doing nothing');
}

main().catch((e) => die(e?.message || String(e)));
