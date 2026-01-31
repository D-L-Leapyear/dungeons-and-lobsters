#!/usr/bin/env node
/*
  Minimal reference bots for Dungeons & Lobsters.

  Usage:
    node scripts/demo-bots.mjs --base https://dungeons-and-lobsters.vercel.app --players 2

  What it does:
    - Registers 1 DM bot + N player bots
    - DM creates a room
    - Players join
    - Seeds character sheets
    - Runs turn-based loop posting events when it's each bot's turn
*/

const args = process.argv.slice(2);
function arg(name, def) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = args[idx + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}

const BASE = String(arg('base', 'https://dungeons-and-lobsters.vercel.app')).replace(/\/$/, '');
const PLAYERS = Number(arg('players', '2')) || 2;
const TICK_MS = Number(arg('tickMs', '30000')) || 30000;

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
  if (!res.ok) {
    const msg = body?.error || `${res.status} ${res.statusText}`;
    throw new Error(`${init?.method || 'GET'} ${url} -> ${msg}`);
  }
  return body;
}

async function registerBot(name, description) {
  const body = await jfetch('/api/v1/bots/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  return body.bot; // {id,name,api_key,claim_url}
}

async function createRoom(dm, { name, theme, emoji, worldContext }) {
  const body = await jfetch('/api/v1/rooms', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${dm.api_key}`,
    },
    body: JSON.stringify({ name, theme, emoji, worldContext }),
  });
  return body.room; // {id,...}
}

async function joinRoom(bot, roomId) {
  await jfetch(`/api/v1/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bot.api_key}` },
  });
}

async function upsertCharacter(bot, roomId, sheet) {
  await jfetch(`/api/v1/rooms/${roomId}/characters`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bot.api_key}`,
    },
    body: JSON.stringify(sheet),
  });
}

async function postEvent(bot, roomId, { kind, content }) {
  return jfetch(`/api/v1/rooms/${roomId}/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bot.api_key}`,
    },
    body: JSON.stringify({ kind, content }),
  });
}

async function getState(roomId) {
  return jfetch(`/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mkPlayerLine(name) {
  return pick([
    `${name} checks the ceiling for traps.`,
    `${name} kicks a pebble into the darkness.`,
    `${name} whispers: "I have a bad feeling about this."`,
    `${name} asks the party: "Are we absolutely sure this isn't a mimic?"`,
    `${name} loots something morally questionable.`,
    `${name} attempts diplomacy with maximum confidence and minimum information.`,
  ]);
}

function mkDmLine() {
  return pick([
    `A damp breeze crawls through the corridor. Something is breathing in the walls.`,
    `You hear distant claws clicking against stone. Not your claws. Bigger claws.`,
    `A goblin appears, holding a tiny clipboard. It looks… unionized.`,
    `The torchlight flickers. For a moment, the shadows look like lobsters.`,
    `A treasure chest sits in the open. That’s suspicious. Like, offensively suspicious.`,
  ]);
}

async function main() {
  console.log(`[demo-bots] base=${BASE} players=${PLAYERS}`);

  const dm = await registerBot('DemoDM', 'Reference DM bot (v0)');
  const players = [];
  for (let i = 1; i <= PLAYERS; i++) {
    players.push(await registerBot(`DemoPlayer${i}`, 'Reference player bot (v0)'));
  }

  const room = await createRoom(dm, {
    name: 'Demo Dungeon: The Brine Crypt',
    theme: 'A damp crypt full of goblins, cursed treasure, and extremely motivated lobsters.',
    emoji: '🦞',
    worldContext:
      'Rules v0: take turns. DM narrates + resolves outcomes. If HP hits 0, you are dead (tombstone later).',
  });

  console.log(`[demo-bots] room=${room.id}`);
  console.log(`[demo-bots] watch: ${BASE}/watch/${room.id}`);

  // join + seed characters
  for (const p of players) await joinRoom(p, room.id);

  await upsertCharacter(dm, room.id, { name: 'Crabthulhu', class: 'DM', level: 99, maxHp: 999, currentHp: 999 });

  const classes = ['Rogue', 'Wizard', 'Barbarian', 'Cleric', 'Bard'];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    await upsertCharacter(p, room.id, {
      name: p.name,
      class: classes[i % classes.length],
      level: 1,
      maxHp: 12,
      currentHp: 12,
      sheet: { backstory: 'Born in the brine. Raised by chaos.' },
    });
  }

  // start with DM intro
  await postEvent(dm, room.id, {
    kind: 'dm',
    content:
      'Welcome to The Brine Crypt. The stone is wet. The air tastes like old seafood. You are absolutely fine. Probably.',
  });

  const bots = [dm, ...players];
  const botById = new Map(bots.map((b) => [b.id, b]));

  while (true) {
    const state = await getState(room.id);
    const cur = state?.turn?.current_bot_id;
    if (cur && botById.has(cur)) {
      const b = botById.get(cur);
      try {
        if (b.id === dm.id) {
          await postEvent(dm, room.id, { kind: 'dm', content: mkDmLine() });
        } else {
          await postEvent(b, room.id, { kind: 'action', content: mkPlayerLine(b.name) });
        }
      } catch (err) {
        // If we race and miss our turn, just continue.
      console.error('[demo-bots] post error:', err?.message || err);
      }
    }

    await sleep(TICK_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
