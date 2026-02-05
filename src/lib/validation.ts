/**
 * Input validation utilities for API routes.
 * Provides validation functions for common input types.
 */

/**
 * UUID validation regex (RFC 4122)
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
export function isValidUUID(value: string): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate UUID and throw if invalid
 */
export function requireValidUUID(value: string, fieldName = 'id'): void {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid ${fieldName}: must be a valid UUID`);
  }
}

/**
 * Dice notation limits
 */
const MAX_DICE_COUNT = 100;
const MAX_DICE_SIDES = 1000;
const MIN_DICE_COUNT = 1;
const MIN_DICE_SIDES = 1;

/**
 * Parse and validate dice notation (e.g., "1d20", "2d6+3", "1d20+5")
 * Returns parsed values or null if invalid
 */
export function parseDiceNotation(notation: string): { count: number; sides: number; modifier: number } | null {
  if (typeof notation !== 'string') return null;

  const match = notation.trim().match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return null;

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  // Validate bounds
  if (!Number.isFinite(count) || count < MIN_DICE_COUNT || count > MAX_DICE_COUNT) {
    return null;
  }
  if (!Number.isFinite(sides) || sides < MIN_DICE_SIDES || sides > MAX_DICE_SIDES) {
    return null;
  }
  if (!Number.isFinite(modifier)) {
    return null;
  }

  return { count, sides, modifier };
}

/**
 * Validate dice notation and throw if invalid
 */
export function validateDiceNotation(notation: string): void {
  const parsed = parseDiceNotation(notation);
  if (!parsed) {
    throw new Error(
      `Invalid dice notation: "${notation}". Must be in format "XdY" or "XdY±Z" where X is 1-${MAX_DICE_COUNT} and Y is 1-${MAX_DICE_SIDES}`,
    );
  }
}

/**
 * Validate array length
 */
export function validateArrayLength<T>(array: T[], maxLength: number, fieldName = 'array'): void {
  if (!Array.isArray(array)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (array.length > maxLength) {
    throw new Error(`${fieldName} must have at most ${maxLength} items`);
  }
}

/**
 * Validate string length
 */
export function validateStringLength(value: string, maxLength: number, fieldName = 'string'): void {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }
}

/**
 * Validate that a value is a non-empty string
 */
export function requireNonEmptyString(value: unknown, fieldName = 'field'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

// --- D&D-ish canonical keys (SRD-friendly) ---

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

export const SKILL_KEYS = [
  'athletics',
  'acrobatics',
  'sleight-of-hand',
  'stealth',
  'arcana',
  'history',
  'investigation',
  'nature',
  'religion',
  'animal-handling',
  'insight',
  'medicine',
  'perception',
  'survival',
  'deception',
  'intimidation',
  'performance',
  'persuasion',
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/**
 * Normalize a user-provided skill name into our canonical kebab-case keys.
 * Accepts common variants like "sleight of hand" / "Sleight_of_Hand".
 */
export function normalizeSkillKey(skill: string): string {
  return skill
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isSkillKey(skill: string): skill is SkillKey {
  const k = normalizeSkillKey(skill);
  return (SKILL_KEYS as readonly string[]).includes(k);
}

// --- Character sheet validation / normalization ---

export type CharacterSheetIssues = {
  path: string;
  message: string;
}[];

export function validateAndNormalizeCharacterSheet(
  input: unknown,
  opts: { level: number },
): { sheet: Record<string, unknown>; issues: CharacterSheetIssues } {
  const issues: CharacterSheetIssues = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { sheet: {}, issues: [] };
  }

  // Start with a shallow clone so we preserve unknown extra fields by default.
  const raw = input as Record<string, unknown>;
  const sheet: Record<string, unknown> = { ...raw };

  // attributes
  if (raw.attributes !== undefined) {
    if (typeof raw.attributes !== 'object' || raw.attributes === null || Array.isArray(raw.attributes)) {
      issues.push({ path: 'sheet.attributes', message: 'must be an object' });
      delete sheet.attributes;
    } else {
      const attrs = raw.attributes as Record<string, unknown>;
      const normalizedAttrs: Record<string, number> = {};
      for (const key of ABILITY_KEYS) {
        const v = attrs[key];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          issues.push({ path: `sheet.attributes.${key}`, message: 'must be a finite number' });
          continue;
        }
        const n = Math.round(v);
        if (n < 1 || n > 30) {
          issues.push({ path: `sheet.attributes.${key}`, message: 'must be between 1 and 30' });
          continue;
        }
        normalizedAttrs[key] = n;
      }
      sheet.attributes = normalizedAttrs;
    }
  }

  // skills
  if (raw.skills !== undefined) {
    if (typeof raw.skills !== 'object' || raw.skills === null || Array.isArray(raw.skills)) {
      issues.push({ path: 'sheet.skills', message: 'must be an object' });
      delete sheet.skills;
    } else {
      const skills = raw.skills as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(skills)) {
        const nk = normalizeSkillKey(k);
        if (!(SKILL_KEYS as readonly string[]).includes(nk)) {
          issues.push({ path: `sheet.skills.${k}`, message: `unknown skill (expected one of: ${SKILL_KEYS.join(', ')})` });
          continue;
        }

        if (typeof v === 'boolean') {
          normalized[nk] = v;
          continue;
        }
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          const o = v as Record<string, unknown>;
          const proficient = o.proficient;
          const expertise = o.expertise;
          if (proficient !== undefined && typeof proficient !== 'boolean') {
            issues.push({ path: `sheet.skills.${k}.proficient`, message: 'must be boolean' });
            continue;
          }
          if (expertise !== undefined && typeof expertise !== 'boolean') {
            issues.push({ path: `sheet.skills.${k}.expertise`, message: 'must be boolean' });
            continue;
          }
          normalized[nk] = {
            ...(typeof proficient === 'boolean' ? { proficient } : {}),
            ...(typeof expertise === 'boolean' ? { expertise } : {}),
          };
          continue;
        }

        issues.push({ path: `sheet.skills.${k}`, message: 'must be boolean or { proficient?: boolean, expertise?: boolean }' });
      }
      sheet.skills = normalized;
    }
  }

  // spells
  if (raw.spells !== undefined) {
    if (typeof raw.spells !== 'object' || raw.spells === null || Array.isArray(raw.spells)) {
      issues.push({ path: 'sheet.spells', message: 'must be an object' });
      delete sheet.spells;
    } else {
      const spells = raw.spells as Record<string, unknown>;
      const out: Record<string, unknown> = {};

      const normalizeSpellList = (value: unknown, path: string) => {
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) {
          issues.push({ path, message: 'must be an array of strings' });
          return undefined;
        }
        if (value.length > 200) {
          issues.push({ path, message: 'must have at most 200 items' });
          return undefined;
        }
        const arr: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const s = value[i];
          if (typeof s !== 'string' || !s.trim()) {
            issues.push({ path: `${path}[${i}]`, message: 'must be a non-empty string' });
            continue;
          }
          const t = s.trim();
          if (t.length > 80) {
            issues.push({ path: `${path}[${i}]`, message: 'must be at most 80 characters' });
            continue;
          }
          arr.push(t);
        }
        return arr;
      };

      const known = normalizeSpellList(spells.known, 'sheet.spells.known');
      if (known) out.known = known;
      const prepared = normalizeSpellList(spells.prepared, 'sheet.spells.prepared');
      if (prepared) out.prepared = prepared;

      if (spells.spellcastingAbility !== undefined) {
        const a = spells.spellcastingAbility;
        if (a !== 'int' && a !== 'wis' && a !== 'cha') {
          issues.push({ path: 'sheet.spells.spellcastingAbility', message: 'must be one of: int, wis, cha' });
        } else {
          out.spellcastingAbility = a;
        }
      }

      if (spells.spellSlots !== undefined) {
        if (typeof spells.spellSlots !== 'object' || spells.spellSlots === null || Array.isArray(spells.spellSlots)) {
          issues.push({ path: 'sheet.spells.spellSlots', message: 'must be an object like { "1": 2, "2": 1 }' });
        } else {
          const slots = spells.spellSlots as Record<string, unknown>;
          const normSlots: Record<string, number> = {};
          for (const [k, v] of Object.entries(slots)) {
            if (!/^[1-9]$/.test(k)) {
              issues.push({ path: `sheet.spells.spellSlots.${k}`, message: 'slot level key must be a string "1"-"9"' });
              continue;
            }
            if (typeof v !== 'number' || !Number.isFinite(v) || Math.round(v) !== v) {
              issues.push({ path: `sheet.spells.spellSlots.${k}`, message: 'must be an integer' });
              continue;
            }
            const n = Math.max(0, Math.min(99, v));
            normSlots[k] = n;
          }
          out.spellSlots = normSlots;
        }
      }

      sheet.spells = out;
    }
  }

  // inventory (optional)
  if (raw.inventory !== undefined) {
    const inv = raw.inventory;
    if (!Array.isArray(inv)) {
      issues.push({ path: 'sheet.inventory', message: 'must be an array' });
      delete sheet.inventory;
    } else {
      if (inv.length > 200) {
        issues.push({ path: 'sheet.inventory', message: 'must have at most 200 items' });
      }
      const normalized: Record<string, unknown>[] = [];
      for (let i = 0; i < Math.min(inv.length, 200); i++) {
        const item = inv[i] as unknown;
        if (typeof item === 'string') {
          const name = item.trim();
          if (!name) {
            issues.push({ path: `sheet.inventory[${i}]`, message: 'must be a non-empty string or an item object' });
            continue;
          }
          if (name.length > 80) {
            issues.push({ path: `sheet.inventory[${i}]`, message: 'name must be at most 80 characters' });
            continue;
          }
          normalized.push({ name, qty: 1 });
          continue;
        }

        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          const nameRaw = o.name;
          const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
          if (!name) {
            issues.push({ path: `sheet.inventory[${i}].name`, message: 'must be a non-empty string' });
            continue;
          }
          if (name.length > 80) {
            issues.push({ path: `sheet.inventory[${i}].name`, message: 'must be at most 80 characters' });
            continue;
          }

          let qty = 1;
          if (o.qty !== undefined) {
            const q = typeof o.qty === 'number' ? o.qty : Number(o.qty);
            if (!Number.isFinite(q)) {
              issues.push({ path: `sheet.inventory[${i}].qty`, message: 'must be a number' });
            } else {
              qty = Math.max(0, Math.min(999, Math.floor(q)));
            }
          }

          let weightLb: number | null = null;
          if (o.weightLb !== undefined) {
            const w = typeof o.weightLb === 'number' ? o.weightLb : Number(o.weightLb);
            if (!Number.isFinite(w)) {
              issues.push({ path: `sheet.inventory[${i}].weightLb`, message: 'must be a number' });
            } else {
              weightLb = Math.max(0, Math.min(100000, w));
            }
          }

          let notes: string | null = null;
          if (o.notes !== undefined) {
            if (typeof o.notes !== 'string') {
              issues.push({ path: `sheet.inventory[${i}].notes`, message: 'must be a string' });
            } else {
              const t = o.notes.trim();
              if (t.length > 200) {
                issues.push({ path: `sheet.inventory[${i}].notes`, message: 'must be at most 200 characters' });
              } else if (t) {
                notes = t;
              }
            }
          }

          normalized.push({ name, qty, ...(weightLb !== null ? { weightLb } : {}), ...(notes ? { notes } : {}) });
          continue;
        }

        issues.push({ path: `sheet.inventory[${i}]`, message: 'must be a string or an item object { name, qty?, weightLb?, notes? }' });
      }

      // Store inventory in a canonical object form (keeps UI + bots consistent).
      sheet.inventory = normalized;

      // Compute lightweight encumbrance summary (variant rules-ish).
      const attrs = (sheet.attributes && typeof sheet.attributes === 'object' && sheet.attributes !== null && !Array.isArray(sheet.attributes))
        ? (sheet.attributes as Record<string, unknown>)
        : null;
      const str = attrs && typeof attrs.str === 'number' && Number.isFinite(attrs.str) ? Math.round(attrs.str) : null;
      let totalWeightLb = 0;
      for (const it of normalized) {
        const nm = it.name as unknown;
        if (typeof nm !== 'string') continue;
        const q = typeof it.qty === 'number' && Number.isFinite(it.qty) ? it.qty : 1;
        const w = typeof (it as any).weightLb === 'number' && Number.isFinite((it as any).weightLb) ? (it as any).weightLb : 0;
        totalWeightLb += Math.max(0, q) * Math.max(0, w);
      }
      totalWeightLb = Math.round(totalWeightLb * 100) / 100;

      if (str && totalWeightLb > 0) {
        const enc = {
          totalWeightLb,
          capacityLb: 15 * str,
          encumberedLb: 5 * str,
          heavilyEncumberedLb: 10 * str,
          status: (
            totalWeightLb > 15 * str ? 'over-capacity' :
            totalWeightLb > 10 * str ? 'heavily-encumbered' :
            totalWeightLb > 5 * str ? 'encumbered' :
            'normal'
          ),
        };
        (sheet as any).encumbrance = enc;
      } else {
        // Avoid lying: if STR/weights aren't provided, omit encumbrance summary.
        if ((sheet as any).encumbrance !== undefined) delete (sheet as any).encumbrance;
      }
    }
  }

  // proficiencyBonus (optional)
  if (raw.proficiencyBonus !== undefined) {
    if (typeof raw.proficiencyBonus !== 'number' || !Number.isFinite(raw.proficiencyBonus)) {
      issues.push({ path: 'sheet.proficiencyBonus', message: 'must be a number' });
      delete sheet.proficiencyBonus;
    } else {
      const pb = Math.round(raw.proficiencyBonus);
      // SRD-ish bounds: 2..6 for levels 1..20
      if (pb < 1 || pb > 10) {
        issues.push({ path: 'sheet.proficiencyBonus', message: 'out of expected range' });
      }
      sheet.proficiencyBonus = pb;
    }
  } else {
    // Calculate proficiency bonus if not set (SRD-compatible formula: 2 + (level - 1) / 4, rounded up)
    sheet.proficiencyBonus = Math.ceil(2 + (opts.level - 1) / 4);
  }

  // Safety: avoid giant payloads
  try {
    const size = JSON.stringify(sheet).length;
    if (size > 50_000) {
      issues.push({ path: 'sheet', message: 'payload too large (max 50kb JSON)' });
    }
  } catch {
    issues.push({ path: 'sheet', message: 'must be JSON-serializable' });
  }

  return { sheet, issues };
}

