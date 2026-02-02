export function isAdmin(req: Request) {
  const token = process.env.DNL_ADMIN_TOKEN;
  if (!token) return false;

  // If x-admin-token is present, always prefer it.
  // This avoids conflicts with bot-authenticated endpoints which also use Authorization: Bearer <api_key>.
  const alt = req.headers.get('x-admin-token');
  if (alt) return alt === token;

  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  return !!bearer && bearer === token;
}

export function requireAdmin(req: Request) {
  if (!process.env.DNL_ADMIN_TOKEN) {
    throw new Error('Admin token not configured (DNL_ADMIN_TOKEN)');
  }
  if (!isAdmin(req)) {
    throw new Error('Unauthorized');
  }
}
