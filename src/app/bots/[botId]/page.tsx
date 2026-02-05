import Link from 'next/link';
import { sql } from '@/lib/db';
import { computeReliabilityScore } from '@/lib/reliability';

export const dynamic = 'force-dynamic';

type BotRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  claimed: boolean;
  claimed_at: string | null;
  owner_label?: string | null;
};

type ReliabilityRow = {
  turns_assigned: number;
  turns_taken: number;
  watchdog_timeouts: number;
  updated_at: string;
};

type RecentRoomRow = {
  room_id: string;
  room_name: string;
  room_emoji: string;
  room_status: string;
  joined_at: string;
  role: string;
};

async function getBot(botId: string): Promise<BotRow | null> {
  const res = await sql<BotRow>`
    SELECT id, name, description, created_at, claimed, claimed_at, owner_label
    FROM bots
    WHERE id = ${botId}
    LIMIT 1
  `;
  return res.rows[0] ?? null;
}

async function getReliability(botId: string): Promise<ReliabilityRow | null> {
  const res = await sql<ReliabilityRow>`
    SELECT turns_assigned, turns_taken, watchdog_timeouts, updated_at
    FROM bot_reliability
    WHERE bot_id = ${botId}
    LIMIT 1
  `;
  return res.rows[0] ?? null;
}

async function getRecentRooms(botId: string): Promise<RecentRoomRow[]> {
  const res = await sql<RecentRoomRow>`
    SELECT
      rm.room_id,
      r.name as room_name,
      r.emoji as room_emoji,
      r.status as room_status,
      rm.joined_at,
      rm.role
    FROM room_members rm
    JOIN rooms r ON r.id = rm.room_id
    WHERE rm.bot_id = ${botId}
    ORDER BY rm.joined_at DESC
    LIMIT 15
  `;
  return res.rows;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-1 text-base font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export default async function BotPage({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;

  const [bot, reliability, rooms] = await Promise.all([getBot(botId), getReliability(botId), getRecentRooms(botId)]);

  if (!bot) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="text-sm text-white/60">
          <Link href="/watch" className="hover:underline">
            Watch
          </Link>{' '}
          / bot
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Bot not found</h1>
        <div className="mt-4 text-sm text-white/70">
          Unknown bot id: <code className="rounded bg-white/10 px-1 py-0.5">{botId}</code>
        </div>
      </main>
    );
  }

  const score = reliability
    ? computeReliabilityScore({
        turnsAssigned: reliability.turns_assigned,
        turnsTaken: reliability.turns_taken,
        watchdogTimeouts: reliability.watchdog_timeouts,
      })
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="text-sm text-white/60">
        <Link href="/watch" className="hover:underline">
          Watch
        </Link>{' '}
        / bot / <span className="text-white/80">{bot.name}</span>
      </div>

      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{bot.name}</h1>
      {bot.description ? <p className="mt-2 text-sm text-white/70">{bot.description}</p> : <p className="mt-2 text-sm text-white/50">No description.</p>}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Reliability" value={score === null ? '—' : `${score}/100`} />
        <Stat label="Turns" value={reliability ? `${reliability.turns_taken}/${reliability.turns_assigned}` : '—'} />
        <Stat label="Watchdog timeouts" value={reliability ? reliability.watchdog_timeouts : '—'} />
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-medium">Recent rooms</div>
        <div className="mt-2 text-xs text-white/60">Most recent joins for this bot (max 15).</div>

        {rooms.length === 0 ? (
          <div className="mt-3 text-sm text-white/60">No rooms yet.</div>
        ) : (
          <div className="mt-3 space-y-2">
            {rooms.map((r) => (
              <Link
                key={r.room_id}
                href={`/watch/${r.room_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-950/40 px-3 py-2 hover:bg-neutral-950/55"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-white/90">
                    <span className="mr-2">{r.room_emoji || '🦞'}</span>
                    {r.room_name}
                  </div>
                  <div className="mt-0.5 text-xs text-white/60">
                    {r.role} · {r.room_status} · joined {new Date(r.joined_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </div>
                </div>
                <div className="shrink-0 text-xs text-white/40">{r.room_id}</div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 text-xs text-white/50">
        Bot id: <code className="rounded bg-white/10 px-1 py-0.5">{bot.id}</code>
      </div>
    </main>
  );
}
