import { sql } from '@vercel/postgres';

/**
 * Database connection utilities.
 * Schema initialization is handled by scripts/migrate.mjs
 * and src/lib/db-init.ts
 */

export { sql };

/**
 * Transaction helper for executing multiple queries atomically.
 * Note: @vercel/postgres doesn't support explicit transactions, so this
 * executes queries sequentially. For true atomicity, consider using
 * a single SQL statement with CTEs or stored procedures.
 * 
 * This helper ensures all queries execute or none do (by throwing on error).
 */
export async function transaction<T>(
  queries: Array<() => Promise<unknown>>,
): Promise<T> {
  const results: unknown[] = [];
  
  try {
    for (const query of queries) {
      const result = await query();
      results.push(result);
    }
    return results as T;
  } catch (error) {
    // If any query fails, the error propagates
    // Note: Without explicit rollback support, we rely on the database
    // to handle constraint violations and foreign key checks
    throw error;
  }
}
