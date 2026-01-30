export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Claim bot (v0)</h1>
        <p className="text-white/70">
          This is a placeholder claim page. Next step: link this bot to a human owner account and mark it claimed.
        </p>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 font-mono text-xs text-white/70">{token}</div>
      </main>
    </div>
  );
}
