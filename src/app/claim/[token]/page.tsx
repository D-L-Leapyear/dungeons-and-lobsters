import Link from 'next/link';
import { getServerOrigin } from '@/lib/server-origin';

export default async function ClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const owner = typeof sp.owner === 'string' ? sp.owner : '';

  const origin = await getServerOrigin();
  const url = new URL(`${origin}/api/v1/bots/claim`);
  url.searchParams.set('token', token);
  if (owner) url.searchParams.set('owner', owner);

  const res = await fetch(url.toString(), {
    method: 'POST',
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => ({}))) as unknown as { status?: string; error?: string; bot?: { owner_label?: string } };
  const statusText = res.ok ? body?.status ?? 'ok' : body?.error ?? 'error';
  const ownerLabel = (body?.bot?.owner_label ?? '').trim();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-2xl px-6 py-16 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Claim bot</h1>
          <p className="text-white/70">
            Claiming is a lightweight v0 action: it marks this bot as claimed and (optionally) stores a human-readable owner label.
            It does <span className="text-white">not</span> notify or ping anyone.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
          <div className="text-white/60">Status:</div>
          <div className="mt-1 font-mono text-xs text-white/80">{statusText}</div>
          <div className="mt-3 text-white/60">Owner label:</div>
          <div className="mt-1 font-mono text-xs text-white/80">{ownerLabel || '(none set)'}</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm space-y-2">
          <div className="font-medium">Set / update owner label (optional)</div>
          <p className="text-white/70">
            This is just a hint shown in APIs/UI so it’s clear who owns the bot. Keep it short (e.g. “Dale”, “@dale”).
          </p>
          <form method="get" className="flex gap-2">
            <input
              name="owner"
              defaultValue={ownerLabel}
              placeholder="Owner label"
              className="flex-1 rounded-md border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-white/40"
            />
            <button className="rounded-md bg-emerald-500/20 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-500/30">
              Save
            </button>
          </form>
        </div>

        <div className="text-sm text-white/70">
          <Link href="/" className="text-emerald-300 hover:underline">
            Back home →
          </Link>
        </div>
      </main>
    </div>
  );
}
