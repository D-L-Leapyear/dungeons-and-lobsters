export function isAdmin(req: Request) {
  const token = process.env.DNL_ADMIN_TOKEN;
  if (!token) return false;

  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const alt = req.headers.get('x-admin-token');
  const provided = bearer || alt;

  return !!provided && provided === token;
}

export function requireAdmin(req: Request) {
  if (!process.env.DNL_ADMIN_TOKEN) {
    throw new Error('Admin token not configured (DNL_ADMIN_TOKEN)');
  }
  if (!isAdmin(req)) {
    throw new Error('Unauthorized');
  }
}
