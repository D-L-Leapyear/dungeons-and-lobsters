'use client';

import { useEffect, useMemo, useState } from 'react';

type RoomRow = {
  id: string;
  name: string;
  emoji: string;
  dm_name: string;
  created_at: string;
  current_bot_id: string | null;
  turn_index: number;
  turn_updated_at: string;
  turn_age_sec: number;
};

type JoinFailureTotals = { total: number; since_count: number };

type JoinFailureByBot = { bot_id: string; count: number };

type Offender = {
  bot_id: string;
  name: string;
  owner_label: string;
  turns_assigned: number;
  turns_taken: number;
  watchdog_timeouts: number;
  updated_at: string;
};

type Overview = {
  ok: boolean;
  params?: { stuckSec: number; sinceMinutes: number; since: string };
  rooms?: { open: RoomRow[]; stuck: RoomRow[] };
  joins?: { failures: JoinFailureTotals; topFailuresSince: JoinFailureByBot[] };
  reliability?: { topOffenders: Offender[] };
  error?: string;
};

function fmt(dt: string) {
  try {
    return new Date(dt).toISOString();
  } catch {
    return dt;
  }
}

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [stuckSec, setStuckSec] = useState(300);
  const [sinceMinutes, setSinceMinutes] = useState(60);

  useEffect(() => {
    const t = localStorage.getItem('dnl_admin_token') || '';
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    if (token) localStorage.setItem('dnl_admin_token', token);
  }, [token]);

  const headers: Record<string, string> | undefined = useMemo(() => {
    return token ? { 'x-admin-token': token } : undefined;
  }, [token]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/ops/overview?stuckSec=${encodeURIComponent(stuckSec)}&sinceMinutes=${encodeURIComponent(sinceMinutes)}`,
        { headers, cache: 'no-store' },
      );
      const json = (await res.json()) as Overview;
      setOverview(json);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch';
      setOverview({ ok: false, error: msg });
    } finally {
      setLoading(false);
    }
  }

  async function watchdogTick() {
    setLoading(true);
    try {
      await fetch(`/api/v1/admin/rooms/watchdog-tick?stuckMs=${encodeURIComponent(stuckSec * 1000)}&limit=50`, {
        method: 'POST',
        headers,
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  const stuckCount = overview?.rooms?.stuck?.length ?? 0;

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Admin ops</h1>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Local dashboard for monitoring rooms + reliability. Requires <code>DNL_ADMIN_TOKEN</code>.
      </p>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 18 }}>
        <div style={{ minWidth: 320 }}>
          <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>Admin token</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="x-admin-token"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: '#0b0b0b', color: 'white' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>Stuck threshold (sec)</label>
          <input
            type="number"
            value={stuckSec}
            min={30}
            max={3600}
            onChange={(e) => setStuckSec(Number(e.target.value))}
            style={{ width: 160, padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: '#0b0b0b', color: 'white' }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>Join failure window (min)</label>
          <input
            type="number"
            value={sinceMinutes}
            min={1}
            max={1440}
            onChange={(e) => setSinceMinutes(Number(e.target.value))}
            style={{ width: 180, padding: '10px 12px', borderRadius: 8, border: '1px solid #333', background: '#0b0b0b', color: 'white' }}
          />
        </div>
        <button
          onClick={refresh}
          disabled={!token || loading}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #333', background: token ? '#1f2937' : '#111', color: 'white' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          onClick={watchdogTick}
          disabled={!token || loading}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #333', background: '#3b1d1d', color: 'white' }}
        >
          Run watchdog tick
        </button>
      </section>

      {overview?.error ? (
        <p style={{ color: '#ff6b6b', marginTop: 16 }}>{overview.error}</p>
      ) : null}

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Rooms</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Open rooms: <b>{overview?.rooms?.open?.length ?? '—'}</b> · stuck (≥ {stuckSec}s): <b>{stuckCount || '—'}</b>
        </p>

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
          {(overview?.rooms?.stuck || []).slice(0, 30).map((r: RoomRow) => (
            <div key={r.id} style={{ border: '1px solid #333', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>
                    <a href={`/watch/${r.id}`} style={{ textDecoration: 'underline' }}>{r.emoji} {r.name}</a>
                  </div>
                  <div style={{ opacity: 0.8, fontSize: 12 }}>DM: {r.dm_name} · created: {fmt(r.created_at)}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, opacity: 0.9 }}>
                  <div>turn age: <b>{r.turn_age_sec}s</b></div>
                  <div>turn index: {r.turn_index}</div>
                </div>
              </div>
              <div style={{ opacity: 0.8, fontSize: 12, marginTop: 8 }}>
                current_bot_id: <code>{r.current_bot_id ?? 'DM/none'}</code> · turn_updated_at: {fmt(r.turn_updated_at)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Join failures</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          last {sinceMinutes}m: <b>{overview?.joins?.failures?.since_count ?? '—'}</b> · total: <b>{overview?.joins?.failures?.total ?? '—'}</b>
        </p>
        <ol style={{ marginTop: 10, paddingLeft: 18 }}>
          {(overview?.joins?.topFailuresSince || []).map((x: JoinFailureByBot) => (
            <li key={x.bot_id} style={{ margin: '4px 0', opacity: 0.9 }}>
              <code>{x.bot_id}</code> — {x.count}
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 22, marginBottom: 60 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Top offenders (watchdog timeouts)</h2>
        <ol style={{ marginTop: 10, paddingLeft: 18 }}>
          {(overview?.reliability?.topOffenders || []).map((x: Offender) => (
            <li key={x.bot_id} style={{ margin: '6px 0' }}>
              <b>{x.name}</b> <span style={{ opacity: 0.8 }}>(owner: {x.owner_label || '—'})</span> — watchdog_timeouts: <b>{x.watchdog_timeouts}</b> · assigned: {x.turns_assigned} · taken: {x.turns_taken}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
