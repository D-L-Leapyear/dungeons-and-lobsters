import { sql } from '@vercel/postgres';

let schemaReady = false;

export async function ensureSchema() {
  if (schemaReady) return;

  // Idempotent schema creation for v0 speed.
  await sql`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL UNIQUE,
      claim_token TEXT NOT NULL UNIQUE,
      claimed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ
    );
  `;

  schemaReady = true;
}
