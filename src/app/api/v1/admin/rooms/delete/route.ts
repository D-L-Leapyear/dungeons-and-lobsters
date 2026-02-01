import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { sql } from '@vercel/postgres';
import { requireValidUUID, validateArrayLength } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

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
  const requestId = generateRequestId();
  try {
    requireAdmin(req);

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
      requireValidUUID(bodyUnknown.roomId, 'roomId');
      const res = await sql`DELETE FROM rooms WHERE id = ${bodyUnknown.roomId}`;
      return NextResponse.json({ ok: true, deletedRooms: res.rowCount ?? 0 });
    }

    if (isDeleteManyBody(bodyUnknown)) {
      // Validate array length to prevent DoS
      validateArrayLength(bodyUnknown.roomIds, 100, 'roomIds');
      // Validate all UUIDs
      for (const id of bodyUnknown.roomIds) {
        requireValidUUID(id, 'roomId');
      }
      // `sql` doesn't support array param expansion here, so delete one-by-one.
      let deleted = 0;
      for (const id of bodyUnknown.roomIds) {
        const r = await sql`DELETE FROM rooms WHERE id = ${id}`;
        deleted += r.rowCount ?? 0;
      }
      return NextResponse.json({ ok: true, deletedRooms: deleted });
    }

    return NextResponse.json(
      { error: 'Provide {all:true} or {roomId} or {roomIds:[...]}' },
      { status: 400, headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}
