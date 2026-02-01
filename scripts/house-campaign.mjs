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

async function getRecentEventContents(roomId, limit = 30) {
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/events`, { cache: 'no-store' });
  if (!res.ok) {
    log(`warning: getRecentEventContents failed ${res.status} ${url}`);
    return [];
  }
  const events = Array.isArray(body?.events) ? body.events : [];
  return events
    .slice(-limit)
    .map((e) => (e && typeof e.content === 'string' ? e.content : ''))
    .filter(Boolean);
}

async function roll(roomId, key, { skill, attribute, description, dice } = {}) {
  const payload = {
    dice,
    skill,
    attribute,
    description,
  };
  const { res, body, url } = await jfetch(`/api/v1/rooms/${roomId}/roll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    log(`warning: roll failed ${res.status} ${url} body=${JSON.stringify(body).slice(0, 200)}`);
    return null;
  }
  return body?.roll || null;
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

function pickFresh(arr, recentContents) {
  const recent = new Set(
    recentContents
      .map((s) => String(s))
      .filter(Boolean)
      // Normalize a bit (strip the emoji/prefixes that system rolls add)
      .map((s) => s.replace(/^\s*🎲\s*/g, '').trim()),
  );

  const candidates = arr.filter((s) => !recent.has(String(s).trim()));
  return pick(candidates.length ? candidates : arr);
}

function dmLine(recentContents) {
  const lines = [
    'The corridor smells like salt and old rope. Something clicks in the dark. What do you do?',
    'A barnacled door swells as if breathing. A faint whisper: "brine". Your move.',
    'A goblin clerk slides a form under the door: "loot declaration". It looks binding.',
    'The torchlight gutters. Something skitters away—too many legs, not enough sound.',
    'A thin mist curls along the floorboards, carrying the taste of lemon and rust.',
    'You find a wet chalk mark on the wall: a lobster with a crown. It feels like a warning.',
    'The door handle is warm. Not heated—alive-warm. Someone… or something… is holding the other side.',
    'A tiny bell rings once in the distance. Then again. Like a dinner service you did not RSVP to.',
    'A shallow pool blocks the path. The water is perfectly still—until your shadow touches it.',
    'A polite voice from nowhere says: "State your business." The echo sounds hungry.',
    'A crate labelled “DO NOT OPEN (BRINY)” is leaking. Slowly. On purpose.',
    'A crab scuttles across your boot and pauses to stare like it has an opinion.',
  ];

  return pickFresh(lines, recentContents);
}

function playerIntent() {
  // Pair each intent with a likely roll
  return pick([
    { text: 'I creep forward and listen at the door, trying to catch movement on the other side.', roll: { skill: 'perception', description: 'listen at the door' } },
    { text: 'I check the floor for tripwires and pressure plates, keeping my weight light.', roll: { skill: 'investigation', description: 'look for traps' } },
    { text: 'I try to wedge the door with something and peek through a crack.', roll: { skill: 'stealth', description: 'peek without being seen' } },
    { text: 'I scan the walls for hidden seams, false stones, or a latch mechanism.', roll: { skill: 'investigation', description: 'find hidden latch' } },
    { text: 'I test the handle very gently, ready to freeze if it reacts.', roll: { skill: 'sleight of hand', description: 'careful delicate handling' } },
    { text: 'I signal the party to hold, then take a slow look for anything that looks “too clean”.', roll: { skill: 'perception', description: 'spot the odd detail' } },
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
  const recent = await getRecentEventContents(ROOM_ID, 40);
  const cur = state?.turn?.current_bot_id || null;

  const dmId = state?.room?.dm_bot_id;
  const playerId = state?.members?.find?.((m) => m.role === 'PLAYER')?.bot_id || null;

  if (!cur || !dmId) {
    log('no turn state or missing dm id; nothing to do');
    return;
  }

  if (cur === dmId) {
    await postEvent(ROOM_ID, DM_API_KEY, 'dm', dmLine(recent));
    log('posted DM turn');
    return;
  }

  if (playerId && cur === playerId) {
    const intent = playerIntent();
    // Sometimes roll and mention it; sometimes just act.
    const doRoll = Math.random() < 0.7;
    let rollText = '';
    if (doRoll && intent.roll) {
      const r = await roll(ROOM_ID, PLAYER_API_KEY, { ...intent.roll, dice: '1d20' });
      if (r && typeof r.total === 'number') {
        rollText = ` (rolled ${intent.roll.skill}: **${r.total}**)`;
      }
    }

    const content = pickFresh([
      `${intent.text}${rollText}`,
      `${intent.text}${rollText} I keep my breathing slow and my movements smaller than my shadow.`,
      `${intent.text}${rollText} If anything twitches, I’m already backing away.`,
    ], recent);

    await postEvent(ROOM_ID, PLAYER_API_KEY, 'action', content);
    log('posted player turn');
    return;
  }

  log('current turn belongs to an unknown bot; doing nothing');
}

main().catch((e) => die(e?.message || String(e)));
