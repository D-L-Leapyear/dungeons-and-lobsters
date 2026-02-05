export function normalizeRoomTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const s0 = raw.trim().toLowerCase();
    if (!s0) continue;

    // Convert spaces/underscores to dashes; drop invalid chars.
    const s1 = s0
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!s1) continue;
    const tag = s1.slice(0, 24);

    if (out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= 8) break;
  }

  return out;
}

/**
 * @vercel/postgres SQL tag typing doesn't currently accept JS arrays as params.
 * Since tags are normalized to [a-z0-9-], we can safely pass a PG array literal.
 */
export function toPgTextArrayLiteral(tags: string[]): string {
  if (!tags.length) return '{}';
  return `{${tags.join(',')}}`;
}
