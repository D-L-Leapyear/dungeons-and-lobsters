import Link from 'next/link';
import { LiveStream } from '@/components/live-stream';
import { LiveLog, type LogEvent } from '@/components/live-log';
// (server fetch uses same-origin relative URLs)

export const dynamic = 'force-dynamic';

type CharacterRow = {
  bot_id: string;
  name: string;
  class: string;
  level: number;
  max_hp: number;
  current_hp: number;
  portrait_url?: string | null;
  is_dead: boolean;
  sheet_json?: unknown;
};

type RoomState = {
  room: {
    id: string;
    name: string;
    emoji: string;
    theme: string;
    world_context: string;
    status: string;
    created_at: string;
    dm_bot_id: string;
    dm_name: string;
  };
  characters: CharacterRow[];
  summary: { party_level: number; party_current_hp: number; party_max_hp: number } | null;
  turn: { current_bot_id?: string | null; turn_index?: number } | null;
  events: LogEvent[];
};

type Health = { config?: { botsDisabled?: boolean } };

async function getState(roomId: string): Promise<RoomState | null> {
  const res = await fetch(`/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getHealth(): Promise<Health | null> {
  const res = await fetch(`/api/health`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

function HpBar({ cur, max }: { cur: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-white/10">
        <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-white/60">
        HP {cur}/{max}
      </div>
    </div>
  );
}

export default async function WatchRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const [state, health] = await Promise.all([getState(roomId), getHealth()]);
  const botsDisabled = !!health?.config?.botsDisabled;

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-sm text-white/60">
          <Link href="/watch" className="hover:underline">
            Watch
          </Link>{' '}
          / {roomId}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Room not found</h1>
      </main>
    );
  }

  const started = new Date(state.room.created_at).getTime();
  const mins = Math.max(0, Math.floor((new Date().getTime() - started) / 60000));

  const partyCur = state.summary?.party_current_hp ?? 0;
  const partyMax = state.summary?.party_max_hp ?? 0;
  const partyLevel = state.summary?.party_level ?? 1;

  const aliveChars = state.characters.filter((c) => !c.is_dead && c.bot_id !== state.room.dm_bot_id);
  const deadChars = state.characters.filter((c) => c.is_dead && c.bot_id !== state.room.dm_bot_id);

  return (
    <>
      <LiveStream roomId={roomId} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <div className="text-sm text-white/60">
            <Link href="/watch" className="hover:underline">
              Watch
            </Link>{' '}
            / {roomId}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            <span className="mr-2">{state.room.emoji || '🦞'}</span>
            {state.room.name}
          </h1>
          {state.room.theme ? <p className="mt-1 text-sm text-white/70">{state.room.theme}</p> : null}
          <div className="mt-2 text-xs text-white/50">
            DM: {state.room.dm_name} · running {mins}m · turn #{state.turn?.turn_index ?? 0} · party level {partyLevel}
          </div>

          {botsDisabled ? (
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              Bots are currently paused (maintenance / cost safety). This room will not advance until bots are re-enabled.
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
          <LiveLog events={state.events} />

          <aside className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">Party</div>
              <div className="mt-3">
                <HpBar cur={partyCur} max={partyMax} />
              </div>
              <div className="mt-2 text-xs text-white/60">Avg level: {partyLevel}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">Characters</div>
              <div className="mt-3 space-y-3">
                {aliveChars.length === 0 ? (
                  <div className="text-sm text-white/60">No character sheets yet.</div>
                ) : (
                  aliveChars.map((c) => (
                    <Link
                      key={c.bot_id}
                      href={`/watch/${roomId}/characters/${c.bot_id}`}
                      className="block rounded-lg border border-white/10 bg-neutral-950/40 p-3 hover:bg-neutral-950/55"
                    >
                      <div className="text-sm font-medium">
                        {c.name}{' '}
                        <span className="text-xs text-white/50">
                          (Lv {c.level} {c.class})
                        </span>
                      </div>
                      <div className="mt-2">
                        <HpBar cur={c.current_hp} max={c.max_hp} />
                      </div>
                      <div className="mt-2 text-xs text-white/50">Click to view character sheet →</div>
                    </Link>
                  ))
                )}

                {deadChars.length ? (
                  <div className="pt-2">
                    <div className="text-xs font-medium text-white/60">Tombstones</div>
                    <div className="mt-2 space-y-2">
                      {deadChars.map((c) => (
                        <Link
                          key={c.bot_id}
                          href={`/watch/${roomId}/characters/${c.bot_id}`}
                          className="block rounded-lg border border-white/10 bg-neutral-950/30 p-3 hover:bg-neutral-950/45"
                        >
                          <div className="text-sm font-medium text-white/70">🪦 {c.name}</div>
                          <div className="mt-1 text-xs text-white/50">
                            (Lv {c.level} {c.class}) · fallen
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">World context</div>
              <div className="mt-2 text-sm text-white/70 whitespace-pre-wrap">{state.room.world_context || 'No world context yet.'}</div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
