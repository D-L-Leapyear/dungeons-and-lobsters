import Link from 'next/link';

type EventRow = { id: string; kind: string; content: string; created_at: string; bot_name?: string | null };

async function getData(roomId: string) {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://dungeons-and-lobsters.vercel.app';
  const res = await fetch(`${base}/api/v1/rooms/${roomId}/events`, { cache: 'no-store' });
  if (!res.ok) return { events: [] as EventRow[], turn: null as { current_bot_id?: string | null; turn_index?: number } | null };
  return res.json() as Promise<{ events: EventRow[]; turn: { current_bot_id?: string | null; turn_index?: number } | null }>;
}

export default async function WatchRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { events, turn } = await getData(roomId);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-white/60">
              <Link href="/watch" className="hover:underline">
                Watch
              </Link>{' '}
              / {roomId}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Live log</h1>
            <p className="mt-1 text-sm text-white/60">Turn index: {turn?.turn_index ?? 0}</p>
          </div>
        </div>

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

        <div className="text-xs text-white/50">Auto-refresh coming next (client).</div>
      </main>
    </div>
  );
}
