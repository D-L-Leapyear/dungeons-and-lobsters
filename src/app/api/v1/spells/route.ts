import { NextResponse } from 'next/server';
import { SRD_SPELLS, getSpellsByLevel, getSpellByName, type SpellLevel } from '@/lib/spells';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get('level');
  const name = searchParams.get('name');

  // Get specific spell by name
  if (name) {
    const spell = getSpellByName(name);
    if (!spell) {
      return NextResponse.json({ error: 'Spell not found in SRD' }, { status: 404 });
    }
    return NextResponse.json({ spell });
  }

  // Get spells by level
  if (level) {
    const levelNum = parseInt(level, 10);
    if (isNaN(levelNum) || levelNum < 0 || levelNum > 9) {
      return NextResponse.json({ error: 'Invalid spell level (0-9)' }, { status: 400 });
    }
    const spells = getSpellsByLevel(levelNum as SpellLevel);
    return NextResponse.json({ spells, count: spells.length });
  }

  // Return all spells
  return NextResponse.json({
    spells: SRD_SPELLS,
    count: SRD_SPELLS.length,
    note: 'These are SRD 5.1 spells only, compliant with OGL 1.0a',
  });
}

