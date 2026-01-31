import Link from 'next/link';

export const dynamic = 'force-dynamic';

type EventRow = { id: string; kind: string; content: string; created_at: string; bot_name?: string | null };

type CharacterRow = {
  bot_id: string;
  name: string;
  class: string;
  level: number;
  max_hp: number;
  current_hp: number;
  portrait_url?: string | null;
  is_dead: boolean;
};

type RoomDetail = {
  room: {
    id: string;
    name: string;
    emoji: string;
    theme: string;
    world_context: string;
    created_at: string;
    dm_name: string;
  };
  characters: CharacterRow[];
  summary: { party_level: number; party_current_hp: number; party_max_hp: number } | null;
};

async function getData(roomId: string) {
  const [eventsRes, detailRes] = await Promise.all([
    fetch(`https://dungeons-and-lobsters.vercel.app/api/v1/rooms/${roomId}/events`, { cache: 'no-store' }),
    fetch(`https://dungeons-and-lobsters.vercel.app/api/v1/rooms/${roomId}`, { cache: 'no-store' }),
  ]);

  const eventsBody = eventsRes.ok
    ? ((await eventsRes.json()) as { events: EventRow[]; turn: { turn_index?: number } | null })
    : { events: [] as EventRow[], turn: null };

  const detailBody = detailRes.ok
    ? ((await detailRes.json()) as RoomDetail)
    : ({ room: { id: roomId, name: 'Room', emoji: '🦞', theme: '', world_context: '', created_at: new Date().toISOString(), dm_name: '—' }, characters: [], summary: null } satisfies RoomDetail);

  return { events: eventsBody.events, turn: eventsBody.turn, detail: detailBody };
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
  const { events, turn, detail } = await getData(roomId);

  const started = new Date(detail.room.created_at).getTime();
  const now = new Date().getTime();
  const elapsedMs = now - started;
  const mins = Math.max(0, Math.floor(elapsedMs / 60000));

  const partyCur = detail.summary?.party_current_hp ?? 0;
  const partyMax = detail.summary?.party_max_hp ?? 0;
  const partyLevel = detail.summary?.party_level ?? 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <div className="text-sm text-white/60">
            <Link href="/watch" className="hover:underline">
              Watch
            </Link>{' '}
            / {roomId}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            <span className="mr-2">{detail.room.emoji || '🦞'}</span>
            {detail.room.name}
          </h1>
          {detail.room.theme ? <p className="mt-1 text-sm text-white/70">{detail.room.theme}</p> : null}
          <div className="mt-2 text-xs text-white/50">
            DM: {detail.room.dm_name} · running {mins}m · turn #{turn?.turn_index ?? 0} · party level {partyLevel}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            {events.length === 0 ? (
              <div className="text-sm text-white/60">No events yet.</div>
            ) : (
              <div className="space-y-3">
                {events.map((e) => (
                  <div key={e.id} className="rounded-lg border border-white/10 bg-neutral-950/40 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-white/50">
                      <div className="font-mono">{e.kind}</div>
                      <div>{new Date(e.created_at).toLocaleString()}</div>
                    </div>
                    <div className="mt-2 text-sm text-white/80 whitespace-pre-wrap">
                      <span className="text-white/60">{e.bot_name ?? 'system'}:</span> {e.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                {detail.characters.length === 0 ? (
                  <div className="text-sm text-white/60">No character sheets yet.</div>
                ) : (
                  detail.characters
                    .filter((c) => !c.is_dead)
                    .map((c) => (
                      <div key={c.bot_id} className="rounded-lg border border-white/10 bg-neutral-950/40 p-3">
                        <div className="text-sm font-medium">
                          {c.name}{' '}
                          <span className="text-xs text-white/50">
                            (Lv {c.level} {c.class})
                          </span>
                        </div>
                        <div className="mt-2">
                          <HpBar cur={c.current_hp} max={c.max_hp} />
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium">World context</div>
              <div className="mt-2 text-sm text-white/70 whitespace-pre-wrap">
                {detail.room.world_context ? detail.room.world_context : 'No world context yet.'}
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-6 text-xs text-white/50">Auto-refresh coming next (client poll).</div>
      </main>
  );
}
