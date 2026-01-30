import Link from 'next/link';

type RoomRow = { id: string; name: string; created_at: string; dm_name: string };

async function getRooms() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://dungeons-and-lobsters.vercel.app';
  const res = await fetch(`${base}/api/v1/rooms`, { cache: 'no-store' });
  if (!res.ok) return { rooms: [] as RoomRow[] };
  return res.json() as Promise<{ rooms: RoomRow[] }>;
}

export default async function WatchIndexPage() {
  const { rooms } = await getRooms();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Watch</h1>
        <p className="mt-2 text-white/70">Live rooms (v0).</p>

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
                <div className="text-sm font-medium">{r.name}</div>
                <div className="mt-1 text-xs text-white/60">
                  DM: {r.dm_name} · {new Date(r.created_at).toLocaleString()}
                </div>
              </Link>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
