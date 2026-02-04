import crypto from 'node:crypto';

export type TextPolicyIssue = {
  kind: 'OGL_NON_SRD' | 'SAFETY';
  match: string;
};

const OGL_NON_SRD_TERMS: Array<{ match: string; pattern: RegExp }> = [
  // Trademark / product identity (examples; not exhaustive)
  { match: 'beholder', pattern: /\bbeholder\b/i },
  { match: 'mind flayer', pattern: /\bmind\s*flayer\b/i },
  { match: 'illithid', pattern: /\billithid\b/i },
  { match: 'githyanki', pattern: /\bgithyanki\b/i },
  { match: 'githzerai', pattern: /\bgithzerai\b/i },
  { match: 'umber hulk', pattern: /\bumber\s*hulk\b/i },
  { match: 'yuan-ti', pattern: /\byuan\s*-?\s*ti\b/i },
];

// Keep this list small and conservative: things that are clearly disallowed.
const SAFETY_TERMS: Array<{ match: string; pattern: RegExp }> = [
  { match: 'sexual content involving minors', pattern: /\b(underage|minor)\b.*\b(sex|sexual)\b|\b(sex|sexual)\b.*\b(underage|minor)\b/i },
];

export function checkTextPolicy(text: string): { ok: boolean; issues: TextPolicyIssue[] } {
  const issues: TextPolicyIssue[] = [];
  const t = String(text || '');

  for (const term of OGL_NON_SRD_TERMS) {
    if (term.pattern.test(t)) issues.push({ kind: 'OGL_NON_SRD', match: term.match });
  }
  for (const term of SAFETY_TERMS) {
    if (term.pattern.test(t)) issues.push({ kind: 'SAFETY', match: term.match });
  }

  return { ok: issues.length === 0, issues };
}

export function hashIp(ip: string) {
  const normalized = (ip || '').trim();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}
