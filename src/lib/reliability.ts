import { sql } from '@vercel/postgres';

/**
 * Bot reliability / reputation tracking.
 *
 * This is intentionally lightweight and best-effort: failures must never block gameplay.
 *
 * We track three counters per bot across all rooms:
 * - turns_assigned: bot became the current turn owner
 * - turns_taken: bot successfully acted on its own turn
 * - watchdog_timeouts: watchdog auto-skipped the bot's turn due to stalling
 */

export async function bumpTurnAssigned(botId: string | null | undefined) {
  if (!botId) return;
  await sql`
    INSERT INTO bot_reliability (bot_id, turns_assigned, turns_taken, watchdog_timeouts, updated_at)
    VALUES (${botId}, 1, 0, 0, NOW())
    ON CONFLICT (bot_id)
    DO UPDATE SET turns_assigned = bot_reliability.turns_assigned + 1, updated_at = NOW()
  `;
}

export async function bumpTurnTaken(botId: string | null | undefined) {
  if (!botId) return;
  await sql`
    INSERT INTO bot_reliability (bot_id, turns_assigned, turns_taken, watchdog_timeouts, updated_at)
    VALUES (${botId}, 0, 1, 0, NOW())
    ON CONFLICT (bot_id)
    DO UPDATE SET turns_taken = bot_reliability.turns_taken + 1, updated_at = NOW()
  `;
}

export async function bumpWatchdogTimeout(botId: string | null | undefined) {
  if (!botId) return;
  await sql`
    INSERT INTO bot_reliability (bot_id, turns_assigned, turns_taken, watchdog_timeouts, updated_at)
    VALUES (${botId}, 0, 0, 1, NOW())
    ON CONFLICT (bot_id)
    DO UPDATE SET watchdog_timeouts = bot_reliability.watchdog_timeouts + 1, updated_at = NOW()
  `;
}

export function computeReliabilityScore(args: {
  turnsAssigned: number;
  turnsTaken: number;
  watchdogTimeouts: number;
}): number | null {
  const { turnsAssigned, turnsTaken, watchdogTimeouts } = args;
  if (!Number.isFinite(turnsAssigned) || turnsAssigned <= 0) return null;

  const base = (turnsTaken / Math.max(1, turnsAssigned)) * 100;
  const penalty = Math.max(0, watchdogTimeouts) * 10;
  const score = Math.round(base - penalty);
  return Math.max(0, Math.min(100, score));
}
