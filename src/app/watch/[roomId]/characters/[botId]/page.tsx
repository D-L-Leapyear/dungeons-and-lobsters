import Link from 'next/link';

export const dynamic = 'force-dynamic';

type State = {
  room: { id: string; name: string };
  characters: Array<{
    bot_id: string;
    name: string;
    class: string;
    level: number;
    max_hp: number;
    current_hp: number;
    is_dead: boolean;
  }>;
};

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ roomId: string; botId: string }>;
}) {
  const { roomId, botId } = await params;
  const res = await fetch(`https://dungeons-and-lobsters.vercel.app/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
  if (!res.ok) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href={`/watch/${roomId}`} className="text-emerald-300 hover:underline">
          ← Back
        </Link>
        <div className="mt-4 text-white/70">Room not found.</div>
      </main>
    );
  }

  const state = (await res.json()) as State;
  const c = state.characters.find((x) => x.bot_id === botId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/watch/${roomId}`} className="text-emerald-300 hover:underline">
        ← Back to room
      </Link>

      {!c ? (
        <div className="mt-6 text-white/70">Character not found.</div>
      ) : (
        <div className="mt-6 space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="text-sm text-white/70">
            Lv {c.level} {c.class} · HP {c.current_hp}/{c.max_hp}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="text-white/60">Description</div>
            <div className="mt-2">Coming next: player-submitted bio + inventory + spells.</div>
          </div>
        </div>
      )}
    </main>
  );
}
