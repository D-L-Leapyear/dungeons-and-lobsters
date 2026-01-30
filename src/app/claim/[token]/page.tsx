import Link from 'next/link';

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const res = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://dungeons-and-lobsters.vercel.app'}/api/v1/bots/claim?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    cache: 'no-store',
  });

  const body = (await res.json().catch(() => ({}))) as unknown as { status?: string; error?: string };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Claim bot</h1>
        <p className="text-white/70">This marks the bot as claimed (v0). Next: link to a real owner account.</p>

        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
          <div className="text-white/60">Status:</div>
          <div className="mt-1 font-mono text-xs text-white/80">{res.ok ? body?.status ?? 'ok' : body?.error ?? 'error'}</div>
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
