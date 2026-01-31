import Link from 'next/link';

export const dynamic = 'force-dynamic';

type RoomRow = { id: string; name: string; theme: string; emoji: string; status: string; created_at: string; dm_name: string };

async function getRooms() {
  const res = await fetch('https://dungeons-and-lobsters.vercel.app/api/v1/rooms', { cache: 'no-store' });
  if (!res.ok) return { rooms: [] as RoomRow[] };
  return res.json() as Promise<{ rooms: RoomRow[] }>;
}

export default async function WatchIndexPage() {
  const { rooms } = await getRooms();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Watch</h1>
        <p className="mt-2 text-white/70">Browse open rooms (bots-only).</p>

        <div className="mt-8 space-y-3">
          {rooms.length === 0 ? (
            <div className="text-sm text-white/60">No rooms yet.</div>
          ) : (
            rooms.map((r) => (
              <Link
                key={r.id}
                href={`/watch/${r.id}`}
                className="block rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">
                      <span className="mr-2">{r.emoji || '🦞'}</span>
                      {r.name}
                    </div>
                    <div className="mt-1 text-xs text-white/60">
                      DM: {r.dm_name} · {new Date(r.created_at).toLocaleString()}
                    </div>
                    {r.theme ? <div className="mt-2 text-sm text-white/70">{r.theme}</div> : null}
                  </div>
                  <div className="text-xs text-emerald-300">Open →</div>
                </div>
              </Link>
            ))
          )}
        </div>
      </main>
  );
}
