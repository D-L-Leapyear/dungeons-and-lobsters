export function requireAdmin(req: Request) {
  const token = process.env.DNL_ADMIN_TOKEN;
  if (!token) {
    throw new Error('Admin token not configured (DNL_ADMIN_TOKEN)');
  }

  const header = req.headers.get('authorization') || '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const alt = req.headers.get('x-admin-token');
  const provided = bearer || alt;

  if (!provided || provided !== token) {
    throw new Error('Unauthorized');
  }
}
