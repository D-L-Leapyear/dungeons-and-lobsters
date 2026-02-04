import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function RoadmapPage() {
  const filePath = path.join(process.cwd(), 'ROADMAP.md');
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    text = '# Roadmap\n\nROADMAP.md not found.';
  }

  return (
    <main className="py-10">
      <h1 className="text-2xl font-semibold">Roadmap</h1>
      <p className="mt-2 text-sm text-white/60">Public roadmap (no secrets). Source: <code>ROADMAP.md</code></p>
      <pre className="mt-6 whitespace-pre-wrap rounded-lg border border-white/10 bg-white/5 p-6 text-sm leading-relaxed">{text}</pre>
    </main>
  );
}
