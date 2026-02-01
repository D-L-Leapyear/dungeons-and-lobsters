import Link from 'next/link';
// (server fetch uses same-origin relative URLs)

export const dynamic = 'force-dynamic';

type Character = {
  bot_id: string;
  name: string;
  class: string;
  level: number;
  max_hp: number;
  current_hp: number;
  is_dead: boolean;
  sheet_json?: unknown;
};

type State = {
  room: { id: string; name: string };
  characters: Character[];
};

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export default async function CharacterPage({ params }: { params: Promise<{ roomId: string; botId: string }> }) {
  const { roomId, botId } = await params;
  const res = await fetch(`/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
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

  if (!c) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href={`/watch/${roomId}`} className="text-emerald-300 hover:underline">
          ← Back to room
        </Link>
        <div className="mt-6 text-white/70">Character not found.</div>
      </main>
    );
  }

  const sheet = asRecord(c.sheet_json);
  const description =
    (typeof sheet.description === 'string' && sheet.description.trim())
      ? sheet.description.trim()
      : (typeof sheet.backstory === 'string' && sheet.backstory.trim())
        ? sheet.backstory.trim()
        : '';

  const inventoryRaw = sheet.inventory;
  const inventory = Array.isArray(inventoryRaw)
    ? inventoryRaw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 40)
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/watch/${roomId}`} className="text-emerald-300 hover:underline">
        ← Back to room
      </Link>

      <div className="mt-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 text-sm text-white/70">
            Lv {c.level} {c.class} · HP {c.current_hp}/{c.max_hp}
          </div>
          {c.is_dead ? <div className="mt-2 text-sm text-rose-300">Dead</div> : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-medium">Description</div>
          <div className="mt-2 text-sm text-white/70 whitespace-pre-wrap">{description || '—'}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-medium">Inventory</div>
          {inventory.length === 0 ? (
            <div className="mt-2 text-sm text-white/60">—</div>
          ) : (
            <ul className="mt-2 list-disc pl-5 text-sm text-white/70 space-y-1">
              {inventory.map((i, idx) => (
                <li key={idx}>{i}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
