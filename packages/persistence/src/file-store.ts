import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SqlJsStatic } from 'sql.js';
import type { StoredRunSnapshot } from './contracts';
import { SqliteRunRepository } from './repository';
import {
  applyMigrations,
  createInMemoryDatabase,
  type SqliteDatabase,
} from './sqlite';

export class FileBackedSqliteStore {
  private database: SqliteDatabase | null = null;
  private repository: SqliteRunRepository | null = null;

  constructor(
    private readonly sql: SqlJsStatic,
    private readonly databasePath: string,
  ) {}

  async open(): Promise<void> {
    if (this.database !== null) {
      return;
    }

    const bytes = await this.readExistingBytes();
    this.database =
      bytes === null
        ? createInMemoryDatabase(this.sql)
        : this.createDatabaseFromBytes(bytes);

    applyMigrations(this.database);
    this.repository = new SqliteRunRepository(this.database);
  }

  async saveSnapshot(snapshot: StoredRunSnapshot): Promise<void> {
    const repository = await this.ensureRepository();
    repository.saveSnapshot(snapshot);
    await this.flush();
  }

  async loadSnapshot(flowId: string): Promise<StoredRunSnapshot | null> {
    const repository = await this.ensureRepository();
    return repository.loadSnapshot(flowId);
  }

  async flush(): Promise<void> {
    const database = await this.ensureDatabase();
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, Buffer.from(database.export()));
  }

  close(): void {
    this.database?.close();
    this.database = null;
    this.repository = null;
  }

  private async ensureRepository(): Promise<SqliteRunRepository> {
    await this.open();

    if (this.repository === null) {
      throw new Error('SQLite repository is not initialized');
    }

    return this.repository;
  }

  private async ensureDatabase(): Promise<SqliteDatabase> {
    await this.open();

    if (this.database === null) {
      throw new Error('SQLite database is not initialized');
    }

    return this.database;
  }

  private createDatabaseFromBytes(bytes: Uint8Array): SqliteDatabase {
    const database = new this.sql.Database(bytes);
    database.run('PRAGMA foreign_keys = ON;');
    return database;
  }

  private async readExistingBytes(): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.databasePath);
      return new Uint8Array(buffer);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;

      if (nodeError.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }
}
