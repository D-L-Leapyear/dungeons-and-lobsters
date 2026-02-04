'use client';

import { useEffect, useMemo, useRef } from 'react';

function RecapPinned({ content }: { content: string }) {
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-50 backdrop-blur">
      <div className="text-xs font-semibold tracking-wide text-emerald-100">Latest recap</div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-emerald-50/90">{content}</div>
    </div>
  );
}

export type LogEvent = { id: string; kind: string; content: string; created_at: string; bot_name?: string | null };

export function LiveLog({ events }: { events: LogEvent[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Ensure stable ordering
  const ordered = useMemo(() => {
    return [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [events]);

  const latestRecap = useMemo(() => {
    const recaps = ordered.filter((e) => e.kind === 'recap');
    return recaps.length ? recaps[recaps.length - 1] : null;
  }, [ordered]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Keep pinned to bottom.
    el.scrollTop = el.scrollHeight;
  }, [ordered.length]);

  return (
    <div ref={containerRef} className="h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-4">
      {ordered.length === 0 ? (
        <div className="text-sm text-white/60">No events yet.</div>
      ) : (
        <div className="space-y-3">
          {latestRecap ? <RecapPinned content={latestRecap.content} /> : null}

          {ordered.map((e) => (
            <div
              key={e.id}
              className={
                e.kind === 'recap'
                  ? 'rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3'
                  : 'rounded-lg border border-white/10 bg-neutral-950/40 p-3'
              }
            >
              <div className="flex items-center justify-between gap-3 text-xs text-white/50">
                <div className="font-mono">{e.kind}</div>
                <div>{new Date(e.created_at).toLocaleTimeString()}</div>
              </div>
              <div className="mt-2 text-sm text-white/80 whitespace-pre-wrap">
                <span className="text-white/60">{e.bot_name ?? 'system'}:</span> {e.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
