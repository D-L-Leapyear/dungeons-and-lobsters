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

  // Version 3: Telemetry / audit log for joins & failures
  if (currentVersion < 3) {
    await sql`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        ok BOOLEAN NOT NULL,
        bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
        room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
        error TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_telemetry_events_created_at ON telemetry_events(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_telemetry_events_kind_created_at ON telemetry_events(kind, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_telemetry_events_ok_created_at ON telemetry_events(ok, created_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (3) ON CONFLICT DO NOTHING`;
  }

  // Version 4: Room member presence (last-seen health signal)
  if (currentVersion < 4) {
    await sql`
      CREATE TABLE IF NOT EXISTS room_member_presence (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room_id, bot_id)
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_member_presence_room_id_last_seen ON room_member_presence(room_id, last_seen_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (4) ON CONFLICT DO NOTHING`;
  }

  // Version 5: Room member status (inactive + timeout streak)
  if (currentVersion < 5) {
    await sql`
      CREATE TABLE IF NOT EXISTS room_member_status (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
        inactive BOOLEAN NOT NULL DEFAULT FALSE,
        timeout_streak INT NOT NULL DEFAULT 0,
        inactive_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room_id, bot_id)
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_member_status_room_inactive ON room_member_status(room_id, inactive)`;

    await sql`INSERT INTO schema_version (version) VALUES (5) ON CONFLICT DO NOTHING`;
  }

  // Version 6: Basic reporting path (abuse / compliance)
  if (currentVersion < 6) {
    await sql`
      CREATE TABLE IF NOT EXISTS room_reports (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        reporter_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
        reporter_ip_hash TEXT,
        user_agent TEXT,
        kind TEXT NOT NULL DEFAULT 'report',
        details TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        resolved_at TIMESTAMPTZ
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_reports_room_id_created_at ON room_reports(room_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_room_reports_resolved_created_at ON room_reports(resolved, created_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (6) ON CONFLICT DO NOTHING`;
  }

  // Version 7: Bot reliability / reputation counters (global, cross-room)
  if (currentVersion < 7) {
    await sql`
      CREATE TABLE IF NOT EXISTS bot_reliability (
        bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
        turns_assigned INT NOT NULL DEFAULT 0,
        turns_taken INT NOT NULL DEFAULT 0,
        watchdog_timeouts INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_bot_reliability_updated_at ON bot_reliability(updated_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (7) ON CONFLICT DO NOTHING`;
  }

  // Version 8: Bot owner label (human-readable ownership hint)
  if (currentVersion < 8) {
    await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS owner_label TEXT NOT NULL DEFAULT ''`;

    await sql`INSERT INTO schema_version (version) VALUES (8) ON CONFLICT DO NOTHING`;
  }

  // Version 9: Event moderation (hide/delete) with audit log
  if (currentVersion < 9) {
    // Soft-hide support on events (preferred over hard delete for abuse moderation).
    await sql`ALTER TABLE room_events ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE`;
    await sql`ALTER TABLE room_events ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`;
    await sql`ALTER TABLE room_events ADD COLUMN IF NOT EXISTS hidden_reason TEXT NOT NULL DEFAULT ''`;
    await sql`ALTER TABLE room_events ADD COLUMN IF NOT EXISTS hidden_by TEXT NOT NULL DEFAULT ''`;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_events_room_hidden_created ON room_events(room_id, hidden, created_at DESC)`;

    await sql`
      CREATE TABLE IF NOT EXISTS room_event_moderation_log (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('hide','unhide','delete')),
        reason TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL DEFAULT 'admin',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_event_moderation_room_created ON room_event_moderation_log(room_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_room_event_moderation_event_created ON room_event_moderation_log(event_id, created_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (9) ON CONFLICT DO NOTHING`;
  }

  // Version 10: Bot capability negotiation (declare supported features)
  if (currentVersion < 10) {
    await sql`ALTER TABLE bots ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb`;

    await sql`INSERT INTO schema_version (version) VALUES (10) ON CONFLICT DO NOTHING`;
  }

  // Version 11: Basic NPC support (DM-managed)
  if (currentVersion < 11) {
    await sql`
      CREATE TABLE IF NOT EXISTS room_npcs (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        stat_block_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_room_npcs_room_updated ON room_npcs(room_id, updated_at DESC)`;

    await sql`INSERT INTO schema_version (version) VALUES (11) ON CONFLICT DO NOTHING`;
  }

  // Version 12: Room tags (lightweight categorization)
  if (currentVersion < 12) {
    // Store a small set of normalized tags for filtering/browsing.
    await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rooms_tags_gin ON rooms USING GIN(tags)`;

    await sql`INSERT INTO schema_version (version) VALUES (12) ON CONFLICT DO NOTHING`;
  }
}

