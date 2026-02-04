'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type Kind = 'abuse' | 'ogl' | 'spam' | 'other';
const ALLOWED_KINDS: readonly Kind[] = ['abuse', 'spam', 'ogl', 'other'];
function isKind(v: string): v is Kind {
  return (ALLOWED_KINDS as readonly string[]).includes(v);
}

export default function ReportRoomPage({ params }: { params: { roomId: string } }) {
  const roomId = params.roomId;
  const [details, setDetails] = useState('');
  const [kind, setKind] = useState<Kind>('other');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState<string>('');

  const canSend = useMemo(() => details.trim().length >= 10 && status !== 'sending', [details, status]);

  async function submit() {
    setStatus('sending');
    setMsg('');
    try {
      const res = await fetch(`/api/v1/rooms/${roomId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to submit report');
      setStatus('sent');
      setMsg('Thanks — report submitted.');
      setDetails('');
    } catch (e: unknown) {
      setStatus('error');
      setMsg(e instanceof Error ? e.message : 'Failed to submit report');
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <div className="text-sm text-white/60">
        <Link href={`/watch/${roomId}`} className="hover:underline">
          ← Back to Watch
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Report room</h1>
      <p className="mt-2 text-sm text-white/70">If something in this room looks abusive, spammy, or non-SRD (OGL) content, send a report. This is stored for admin review.</p>

      <div className="mt-6 space-y-3">
        <label className="block text-sm text-white/70">Category</label>
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value;
            if (isKind(v)) setKind(v);
          }}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
        >
          <option value="abuse">Abuse / harassment</option>
          <option value="spam">Spam</option>
          <option value="ogl">Non-SRD / OGL compliance</option>
          <option value="other">Other</option>
        </select>

        <label className="block text-sm text-white/70">Details</label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={8}
          placeholder="What happened? Include approximate turn # / quotes if possible."
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40"
        />

        <button
          onClick={submit}
          disabled={!canSend}
          className={`w-full rounded-lg px-4 py-2 text-sm font-medium ${canSend ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-white/10 text-white/40'}`}
        >
          {status === 'sending' ? 'Sending…' : 'Submit report'}
        </button>

        {msg ? <div className={`text-sm ${status === 'sent' ? 'text-emerald-200' : status === 'error' ? 'text-rose-200' : 'text-white/70'}`}>{msg}</div> : null}

        <div className="pt-2 text-xs text-white/50">Room: {roomId}</div>
      </div>
    </main>
  );
}
