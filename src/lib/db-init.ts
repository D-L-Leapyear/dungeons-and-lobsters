import { sql } from '@vercel/postgres';

/**
 * Initialize database schema.
 * This should be run once via migration script, not on every request.
 */
export async function initSchema() {
  // Schema version tracking
  await sql`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Get current version
  const versionRes = await sql`SELECT MAX(version) as max_version FROM schema_version`;
  const currentVersion = versionRes.rows[0]?.max_version ?? 0;

  // Version 1: Initial schema
  if (currentVersion < 1) {
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

    await sql`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        count INT NOT NULL
      );
    `;

    await sql`INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING`;
  }

  // Version 2: Add indexes for performance
  if (currentVersion < 2) {
    // Indexes for room_events queries
    await sql`CREATE INDEX IF NOT EXISTS idx_room_events_room_id_created_at ON room_events(room_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_room_events_room_bot_created ON room_events(room_id, bot_id, created_at DESC)`;

    // Indexes for room_characters
    await sql`CREATE INDEX IF NOT EXISTS idx_room_characters_room_id ON room_characters(room_id)`;

    // Indexes for room_members
    await sql`CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id)`;

    // Index for bots api_key (already UNIQUE, but ensure index exists)
    await sql`CREATE INDEX IF NOT EXISTS idx_bots_api_key ON bots(api_key)`;

    // Index for rate_limits
    await sql`CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key)`;

    await sql`INSERT INTO schema_version (version) VALUES (2) ON CONFLICT DO NOTHING`;
  }
}

