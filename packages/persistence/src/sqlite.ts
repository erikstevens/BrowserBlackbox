import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import { migrations, type SqliteMigration } from './migrations';

export type SqliteDatabase = Database;

export async function createSqliteEngine(): Promise<SqlJsStatic> {
  return initSqlJs({});
}

export function createInMemoryDatabase(sql: SqlJsStatic): SqliteDatabase {
  const database = new sql.Database();
  database.run('PRAGMA foreign_keys = ON;');
  return database;
}

export function applyMigrations(
  database: SqliteDatabase,
  allMigrations: SqliteMigration[] = migrations,
): void {
  database.run('PRAGMA foreign_keys = ON;');
  database.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of allMigrations) {
    const existing = database.exec(
      `SELECT id FROM schema_migrations WHERE id = ${migration.id} LIMIT 1;`,
    );

    if (existing.length > 0) {
      continue;
    }

    database.run('BEGIN');

    try {
      database.run(migration.sql);
      database.run(
        `INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?);`,
        [migration.id, migration.name, new Date().toISOString()],
      );
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }
  }
}

export function listTables(database: SqliteDatabase): string[] {
  const result = database.exec(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `);

  if (result.length === 0) {
    return [];
  }

  return result[0].values.map((row: unknown[]) => String(row[0]));
}

export function countAppliedMigrations(database: SqliteDatabase): number {
  const result = database.exec(`SELECT COUNT(*) FROM schema_migrations;`);
  return Number(result[0]?.values[0]?.[0] ?? 0);
}
