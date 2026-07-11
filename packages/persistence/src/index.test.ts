import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARTIFACT_FORMAT_VERSION, DomainValidationError } from '@browser-blackbox/domain';
import { describe, expect, it } from 'vitest';
import {
  assessArtifactExportSafety,
  assessArtifactManifestCompatibility,
  applyMigrations,
  countAppliedMigrations,
  createInMemoryDatabase,
  createSqliteEngine,
  deserializeSnapshotEnvelope,
  FileBackedSqliteStore,
  listTables,
  migrations,
  readArtifactBundle,
  serializeSnapshotEnvelope,
  prepareSnapshotForArtifactExport,
  storedArtifactContentsFixture,
  SqliteRunRepository,
  storedRunSnapshotFixture,
  writeArtifactBundle,
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
        'flow_projections',
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

  it('persists reopened artifact projections separately from working copies', () => {
    const database = createInMemoryDatabase(sql);
    applyMigrations(database);

    const repository = new SqliteRunRepository(database);
    const reopenedSnapshot = {
      ...storedRunSnapshotFixture,
      projection: {
        projectionId: 'projection-reopened-001',
        kind: 'reopened-artifact' as const,
        sourceBundlePath: 'C:/runs/run-001',
        sourceArtifactFormatVersion: '1.0.0',
        createdAt: '2026-06-24T17:00:00.000Z',
        updatedAt: '2026-06-24T17:00:00.000Z',
      },
      flow: {
        ...storedRunSnapshotFixture.flow,
        flowId: 'flow-002',
      },
    };

    repository.saveSnapshot(storedRunSnapshotFixture);
    repository.saveSnapshot(reopenedSnapshot);

    expect(repository.loadSnapshot('flow-001')?.projection.kind).toBe('working-copy');
    expect(repository.loadSnapshot('flow-002')?.projection).toEqual(reopenedSnapshot.projection);
  });
});

describe('file-backed sqlite store', async () => {
  const sql = await createSqliteEngine();

  it('persists a run snapshot to disk and reloads it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-blackbox-persistence-'));
    const databasePath = join(directory, 'run-store.sqlite');

    try {
      const writer = new FileBackedSqliteStore(sql, databasePath);
      await writer.saveSnapshot(storedRunSnapshotFixture);
      writer.close();

      const reader = new FileBackedSqliteStore(sql, databasePath);
      const loaded = await reader.loadSnapshot(storedRunSnapshotFixture.flow.flowId);
      reader.close();

      expect(loaded).toEqual(storedRunSnapshotFixture);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('snapshot envelope serialization', () => {
  it('round-trips a stored snapshot through deterministic JSON', () => {
    const serialized = serializeSnapshotEnvelope(storedRunSnapshotFixture);
    const envelope = deserializeSnapshotEnvelope(serialized);

    expect(envelope.envelopeVersion).toBe('1.0.0');
    expect(envelope.snapshot).toEqual(storedRunSnapshotFixture);
  });

  it('hydrates default project settings when older snapshots omit them', () => {
    const serialized = JSON.stringify({
      envelopeVersion: '1.0.0',
      exportedAt: '2026-07-10T21:00:00.000Z',
      snapshot: {
        ...storedRunSnapshotFixture,
        projectSettings: undefined,
      },
    });

    const envelope = deserializeSnapshotEnvelope(serialized);

    expect(envelope.snapshot.projectSettings).toMatchObject({
      capturePolicy: {
        captureRequestBodies: true,
        captureResponseBodies: true,
        responseBodyCaptureMode: 'safe-default',
        responseBodySizeLimitBytes: 262144,
        sensitiveEndpointPatterns: [],
      },
    });
  });

  it('rejects malformed snapshot envelopes', () => {
    expect(() =>
      deserializeSnapshotEnvelope(
        JSON.stringify({
          envelopeVersion: '1.0.0',
          exportedAt: 'not-a-date',
          snapshot: storedRunSnapshotFixture,
        }),
      ),
    ).toThrow(DomainValidationError);
  });
});

describe('artifact bundle io', () => {
  it('assesses visible full bodies and strips them from safe export snapshots', () => {
    const snapshot = {
      ...storedRunSnapshotFixture,
      captures: [
        {
          ...storedRunSnapshotFixture.captures[0],
          request: {
            ...storedRunSnapshotFixture.captures[0]!.request,
            body: {
              state: 'full' as const,
              contentType: 'application/json',
              text: '{"profile":{"email":"qa@example.test"}}',
            },
          },
        },
      ],
    };

    const assessment = assessArtifactExportSafety(snapshot);
    expect(assessment).toEqual({
      warningCount: 1,
      findings: [
        expect.objectContaining({
          captureId: 'request-auth-login',
          side: 'request',
          reason: 'email-like-content',
        }),
      ],
    });

    const prepared = prepareSnapshotForArtifactExport(snapshot, 'safe-redacted');
    expect(prepared.snapshot.captures[0]?.request.body).toMatchObject({
      state: 'excluded',
    });
    expect(prepared.snapshot.captures[0]?.response?.body).toMatchObject({
      state: 'full',
    });
  });

  it('writes and reads a reopenable artifact bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-blackbox-bundle-'));

    try {
      await writeArtifactBundle({
        rootDirectory: directory,
        snapshot: storedRunSnapshotFixture,
        artifactContents: storedArtifactContentsFixture,
      });

      const bundle = await readArtifactBundle(directory);

      expect(bundle.snapshot).toEqual(storedRunSnapshotFixture);
      expect(bundle.manifest).toEqual(storedRunSnapshotFixture.manifest);
      expect(bundle.missingOptionalArtifacts).toEqual(['media/video/session.webm']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails clearly when a present required artifact payload is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-blackbox-bundle-'));

    try {
      await expect(
        writeArtifactBundle({
          rootDirectory: directory,
          snapshot: storedRunSnapshotFixture,
          artifactContents: {},
        }),
      ).rejects.toThrow('present artifact generated/test.spec.ts is missing file content');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports unsupported artifact versions', () => {
    const compatibility = assessArtifactManifestCompatibility(
      {
        ...storedRunSnapshotFixture.manifest,
        artifactFormatVersion: '3.0.0',
      },
      ARTIFACT_FORMAT_VERSION,
    );

    expect(compatibility).toEqual({
      ok: false,
      reason: 'unsupported-version',
      manifestVersion: '3.0.0',
      supportedMajorVersions: [1],
    });
  });
});
