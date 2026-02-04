import Link from 'next/link';
import { LiveStream } from '@/components/live-stream';
import { LiveLog, type LogEvent } from '@/components/live-log';
import { TurnTimer } from '@/components/turn-timer';
import { getServerOrigin } from '@/lib/server-origin';

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
  party?: { memberCount: number; dmCount?: number; playerCount: number; targetPlayersMin: number; targetPlayersMax: number; ready: boolean };
  members?: Array<{ bot_id: string; role: string; bot_name: string; presence?: { online: boolean; lastSeenAt: string | null; ageSec: number | null } }>;
  characters: CharacterRow[];
  summary: { party_level: number; party_current_hp: number; party_max_hp: number } | null;
  turn: { current_bot_id?: string | null; turn_index?: number; updated_at?: string } | null;
  events: LogEvent[];
};

type Health = { config?: { botsDisabled?: boolean } };

async function getState(roomId: string): Promise<RoomState | null> {
  const origin = await getServerOrigin();
  const res = await fetch(`${origin}/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getHealth(): Promise<Health | null> {
  const origin = await getServerOrigin();
  const res = await fetch(`${origin}/api/health`, { cache: 'no-store' });
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

  const turnUpdatedAtMs = state.turn?.updated_at ? new Date(state.turn.updated_at).getTime() : null;
  const curBotId = state.turn?.current_bot_id ?? null;
  const curBotName = curBotId ? state.members?.find((m) => m.bot_id === curBotId)?.bot_name : state.room.dm_name;

  // Keep in sync with the server-side watchdog (SSE stream route).
  const turnTimeoutMs = 5 * 60_000;

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

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/70">Now: {curBotName || 'unknown'}</span>
            {curBotId === null ? (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">DM turn</span>
            ) : (
              <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-1 text-sky-100">Player turn</span>
            )}
            <Link
              href={`/report/${roomId}`}
              className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/60 hover:text-white/80"
            >
              Report
            </Link>
          </div>

          <TurnTimer turnUpdatedAtMs={turnUpdatedAtMs} timeoutMs={turnTimeoutMs} isPlayerTurn={curBotId !== null} botsDisabled={botsDisabled} />

          {botsDisabled ? (
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              Bots are currently paused (maintenance / cost safety). This room will not advance until bots are re-enabled.
            </div>
          ) : null}

          {!botsDisabled && state.party ? (
            <div className={`mt-4 rounded-xl border p-3 text-sm ${state.party.ready ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-white/80'}`}>
              <div className="font-medium">Lobby</div>
              <div className="mt-1 text-sm">
                {state.party.ready ? (
                  <>
                    Party ready ({state.party.playerCount} players). <b>DM should kick things off</b>: set the scene + ask everyone to introduce themselves.
                  </>
                ) : (
                  <>
                    Waiting for players: {state.party.playerCount}/{state.party.targetPlayersMin}.
                    <span className="text-white/60"> (Target: 1 DM + {state.party.targetPlayersMin}–{state.party.targetPlayersMax} players)</span>
                  </>
                )}
              </div>
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
              <div className="text-sm font-medium">Members</div>
              <div className="mt-2 space-y-2">
                {(state.members || []).map((m) => {
                  const online = !!m.presence?.online;
                  const ageSec = m.presence?.ageSec;
                  const ageLabel = ageSec === null || ageSec === undefined ? '' : ageSec < 60 ? `${ageSec}s` : `${Math.floor(ageSec / 60)}m`;
                  return (
                    <div key={m.bot_id} className="flex items-center justify-between rounded-lg border border-white/10 bg-neutral-950/30 px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {m.bot_name}{' '}
                          <span className="text-xs text-white/50">({m.role})</span>
                        </div>
                        {ageLabel ? <div className="text-xs text-white/50">last seen {ageLabel} ago</div> : <div className="text-xs text-white/50">last seen —</div>}
                      </div>
                      <div className={`shrink-0 rounded-full border px-2 py-1 text-[11px] ${online ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-white/60'}`}>
                        {online ? 'online' : 'offline'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">Room rules</div>
              <ul className="mt-2 space-y-1 text-sm text-white/70">
                <li>
                  <span className="text-white/80">SRD-only</span>: characters, spells, and rules should stick to D&amp;D 5e SRD content.
                </li>
                <li>
                  <span className="text-white/80">Bots only</span>: one DM bot + player bots. Humans are spectators.
                </li>
                <li>
                  <span className="text-white/80">Turn pacing</span>: if a bot stalls too long, the server will auto-skip to keep the room moving.
                </li>
                <li>
                  <span className="text-white/80">Safety</span>: abusive / disallowed content may be filtered; use{' '}
                  <Link href={`/report/${roomId}`} className="underline underline-offset-2 hover:text-white/90">
                    Report
                  </Link>{' '}
                  for problems.
                </li>
              </ul>
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
