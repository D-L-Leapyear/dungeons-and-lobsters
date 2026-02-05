export type RoomConfig = {
  /**
   * How long a turn may sit without updates before the watchdog auto-skips.
   * Used by the watcher-driven watchdog tick.
   */
  turnTimeoutSec: number;

  /**
   * How long the DM may be absent (no presence) before DM continuity marks them inactive.
   */
  dmStaleSec: number;

  /** Maximum number of PLAYER bots (DM excluded). 0/negative disables the cap. */
  maxPlayers: number;

  /** Optional tone tags (for display + future matchmaking). */
  toneTags: string[];

  /** Optional difficulty label (for display + future matchmaking). */
  difficulty: string;
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  turnTimeoutSec: 5 * 60,
  dmStaleSec: 5 * 60,
  maxPlayers: 0,
  toneTags: [],
  difficulty: '',
};

function clampInt(n: number, { min, max }: { min: number; max: number }) {
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeTag(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

/**
 * Parse a room_config payload from untrusted input.
 * Safe defaults + conservative bounds.
 */
export function parseRoomConfig(input: unknown): RoomConfig {
  const cfg = { ...DEFAULT_ROOM_CONFIG };
  if (!input || typeof input !== 'object') return cfg;

  const o = input as Record<string, unknown>;

  // timeouts (sec)
  if (typeof o.turnTimeoutSec === 'number') {
    const v = clampInt(o.turnTimeoutSec, { min: 30, max: 60 * 60 });
    if (v !== null) cfg.turnTimeoutSec = v;
  }
  if (typeof o.dmStaleSec === 'number') {
    const v = clampInt(o.dmStaleSec, { min: 30, max: 60 * 60 });
    if (v !== null) cfg.dmStaleSec = v;
  }

  // max players (DM excluded)
  if (typeof o.maxPlayers === 'number') {
    const v = clampInt(o.maxPlayers, { min: 0, max: 20 });
    if (v !== null) cfg.maxPlayers = v;
  }

  // tone tags
  if (Array.isArray(o.toneTags)) {
    const tags: string[] = [];
    for (const raw of o.toneTags.slice(0, 8)) {
      if (typeof raw !== 'string') continue;
      const t = normalizeTag(raw);
      if (t && !tags.includes(t)) tags.push(t);
    }
    cfg.toneTags = tags;
  }

  // difficulty
  if (typeof o.difficulty === 'string') {
    cfg.difficulty = o.difficulty.trim().slice(0, 40);
  }

  return cfg;
}

/**
 * Best-effort parse from DB JSONB (already trusted-ish), but still clamp.
 */
export function parseRoomConfigFromDb(input: unknown): RoomConfig {
  return parseRoomConfig(input);
}
