'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

function RecapPinned({ content }: { content: string }) {
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-emerald-50 backdrop-blur">
      <div className="text-xs font-semibold tracking-wide text-emerald-100">Latest recap</div>
      <div className="mt-2 whitespace-pre-wrap text-sm text-emerald-50/90">{content}</div>
    </div>
  );
}

export type LogEvent = { id: string; kind: string; content: string; created_at: string; bot_name?: string | null };

function mergeEvents(prev: LogEvent[], incoming: LogEvent[]) {
  const map = new Map<string, LogEvent>();
  for (const e of prev) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return Array.from(map.values()).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function LiveLog({ roomId, events, dmName }: { roomId?: string; events: LogEvent[]; dmName?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  const [allEvents, setAllEvents] = useState<LogEvent[]>(() =>
    [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  );
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreEarlier, setHasMoreEarlier] = useState(true);

  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [bot, setBot] = useState('');

  // Merge new server-provided events (usually the newest window) into our local timeline.
  useEffect(() => {
    setAllEvents((prev) => mergeEvents(prev, events));
  }, [events]);

  const ordered = allEvents;

  const isFiltering = Boolean(q.trim() || kind.trim() || bot.trim());
  const visible = useMemo(() => {
    if (!isFiltering) return ordered;
    const ql = q.trim().toLowerCase();
    const kl = kind.trim().toLowerCase();
    const bl = bot.trim().toLowerCase();

    return ordered.filter((e) => {
      if (kl && e.kind.toLowerCase() !== kl) return false;
      if (bl && String(e.bot_name ?? 'system').toLowerCase().includes(bl) === false) return false;
      if (!ql) return true;
      const hay = `${e.kind} ${(e.bot_name ?? 'system')}: ${e.content}`.toLowerCase();
      return hay.includes(ql);
    });
  }, [ordered, isFiltering, q, kind, bot]);

  const latestRecap = useMemo(() => {
    const recaps = ordered.filter((e) => e.kind === 'recap');
    return recaps.length ? recaps[recaps.length - 1] : null;
  }, [ordered]);

  const lastRecapEventId = latestRecap?.id ?? null;

  const lastDmEventId = useMemo(() => {
    if (!dmName) return null;
    const dmEvents = ordered.filter((e) => (e.bot_name ?? 'system') === dmName && e.kind !== 'recap');
    return dmEvents.length ? dmEvents[dmEvents.length - 1]!.id : null;
  }, [ordered, dmName]);

  function scrollToTop() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }

  function scrollToEvent(eventId: string | null) {
    if (!eventId) return;
    const node = document.getElementById(`event-${eventId}`);
    if (!node) return;
    setFollow(false);
    node.scrollIntoView({ block: 'start' });
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!follow) return;
    // Keep pinned to bottom.
    el.scrollTop = el.scrollHeight;
  }, [ordered.length, follow]);

  async function loadEarlier() {
    if (!roomId) return;
    if (loadingEarlier) return;
    if (!hasMoreEarlier) return;
    const earliest = ordered[0]?.created_at;
    if (!earliest) return;

    const el = containerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;

    try {
      setLoadingEarlier(true);
      const res = await fetch(`/api/v1/rooms/${roomId}/events?before=${encodeURIComponent(earliest)}&limit=200`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setHasMoreEarlier(false);
        return;
      }
      const data = (await res.json()) as { events?: LogEvent[]; hasMore?: boolean };
      const older = Array.isArray(data.events) ? data.events : [];
      setHasMoreEarlier(Boolean(data.hasMore) && older.length > 0);
      if (older.length === 0) return;

      setAllEvents((prev) => mergeEvents(older, prev));

      // Preserve scroll position so the viewport doesn't jump when prepending older events.
      requestAnimationFrame(() => {
        const node = containerRef.current;
        if (!node) return;
        const nextScrollHeight = node.scrollHeight;
        node.scrollTop = node.scrollTop + (nextScrollHeight - prevScrollHeight);
      });
    } finally {
      setLoadingEarlier(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setFollow(false);
              scrollToTop();
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white/90"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => {
              setFollow(false);
              void loadEarlier();
            }}
            disabled={!roomId || loadingEarlier || !hasMoreEarlier}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white/90 disabled:opacity-40"
            title={!roomId ? 'Pagination requires roomId' : !hasMoreEarlier ? 'No earlier events' : undefined}
          >
            {loadingEarlier ? 'Loading…' : 'Load earlier'}
          </button>
          <button
            type="button"
            onClick={() => scrollToEvent(lastRecapEventId)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white/90 disabled:opacity-40"
            disabled={!lastRecapEventId}
            title={!lastRecapEventId ? 'No recap yet' : undefined}
          >
            Last recap
          </button>
          <button
            type="button"
            onClick={() => scrollToEvent(lastDmEventId)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white/90 disabled:opacity-40"
            disabled={!lastDmEventId}
            title={!lastDmEventId ? 'No DM event yet' : undefined}
          >
            Last DM
          </button>
          <button
            type="button"
            onClick={() => {
              setFollow(true);
              scrollToBottom();
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:text-white/90"
          >
            Bottom
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            const next = !follow;
            setFollow(next);
            if (next) scrollToBottom();
          }}
          className={`rounded-full border px-3 py-1 text-xs ${follow ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-white/5 text-white/70 hover:text-white/90'}`}
          title={follow ? 'Auto-following new events' : 'Paused (won\'t auto-scroll)'}
        >
          {follow ? 'Following' : 'Paused'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setFollow(false);
          }}
          placeholder="Search text…"
          className="w-full min-w-[180px] flex-1 rounded-lg border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 placeholder:text-white/40"
        />
        <input
          value={bot}
          onChange={(e) => {
            setBot(e.target.value);
            setFollow(false);
          }}
          placeholder="Bot name…"
          className="w-full min-w-[140px] flex-1 rounded-lg border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 placeholder:text-white/40"
        />
        <input
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setFollow(false);
          }}
          placeholder="Kind (say/recap/system)…"
          className="w-full min-w-[160px] flex-1 rounded-lg border border-white/10 bg-neutral-950/40 px-3 py-2 text-sm text-white/80 placeholder:text-white/40"
        />
        <button
          type="button"
          onClick={() => {
            setQ('');
            setBot('');
            setKind('');
          }}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 hover:text-white/90"
          disabled={!isFiltering}
        >
          Clear
        </button>
        {isFiltering ? <div className="text-xs text-white/50">Showing {visible.length} of {ordered.length}</div> : null}
      </div>

      <div ref={containerRef} className="h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-4">
        {ordered.length === 0 ? (
          <div className="text-sm text-white/60">No events yet.</div>
        ) : visible.length === 0 ? (
          <div className="text-sm text-white/60">No events match your filters.</div>
        ) : (
          <div className="space-y-3">
            {!isFiltering && latestRecap ? <RecapPinned content={latestRecap.content} /> : null}

            {visible.map((e) => (
              <div
                key={e.id}
                id={`event-${e.id}`}
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
    </div>
  );
}
