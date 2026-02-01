import { sql } from '@vercel/postgres';

/**
 * Database connection utilities.
 * Schema initialization is handled by scripts/migrate.mjs
 * and src/lib/db-init.ts
 * 
 * Note: @vercel/postgres doesn't support explicit transactions.
 * Each query is auto-committed. For atomicity, use single SQL statements
 * with CTEs (Common Table Expressions) or combine operations in a single query.
 */

export { sql };
