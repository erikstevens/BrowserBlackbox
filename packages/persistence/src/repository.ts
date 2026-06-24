import {
  deterministicSerialize,
  parseArtifactManifest,
  parseCheckpoint,
  parseDiagnosisResult,
  parseRecordedStep,
  parseRedactionRule,
  parseRequestResponseCapture,
  parseSimulationRule,
  parseTimelineEvent,
} from '@browser-blackbox/domain';
import type {
  ArtifactManifest,
  Checkpoint,
  DiagnosisResult,
  RecordedStep,
  RedactionRule,
  RequestResponseCapture,
  SimulationRule,
  TimelineEvent,
} from '@browser-blackbox/domain';
import type { Database, QueryExecResult } from 'sql.js';
import type { StoredRunSnapshot } from './contracts';

type SqlValue = string | number | null;
type RowObject = Record<string, SqlValue>;

export class SqliteRunRepository {
  constructor(private readonly database: Database) {}

  saveSnapshot(snapshot: StoredRunSnapshot): void {
    this.database.run('BEGIN');

    try {
      this.deleteFlow(snapshot.flow.flowId);
      this.insertSession(snapshot);
      this.insertFlow(snapshot);
      this.insertSteps(snapshot.flow.flowId, snapshot.steps);
      this.insertRequestCaptures(snapshot.flow.flowId, snapshot.captures);
      this.insertRedactionRules(snapshot.flow.flowId, snapshot.redactionRules);
      this.insertSimulationRules(snapshot.flow.flowId, snapshot.simulationRules);
      this.insertTimelineEvents(snapshot.flow.flowId, snapshot.timeline);
      this.insertCheckpoints(snapshot.flow.flowId, snapshot.checkpoints);
      this.insertDiagnosis(snapshot.flow.flowId, snapshot.diagnosis);
      this.insertArtifacts(snapshot.flow.flowId, snapshot.manifest.artifacts);
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  loadSnapshot(flowId: string): StoredRunSnapshot | null {
    const flowRows = queryRows(
      this.database,
      `SELECT flow_id, session_id, schema_version, created_at, manifest_json FROM flows WHERE flow_id = ?;`,
      [flowId],
    );

    if (flowRows.length === 0) {
      return null;
    }

    const flowRow = flowRows[0];
    const sessionRows = queryRows(
      this.database,
      `SELECT session_id, run_id, target_url, app_version, browser_target, created_at, updated_at
       FROM sessions WHERE session_id = ?;`,
      [flowRow.session_id],
    );

    if (sessionRows.length === 0) {
      throw new Error(`Flow ${flowId} is missing its parent session`);
    }

    const manifest = parseArtifactManifest(JSON.parse(String(flowRow.manifest_json)));
    const diagnosisRows = queryRows(
      this.database,
      `SELECT diagnosis_json FROM diagnosis_results WHERE flow_id = ?;`,
      [flowId],
    );

    return {
      session: {
        sessionId: String(sessionRows[0].session_id),
        runId: String(sessionRows[0].run_id),
        targetUrl: String(sessionRows[0].target_url),
        appVersion: String(sessionRows[0].app_version),
        browserTarget: sessionRows[0].browser_target as StoredRunSnapshot['session']['browserTarget'],
        createdAt: String(sessionRows[0].created_at),
        updatedAt: String(sessionRows[0].updated_at),
      },
      flow: {
        flowId: String(flowRow.flow_id),
        schemaVersion: String(flowRow.schema_version),
        createdAt: String(flowRow.created_at),
      },
      manifest,
      steps: queryRows(
        this.database,
        `SELECT payload_json FROM steps WHERE flow_id = ? ORDER BY sort_order ASC;`,
        [flowId],
      ).map((row) => parseRecordedStep(JSON.parse(String(row.payload_json)))),
      captures: queryRows(
        this.database,
        `SELECT capture_json FROM request_captures WHERE flow_id = ? ORDER BY timestamp ASC;`,
        [flowId],
      ).map((row) => parseRequestResponseCapture(JSON.parse(String(row.capture_json)))),
      redactionRules: queryRows(
        this.database,
        `SELECT rule_json FROM redaction_rules WHERE flow_id = ? ORDER BY rule_id ASC;`,
        [flowId],
      ).map((row) => parseRedactionRule(JSON.parse(String(row.rule_json)))),
      simulationRules: queryRows(
        this.database,
        `SELECT rule_json FROM simulation_rules WHERE flow_id = ? ORDER BY rule_id ASC;`,
        [flowId],
      ).map((row) => parseSimulationRule(JSON.parse(String(row.rule_json)))),
      timeline: queryRows(
        this.database,
        `SELECT payload_json FROM timeline_events WHERE flow_id = ? ORDER BY timestamp ASC;`,
        [flowId],
      ).map((row) => parseTimelineEvent(JSON.parse(String(row.payload_json)))),
      checkpoints: queryRows(
        this.database,
        `SELECT checkpoint_json FROM checkpoints WHERE flow_id = ? ORDER BY created_at ASC;`,
        [flowId],
      ).map((row) => parseCheckpoint(JSON.parse(String(row.checkpoint_json)))),
      diagnosis:
        diagnosisRows.length > 0
          ? parseDiagnosisResult(JSON.parse(String(diagnosisRows[0].diagnosis_json)))
          : null,
    };
  }

  private deleteFlow(flowId: string): void {
    const existing = queryRows(
      this.database,
      `SELECT session_id FROM flows WHERE flow_id = ?;`,
      [flowId],
    );

    if (existing.length === 0) {
      return;
    }

    const sessionId = String(existing[0].session_id);

    this.database.run(`DELETE FROM step_dependencies WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM steps WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM request_captures WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM redaction_rules WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM simulation_rules WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM timeline_events WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM checkpoints WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM diagnosis_results WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM artifacts WHERE flow_id = ?;`, [flowId]);
    this.database.run(`DELETE FROM flows WHERE flow_id = ?;`, [flowId]);
    this.database.run(
      `
      DELETE FROM sessions
      WHERE session_id = ?
      AND NOT EXISTS (SELECT 1 FROM flows WHERE session_id = ?);
      `,
      [sessionId, sessionId],
    );
  }

  private insertSession(snapshot: StoredRunSnapshot): void {
    this.database.run(
      `
      INSERT INTO sessions (
        session_id, run_id, target_url, app_version, browser_target, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        run_id = excluded.run_id,
        target_url = excluded.target_url,
        app_version = excluded.app_version,
        browser_target = excluded.browser_target,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at;
      `,
      [
        snapshot.session.sessionId,
        snapshot.session.runId,
        snapshot.session.targetUrl,
        snapshot.session.appVersion,
        snapshot.session.browserTarget,
        snapshot.session.createdAt,
        snapshot.session.updatedAt,
      ],
    );
  }

  private insertFlow(snapshot: StoredRunSnapshot): void {
    this.database.run(
      `
      INSERT INTO flows (flow_id, session_id, schema_version, created_at, manifest_json)
      VALUES (?, ?, ?, ?, ?);
      `,
      [
        snapshot.flow.flowId,
        snapshot.session.sessionId,
        snapshot.flow.schemaVersion,
        snapshot.flow.createdAt,
        deterministicSerialize(snapshot.manifest),
      ],
    );
  }

  private insertSteps(flowId: string, steps: RecordedStep[]): void {
    steps.forEach((step, index) => {
      this.database.run(
        `
        INSERT INTO steps (
          step_id, flow_id, sort_order, kind, title, status, evidence_state, created_at, updated_at,
          invalidates_evidence_after, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          step.id,
          flowId,
          index,
          step.kind,
          step.title,
          step.status,
          step.evidenceState,
          step.createdAt,
          step.updatedAt,
          step.invalidatesEvidenceAfter ? 1 : 0,
          deterministicSerialize(step),
        ],
      );

      step.dependencyStepIds.forEach((dependencyId) => {
        this.database.run(
          `
          INSERT INTO step_dependencies (flow_id, step_id, depends_on_step_id)
          VALUES (?, ?, ?);
          `,
          [flowId, step.id, dependencyId],
        );
      });
    });
  }

  private insertRequestCaptures(flowId: string, captures: RequestResponseCapture[]): void {
    captures.forEach((capture) => {
      this.database.run(
        `
        INSERT INTO request_captures (
          capture_id, flow_id, timestamp, triggering_step_id, protocol, duration_ms, retry_count, blocked,
          request_json, response_json, failure_json, correlation_ids_json, origin_json, timings_json, capture_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          capture.id,
          flowId,
          capture.timestamp,
          capture.triggeringStepId ?? null,
          capture.protocol,
          capture.durationMs ?? null,
          capture.retryCount,
          capture.blocked ? 1 : 0,
          deterministicSerialize(capture.request),
          capture.response ? deterministicSerialize(capture.response) : null,
          capture.failure ? deterministicSerialize(capture.failure) : null,
          deterministicSerialize(capture.correlationIds),
          deterministicSerialize(capture.origin),
          capture.timings ? deterministicSerialize(capture.timings) : null,
          deterministicSerialize(capture),
        ],
      );
    });
  }

  private insertRedactionRules(flowId: string, rules: RedactionRule[]): void {
    rules.forEach((rule) => {
      this.database.run(
        `
        INSERT INTO redaction_rules (rule_id, flow_id, kind, scope, mode, target, rule_json)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        `,
        [
          rule.id,
          flowId,
          rule.kind,
          rule.scope,
          rule.mode,
          rule.target,
          deterministicSerialize(rule),
        ],
      );
    });
  }

  private insertSimulationRules(flowId: string, rules: SimulationRule[]): void {
    rules.forEach((rule) => {
      this.database.run(
        `
        INSERT INTO simulation_rules (
          rule_id, flow_id, enabled, title, applies_to, match_scope_json, action_json, rule_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          rule.id,
          flowId,
          rule.enabled ? 1 : 0,
          rule.title,
          rule.appliesTo,
          deterministicSerialize(rule.match),
          deterministicSerialize(rule.action),
          deterministicSerialize(rule),
        ],
      );
    });
  }

  private insertTimelineEvents(flowId: string, events: TimelineEvent[]): void {
    events.forEach((event) => {
      this.database.run(
        `
        INSERT INTO timeline_events (event_id, flow_id, timestamp, kind, step_id, summary, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        `,
        [
          event.id,
          flowId,
          event.timestamp,
          event.kind,
          'stepId' in event ? event.stepId ?? null : null,
          event.summary,
          deterministicSerialize(event),
        ],
      );
    });
  }

  private insertCheckpoints(flowId: string, checkpoints: Checkpoint[]): void {
    checkpoints.forEach((checkpoint) => {
      this.database.run(
        `
        INSERT INTO checkpoints (
          checkpoint_id, flow_id, step_id, label, kind, created_at, status,
          dependency_step_ids_json, invalidation_reasons_json, captures_json, checkpoint_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        `,
        [
          checkpoint.id,
          flowId,
          checkpoint.stepId,
          checkpoint.label,
          checkpoint.kind,
          checkpoint.createdAt,
          checkpoint.status,
          deterministicSerialize(checkpoint.dependencyStepIds),
          deterministicSerialize(checkpoint.invalidationReasons),
          deterministicSerialize(checkpoint.captures),
          deterministicSerialize(checkpoint),
        ],
      );
    });
  }

  private insertDiagnosis(flowId: string, diagnosis: DiagnosisResult | null): void {
    if (diagnosis === null) {
      return;
    }

    this.database.run(
      `
      INSERT INTO diagnosis_results (flow_id, diagnosis_json)
      VALUES (?, ?);
      `,
      [flowId, deterministicSerialize(diagnosis)],
    );
  }

  private insertArtifacts(flowId: string, artifacts: ArtifactManifest['artifacts']): void {
    artifacts.forEach((artifact) => {
      this.database.run(
        `
        INSERT INTO artifacts (flow_id, path, kind, required, present)
        VALUES (?, ?, ?, ?, ?);
        `,
        [
          flowId,
          artifact.path,
          artifact.kind,
          artifact.required ? 1 : 0,
          artifact.present ? 1 : 0,
        ],
      );
    });
  }
}

function queryRows(database: Database, sql: string, params: SqlValue[] = []): RowObject[] {
  const results = database.exec(sql, params) as QueryExecResult[];

  if (results.length === 0) {
    return [];
  }

  const [result] = results;
  return result.values.map((row: unknown[]) =>
    result.columns.reduce<RowObject>((accumulator: RowObject, column: string, index: number) => {
      const value = row[index];
      accumulator[column] =
        value === null || typeof value === 'string' || typeof value === 'number'
          ? value
          : String(value);
      return accumulator;
    }, {}),
  );
}
