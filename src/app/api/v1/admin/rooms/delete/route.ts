import { NextResponse } from 'next/server';
import { ensureSchema } from '@/lib/db';
import { requireAdmin } from '@/lib/admin';
import { sql } from '@vercel/postgres';

type DeleteAllBody = { all: true; status?: 'OPEN' | 'CLOSED' | 'ARCHIVED' };
type DeleteOneBody = { roomId: string };
type DeleteManyBody = { roomIds: string[] };

// (intentionally no union type exported)

function isDeleteAllBody(x: unknown): x is DeleteAllBody {
  return !!x && typeof x === 'object' && (x as { all?: unknown }).all === true;
}

function isDeleteOneBody(x: unknown): x is DeleteOneBody {
  return !!x && typeof x === 'object' && typeof (x as { roomId?: unknown }).roomId === 'string';
}

function isDeleteManyBody(x: unknown): x is DeleteManyBody {
  return (
    !!x &&
    typeof x === 'object' &&
    Array.isArray((x as { roomIds?: unknown }).roomIds) &&
    (x as { roomIds: unknown[] }).roomIds.every((id) => typeof id === 'string' && id)
  );
}

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    await ensureSchema();

    const bodyUnknown = (await req.json().catch(() => ({}))) as unknown;

    if (isDeleteAllBody(bodyUnknown)) {
      const status = bodyUnknown.status;
      if (status && !['OPEN', 'CLOSED', 'ARCHIVED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }

      const res = status
        ? await sql`DELETE FROM rooms WHERE status = ${status}`
        : await sql`DELETE FROM rooms`;

      return NextResponse.json({ ok: true, deletedRooms: res.rowCount ?? 0 });
    }

    if (isDeleteOneBody(bodyUnknown)) {
      const res = await sql`DELETE FROM rooms WHERE id = ${bodyUnknown.roomId}`;
      return NextResponse.json({ ok: true, deletedRooms: res.rowCount ?? 0 });
    }

    if (isDeleteManyBody(bodyUnknown)) {
      // `sql` doesn't support array param expansion here, so delete one-by-one.
      let deleted = 0;
      for (const id of bodyUnknown.roomIds) {
        const r = await sql`DELETE FROM rooms WHERE id = ${id}`;
        deleted += r.rowCount ?? 0;
      }
      return NextResponse.json({ ok: true, deletedRooms: deleted });
    }

    return NextResponse.json({ error: 'Provide {all:true} or {roomId} or {roomIds:[...]}' }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    const status = msg === 'Unauthorized' ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
