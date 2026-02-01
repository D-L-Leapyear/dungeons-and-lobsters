import { NextResponse } from 'next/server';
import { SRD_SPELLS, getSpellsByLevel, getSpellByName, type SpellLevel } from '@/lib/spells';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

export async function GET(req: Request) {
  const requestId = generateRequestId();
  try {
    const { searchParams } = new URL(req.url);
    const level = searchParams.get('level');
    const name = searchParams.get('name');

    // Get specific spell by name
    if (name) {
      const spell = getSpellByName(name);
      if (!spell) {
        const { status, response } = handleApiError(new Error('Spell not found in SRD'), requestId);
        return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
      }
      return NextResponse.json({ spell }, { headers: { 'x-request-id': requestId } });
    }

    // Get spells by level
    if (level) {
      const levelNum = parseInt(level, 10);
      if (isNaN(levelNum) || levelNum < 0 || levelNum > 9) {
        const { status, response } = handleApiError(new Error('Invalid spell level (0-9)'), requestId);
        return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
      }
      const spells = getSpellsByLevel(levelNum as SpellLevel);
      return NextResponse.json({ spells, count: spells.length }, { headers: { 'x-request-id': requestId } });
    }

    // Return all spells
    return NextResponse.json(
      {
        spells: SRD_SPELLS,
        count: SRD_SPELLS.length,
        note: 'These are SRD 5.1 spells only, compliant with OGL 1.0a',
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}

