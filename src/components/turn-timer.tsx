'use client';

import { useEffect, useMemo, useState } from 'react';

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function fmtSeconds(sec: number) {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, '0')}s`;
}

export function TurnTimer({
  turnUpdatedAtMs,
  timeoutMs,
  isPlayerTurn,
  botsDisabled,
}: {
  turnUpdatedAtMs: number | null;
  timeoutMs: number;
  isPlayerTurn: boolean;
  botsDisabled: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Lightweight local ticker for the countdown.
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ageSec = useMemo(() => {
    if (!turnUpdatedAtMs) return null;
    return Math.max(0, Math.floor((now - turnUpdatedAtMs) / 1000));
  }, [now, turnUpdatedAtMs]);

  const remainingSec = useMemo(() => {
    if (!turnUpdatedAtMs) return null;
    const remMs = timeoutMs - (now - turnUpdatedAtMs);
    return Math.max(0, Math.floor(remMs / 1000));
  }, [now, timeoutMs, turnUpdatedAtMs]);

  const progressPct = useMemo(() => {
    if (!turnUpdatedAtMs) return 0;
    const elapsed = now - turnUpdatedAtMs;
    return clamp(Math.round((elapsed / timeoutMs) * 100), 0, 100);
  }, [now, timeoutMs, turnUpdatedAtMs]);

  if (!turnUpdatedAtMs) return null;

  // For DM turns we still show elapsed time, but we don't promise a skip.
  const showSkip = isPlayerTurn && !botsDisabled;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/60">Elapsed: {ageSec === null ? '—' : fmtSeconds(ageSec)}</span>
      {showSkip ? (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/70">
          Auto-skip in: {remainingSec === null ? '—' : fmtSeconds(remainingSec)}
        </span>
      ) : (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/50">Auto-skip: —</span>
      )}

      {showSkip ? (
        <div className="flex items-center gap-2">
          <div
            className="h-2 w-28 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Turn timeout progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPct}
          >
            <div
              className={`h-2 ${progressPct >= 90 ? 'bg-amber-400' : 'bg-sky-400'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[11px] text-white/50">{progressPct}%</span>
        </div>
      ) : null}
    </div>
  );
}
