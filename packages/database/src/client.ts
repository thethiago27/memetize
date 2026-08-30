import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = ReturnType<typeof drizzle<Schema>>;
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
