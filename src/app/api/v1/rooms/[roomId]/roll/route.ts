import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireBot } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getSpellByName, isSRDSpell } from '@/lib/spells';
import { requireValidUUID, validateDiceNotation } from '@/lib/validation';
import { handleApiError } from '@/lib/errors';
import { generateRequestId } from '@/lib/logger';

type RollBody = {
  dice?: string; // e.g., "1d20", "2d6+3", "1d20+5"
  skill?: string; // e.g., "athletics", "stealth", "perception"
  attribute?: string; // e.g., "str", "dex", "con", "int", "wis", "cha"
  description?: string; // Optional description of what the roll is for
  spell?: string; // Spell name (must be SRD-compliant)
  spellLevel?: number; // Spell slot level used (for spell attacks/damage)
};

// Parse dice notation: "1d20+5" -> { count: 1, sides: 20, modifier: 5 }
function parseDice(notation: string): { count: number; sides: number; modifier: number } | null {
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;
  return {
    count: parseInt(match[1], 10),
    sides: parseInt(match[2], 10),
    modifier: match[3] ? parseInt(match[3], 10) : 0,
  };
}

// Roll dice: returns array of individual die results
function rollDice(count: number, sides: number): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }
  return results;
}

// Calculate ability modifier from score (SRD-compatible formula: (score - 10) / 2, rounded down)
function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

// SRD-compatible skill-to-attribute mapping (OGL 1.0a)
const SKILL_ATTRIBUTE_MAP: Record<string, string> = {
  athletics: 'str',
  acrobatics: 'dex',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  arcana: 'int',
  history: 'int',
  investigation: 'int',
  nature: 'int',
  religion: 'int',
  'animal-handling': 'wis',
  insight: 'wis',
  medicine: 'wis',
  perception: 'wis',
  survival: 'wis',
  deception: 'cha',
  intimidation: 'cha',
  performance: 'cha',
  persuasion: 'cha',
};

// Get skill modifier from character sheet
function getSkillModifier(
  sheet: Record<string, unknown>,
  skill: string,
  attribute: string | null,
): { modifier: number; attributeUsed: string | null } {
  const skills = (sheet.skills as Record<string, unknown>) || {};
  const attributes = (sheet.attributes as Record<string, unknown>) || {};
  const proficiencyBonus = typeof sheet.proficiencyBonus === 'number' ? sheet.proficiencyBonus : 0;

  // Determine which attribute to use
  let attrToUse = attribute?.toLowerCase() || null;
  if (!attrToUse && skill) {
    // Auto-map skill to attribute if not specified
    attrToUse = SKILL_ATTRIBUTE_MAP[skill.toLowerCase()] || null;
  }

  // Get base attribute modifier
  let modifier = 0;
  if (attrToUse) {
    const attrValue = attributes[attrToUse];
    if (typeof attrValue === 'number') {
      modifier = abilityModifier(attrValue);
    }
  }

  // Add proficiency if the skill is proficient
  if (skill) {
    const skillData = skills[skill.toLowerCase()];
    if (skillData && typeof skillData === 'object' && skillData !== null) {
      const skillObj = skillData as Record<string, unknown>;
      if (skillObj.proficient === true) {
        modifier += proficiencyBonus;
      }
      if (skillObj.expertise === true) {
        modifier += proficiencyBonus; // Expertise doubles proficiency
      }
    } else if (skillData === true) {
      // Simple boolean proficiency
      modifier += proficiencyBonus;
    }
  }

  return { modifier, attributeUsed: attrToUse };
}

export async function POST(req: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await ctx.params;
  const requestId = generateRequestId();
  try {
    requireValidUUID(roomId, 'roomId');
    const bot = await requireBot(req);
    let body: RollBody = {};
    try {
      body = (await req.json()) as RollBody;
    } catch {
      body = {};
    }

    // Verify room exists and bot is a member
    const roomCheck = await sql`
      SELECT r.id FROM rooms r
      JOIN room_members m ON m.room_id = r.id
      WHERE r.id = ${roomId} AND m.bot_id = ${bot.id}
      LIMIT 1
    `;
    if (roomCheck.rowCount === 0) {
      return NextResponse.json({ error: 'Room not found or you are not a member' }, { status: 404 });
    }

    // Validate spell if provided
    let spellData = null;
    if (body.spell) {
      if (!isSRDSpell(body.spell)) {
        return NextResponse.json(
          { error: `Spell "${body.spell}" is not in the SRD. Only SRD-compliant spells are allowed.` },
          { status: 400 },
        );
      }
      spellData = getSpellByName(body.spell);
    }

    // Get character sheet if rolling with skill/attribute/spell
    let skillModifier = 0;
    let attributeValue: number | null = null;
    let attributeUsed: string | null = null;

    if (body.skill || body.attribute || body.spell) {
      const char = await sql`
        SELECT sheet_json, level
        FROM room_characters
        WHERE room_id = ${roomId} AND bot_id = ${bot.id}
        LIMIT 1
      `;

      if (char.rowCount && char.rowCount > 0) {
        const row = char.rows[0] as { sheet_json: unknown; level: number };
        const sheet = (typeof row.sheet_json === 'object' && row.sheet_json !== null
          ? row.sheet_json
          : {}) as Record<string, unknown>;

        // Calculate proficiency bonus (SRD-compatible formula: 2 + (level - 1) / 4, rounded up)
        const level = typeof row.level === 'number' ? row.level : 1;
        const proficiencyBonus = Math.ceil(2 + (level - 1) / 4);
        sheet.proficiencyBonus = proficiencyBonus;

        if (body.spell && spellData) {
          // For spell attacks, use spellcasting ability modifier
          const spells = (sheet.spells as Record<string, unknown>) || {};
          const spellcastingAbility = (spells.spellcastingAbility as string) || 'int';
          const attributes = (sheet.attributes as Record<string, unknown>) || {};
          const attrValueRaw = attributes[spellcastingAbility.toLowerCase()];
          if (typeof attrValueRaw === 'number') {
            attributeValue = attrValueRaw;
            skillModifier = abilityModifier(attrValueRaw);
            attributeUsed = spellcastingAbility.toLowerCase();
          }
        } else if (body.skill) {
          const result = getSkillModifier(sheet, body.skill, body.attribute || null);
          skillModifier = result.modifier;
          attributeUsed = result.attributeUsed;
        } else if (body.attribute) {
          const attributes = (sheet.attributes as Record<string, unknown>) || {};
          const attrValueRaw = attributes[body.attribute.toLowerCase()];
          if (typeof attrValueRaw === 'number') {
            attributeValue = attrValueRaw;
            skillModifier = abilityModifier(attrValueRaw);
            attributeUsed = body.attribute.toLowerCase();
          }
        }
      }
    }

    // Parse dice notation or default to d20
    let diceSpec = { count: 1, sides: 20, modifier: 0 };
    if (body.dice) {
      // Validate dice notation with DoS prevention
      validateDiceNotation(body.dice);
      const parsed = parseDice(body.dice);
      if (parsed) {
        diceSpec = parsed;
      }
    }

    // Add skill/attribute modifier to the roll
    const totalModifier = diceSpec.modifier + skillModifier;

    // Roll the dice
    const rolls = rollDice(diceSpec.count, diceSpec.sides);
    const total = rolls.reduce((a, b) => a + b, 0) + totalModifier;

    // Log the roll as an event
    const eventId = crypto.randomUUID();
    let rollDescription = '';
    if (body.description) {
      rollDescription = ` (${body.description})`;
    } else if (body.spell) {
      rollDescription = ` (casting ${body.spell})`;
    }
    const rollText = `${body.dice || '1d20'}${totalModifier !== 0 ? (totalModifier >= 0 ? '+' : '') + totalModifier : ''}${rollDescription}: [${rolls.join(', ')}] = **${total}**`;

    await sql`
      INSERT INTO room_events (id, room_id, bot_id, kind, content)
      VALUES (${eventId}, ${roomId}, ${bot.id}, 'system', ${`🎲 ${bot.name} rolled ${rollText}`})
    `;

    return NextResponse.json(
      {
        roll: {
          dice: body.dice || '1d20',
          rolls,
          modifier: totalModifier,
          total,
          skill: body.skill || null,
          attribute: attributeUsed || body.attribute || null,
          attributeValue: attributeValue || null,
          spell: body.spell || null,
          spellLevel: body.spellLevel || null,
          description: body.description || null,
        },
        eventId,
      },
      { headers: { 'x-request-id': requestId } },
    );
  } catch (e: unknown) {
    const { status, response } = handleApiError(e, requestId);
    return NextResponse.json(response, { status, headers: { 'x-request-id': requestId } });
  }
}

