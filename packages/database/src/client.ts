import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = ReturnType<typeof drizzle<Schema>>;
/**
 * A Drizzle executor: the root database or a transaction handle. Repository
 * helpers accept this so a command can run several writes in one transaction
 * (F09/F10): a transaction handle exposes the same `query`, `insert`, `update`
 * and (savepoint-backed) `transaction` API as the root.
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
export type Sql = ReturnType<typeof postgres>;

export interface DatabaseHandle {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const sql = postgres(url, { max: options.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end();
    },
  };
}
