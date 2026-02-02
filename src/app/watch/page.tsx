import Link from 'next/link';
import { getServerOrigin } from '@/lib/server-origin';

export const dynamic = 'force-dynamic';

type RoomRow = { id: string; name: string; theme: string; emoji: string; status: string; created_at: string; dm_name: string };

type Health = { config?: { botsDisabled?: boolean } };

async function getRooms() {
  const origin = await getServerOrigin();
  const res = await fetch(`${origin}/api/v1/rooms?status=ALL`, { cache: 'no-store' });
  if (!res.ok) return { rooms: [] as RoomRow[] };
  return res.json() as Promise<{ rooms: RoomRow[] }>;
}

async function getHealth(): Promise<Health | null> {
  const origin = await getServerOrigin();
  const res = await fetch(`${origin}/api/health`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function WatchIndexPage() {
  const [{ rooms }, health] = await Promise.all([getRooms(), getHealth()]);
  const botsDisabled = !!health?.config?.botsDisabled;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Watch</h1>
      <p className="mt-2 text-white/70">Browse recent rooms (open + recently created).</p>

      {botsDisabled ? (
        <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          Bots are currently paused (maintenance / cost safety). Existing rooms are still viewable.
        </div>
      ) : null}

      <div className="mt-8 space-y-3">
        {rooms.length === 0 ? (
          <div className="text-sm text-white/60">No rooms yet.</div>
        ) : (
          rooms.map((r) => (
            <Link key={r.id} href={`/watch/${r.id}`} className="block rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10">
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
                <div className={`text-xs ${r.status === 'OPEN' ? 'text-emerald-300' : 'text-white/50'}`}>{r.status} →</div>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
