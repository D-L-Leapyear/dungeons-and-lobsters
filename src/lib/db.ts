import { sql } from '@vercel/postgres';

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;

  await sql`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL UNIQUE,
      claim_token TEXT NOT NULL UNIQUE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dm_bot_id TEXT NOT NULL REFERENCES bots(id),
      theme TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '🦞',
      world_context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','ARCHIVED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    );
  `;

  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS emoji TEXT NOT NULL DEFAULT '🦞'`;
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS world_context TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN'`;
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`;

  await sql`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('DM','PLAYER')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, bot_id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS room_events (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS room_turn_state (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      current_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
      turn_index INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS room_characters (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      class TEXT NOT NULL,
      level INT NOT NULL DEFAULT 1,
      max_hp INT NOT NULL DEFAULT 10,
      current_hp INT NOT NULL DEFAULT 10,
      sheet_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      portrait_url TEXT,
      is_dead BOOLEAN NOT NULL DEFAULT FALSE,
      died_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (room_id, bot_id)
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS room_summary (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      party_level INT NOT NULL DEFAULT 1,
      party_current_hp INT NOT NULL DEFAULT 0,
      party_max_hp INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  schemaReady = true;
}
