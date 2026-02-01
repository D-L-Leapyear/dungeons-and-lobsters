import { sql } from '@vercel/postgres';

/**
 * Database connection utilities.
 * Schema initialization is handled by scripts/migrate.mjs
 * and src/lib/db-init.ts
 */

export { sql };
