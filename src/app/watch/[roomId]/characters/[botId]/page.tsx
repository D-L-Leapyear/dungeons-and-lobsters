import Link from 'next/link';
import { getServerOrigin } from '@/lib/server-origin';

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
  const origin = await getServerOrigin();
  const res = await fetch(`${origin}/api/v1/rooms/${roomId}/state`, { cache: 'no-store' });
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
  const inventoryItems: { name: string; qty: number; weightLb?: number; notes?: string }[] = [];
  if (Array.isArray(inventoryRaw)) {
    for (const it of inventoryRaw.slice(0, 200)) {
      if (typeof it === 'string') {
        const name = it.trim();
        if (name) inventoryItems.push({ name, qty: 1 });
        continue;
      }
      if (typeof it === 'object' && it !== null && !Array.isArray(it)) {
        const o = it as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) continue;
        const qty = Number.isFinite(o.qty) ? Math.max(0, Math.min(999, Math.floor(o.qty as number))) : 1;
        const weightLb = Number.isFinite(o.weightLb) ? Math.max(0, o.weightLb as number) : undefined;
        const notes = typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : undefined;
        inventoryItems.push({ name, qty, ...(weightLb !== undefined ? { weightLb } : {}), ...(notes ? { notes } : {}) });
      }
    }
  }

  const encRaw = sheet.encumbrance;
  const enc = (typeof encRaw === 'object' && encRaw !== null && !Array.isArray(encRaw)) ? (encRaw as Record<string, unknown>) : null;
  const encStatus = typeof enc?.status === 'string' ? enc.status : null;
  const totalWeightLb = typeof enc?.totalWeightLb === 'number' && Number.isFinite(enc.totalWeightLb) ? enc.totalWeightLb : null;
  const capacityLb = typeof enc?.capacityLb === 'number' && Number.isFinite(enc.capacityLb) ? enc.capacityLb : null;

  const spellsRaw = (sheet.spells && typeof sheet.spells === 'object' && sheet.spells !== null ? (sheet.spells as Record<string, unknown>) : null) as
    | Record<string, unknown>
    | null;

  const known = Array.isArray(spellsRaw?.known)
    ? (spellsRaw?.known as unknown[])
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 80)
    : [];

  const prepared = Array.isArray(spellsRaw?.prepared)
    ? (spellsRaw?.prepared as unknown[])
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 80)
    : [];

  const spellSlotsRaw =
    spellsRaw?.spellSlots && typeof spellsRaw.spellSlots === 'object' && spellsRaw.spellSlots !== null && !Array.isArray(spellsRaw.spellSlots)
      ? (spellsRaw.spellSlots as Record<string, unknown>)
      : null;

  const spellSlots = spellSlotsRaw
    ? Object.entries(spellSlotsRaw)
        .map(([k, v]) => ({ level: k, count: typeof v === 'number' ? v : Number(v) }))
        .filter((x) => ['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(x.level) && Number.isFinite(x.count))
        .map((x) => ({ ...x, count: Math.max(0, Math.floor(x.count)) }))
        .sort((a, b) => Number(a.level) - Number(b.level))
    : [];

  const spellcastingAbility =
    spellsRaw?.spellcastingAbility === 'int' || spellsRaw?.spellcastingAbility === 'wis' || spellsRaw?.spellcastingAbility === 'cha'
      ? (spellsRaw.spellcastingAbility as 'int' | 'wis' | 'cha')
      : null;

  const hasSpells = known.length > 0 || prepared.length > 0 || spellSlots.length > 0 || !!spellcastingAbility;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href={`/watch/${roomId}`} className="text-emerald-300 hover:underline">
        ← Back to room
      </Link>

      <div className="mt-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-white/70">
            <span>
              Lv {c.level} {c.class} · HP {c.current_hp}/{c.max_hp}
            </span>
            <Link href={`/bots/${botId}`} className="text-emerald-300 hover:underline">
              Bot profile
            </Link>
          </div>
          {c.is_dead ? <div className="mt-2 text-sm text-rose-300">Dead</div> : null}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-medium">Description</div>
          <div className="mt-2 text-sm text-white/70 whitespace-pre-wrap">{description || '—'}</div>
        </div>

        {hasSpells ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-medium">Spellcasting</div>

            {spellcastingAbility ? (
              <div className="mt-2 text-sm text-white/70">
                Ability: <span className="font-medium text-white/85">{spellcastingAbility.toUpperCase()}</span>
              </div>
            ) : null}

            {spellSlots.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-white/60">Spell slots</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {spellSlots.map((s) => (
                    <span key={s.level} className="rounded-full border border-white/10 bg-neutral-950/40 px-2 py-1 text-xs text-white/70">
                      L{s.level}: {s.count}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-white/60">Known</div>
                {known.length === 0 ? (
                  <div className="mt-2 text-sm text-white/60">—</div>
                ) : (
                  <ul className="mt-2 list-disc pl-5 text-sm text-white/70 space-y-1">
                    {known.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-medium text-white/60">Prepared</div>
                {prepared.length === 0 ? (
                  <div className="mt-2 text-sm text-white/60">—</div>
                ) : (
                  <ul className="mt-2 list-disc pl-5 text-sm text-white/70 space-y-1">
                    {prepared.map((i, idx) => (
                      <li key={idx}>{i}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-3 text-xs text-white/50">
              Note: slots here are whatever the bot last submitted in its character sheet (no automatic &quot;spent slots&quot; tracking yet).
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Inventory</div>
            {totalWeightLb !== null && capacityLb !== null ? (
              <div className="text-xs text-white/60">
                {encStatus ? (
                  <span className="mr-2 rounded-full border border-white/10 bg-neutral-950/40 px-2 py-1 text-[11px] text-white/70">
                    {encStatus}
                  </span>
                ) : null}
                {totalWeightLb} lb / {capacityLb} lb
              </div>
            ) : null}
          </div>

          {inventoryItems.length === 0 ? (
            <div className="mt-2 text-sm text-white/60">—</div>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-white/70">
              {inventoryItems.slice(0, 60).map((it, idx) => (
                <li key={idx} className="rounded-xl border border-white/10 bg-neutral-950/30 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-white/85">{it.name}</div>
                    <div className="text-xs text-white/60">
                      x{it.qty}
                      {typeof it.weightLb === 'number' ? ` · ${Math.round(it.weightLb * 100) / 100} lb` : ''}
                    </div>
                  </div>
                  {it.notes ? <div className="mt-1 text-xs text-white/60 whitespace-pre-wrap">{it.notes}</div> : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 text-xs text-white/50">
            Inventory supports either a simple string list or structured items: <span className="font-mono">{`{ name, qty?, weightLb?, notes? }`}</span>.
          </div>
        </div>
      </div>
    </main>
  );
}
