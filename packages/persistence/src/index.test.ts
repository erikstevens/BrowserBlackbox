import { describe, expect, it } from 'vitest';
import {
  applyMigrations,
  countAppliedMigrations,
  createInMemoryDatabase,
  createSqliteEngine,
  listTables,
  migrations,
  SqliteRunRepository,
  storedRunSnapshotFixture,
} from './index';

describe('persistence migrations', async () => {
  const sql = await createSqliteEngine();

  it('boots the schema and records each migration once', () => {
    const database = createInMemoryDatabase(sql);

    applyMigrations(database);
    applyMigrations(database);

    expect(countAppliedMigrations(database)).toBe(migrations.length);
    expect(listTables(database)).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'sessions',
        'flows',
        'steps',
        'step_dependencies',
        'request_captures',
        'redaction_rules',
        'simulation_rules',
        'timeline_events',
        'checkpoints',
        'diagnosis_results',
        'artifacts',
      ]),
    );
  });
});

describe('sqlite run repository', async () => {
  const sql = await createSqliteEngine();

  it('round-trips a stored run snapshot through normalized tables', () => {
    const database = createInMemoryDatabase(sql);
    applyMigrations(database);

    const repository = new SqliteRunRepository(database);
    repository.saveSnapshot(storedRunSnapshotFixture);

    const loaded = repository.loadSnapshot(storedRunSnapshotFixture.flow.flowId);

    expect(loaded).toEqual(storedRunSnapshotFixture);
  });

  it('replaces an existing flow snapshot without duplicating rows', () => {
    const database = createInMemoryDatabase(sql);
    applyMigrations(database);

    const repository = new SqliteRunRepository(database);
    repository.saveSnapshot(storedRunSnapshotFixture);
    repository.saveSnapshot({
      ...storedRunSnapshotFixture,
      session: {
        ...storedRunSnapshotFixture.session,
        updatedAt: '2026-06-24T16:00:00.000Z',
      },
      diagnosis: null,
      timeline: storedRunSnapshotFixture.timeline.slice(0, 1),
    });

    const loaded = repository.loadSnapshot(storedRunSnapshotFixture.flow.flowId);

    expect(loaded?.session.updatedAt).toBe('2026-06-24T16:00:00.000Z');
    expect(loaded?.diagnosis).toBeNull();
    expect(loaded?.timeline).toHaveLength(1);
  });

  it('returns null for unknown flow ids', () => {
    const database = createInMemoryDatabase(sql);
    applyMigrations(database);

    const repository = new SqliteRunRepository(database);
    expect(repository.loadSnapshot('missing-flow')).toBeNull();
  });
});
