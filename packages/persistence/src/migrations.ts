export type SqliteMigration = {
  id: number;
  name: string;
  sql: string;
};

export const migrations: SqliteMigration[] = [
  {
    id: 1,
    name: 'initial_run_storage',
    sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        target_url TEXT NOT NULL,
        app_version TEXT NOT NULL,
        browser_target TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flows (
        flow_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS steps (
        step_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        invalidates_evidence_after INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS step_dependencies (
        flow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        depends_on_step_id TEXT NOT NULL,
        PRIMARY KEY (flow_id, step_id, depends_on_step_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE,
        FOREIGN KEY (step_id) REFERENCES steps(step_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS request_captures (
        capture_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        triggering_step_id TEXT,
        protocol TEXT NOT NULL,
        duration_ms REAL,
        retry_count INTEGER NOT NULL,
        blocked INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        failure_json TEXT,
        correlation_ids_json TEXT NOT NULL,
        origin_json TEXT NOT NULL,
        timings_json TEXT,
        capture_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS redaction_rules (
        rule_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        mode TEXT NOT NULL,
        target TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS simulation_rules (
        rule_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        title TEXT NOT NULL,
        applies_to TEXT NOT NULL,
        match_scope_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS timeline_events (
        event_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        step_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        dependency_step_ids_json TEXT NOT NULL,
        invalidation_reasons_json TEXT NOT NULL,
        captures_json TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS diagnosis_results (
        flow_id TEXT PRIMARY KEY,
        diagnosis_json TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        flow_id TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        required INTEGER NOT NULL,
        present INTEGER NOT NULL,
        PRIMARY KEY (flow_id, path),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_steps_flow_order ON steps(flow_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_captures_flow_timestamp ON request_captures(flow_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_timeline_flow_timestamp ON timeline_events(flow_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_redaction_rules_flow ON redaction_rules(flow_id);
      CREATE INDEX IF NOT EXISTS idx_simulation_rules_flow ON simulation_rules(flow_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_flow ON checkpoints(flow_id);
    `,
  },
  {
    id: 2,
    name: 'flow_projections',
    sql: `
      CREATE TABLE IF NOT EXISTS flow_projections (
        projection_id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        source_bundle_path TEXT,
        source_artifact_format_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_flow_projections_kind ON flow_projections(kind);
    `,
  },
  {
    id: 3,
    name: 'flow_scoped_entity_keys',
    sql: `
      PRAGMA foreign_keys = OFF;

      ALTER TABLE steps RENAME TO steps_old;
      CREATE TABLE steps (
        step_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        evidence_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        invalidates_evidence_after INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, step_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO steps (
        step_id, flow_id, sort_order, kind, title, status, evidence_state, created_at, updated_at,
        invalidates_evidence_after, payload_json
      )
      SELECT
        step_id, flow_id, sort_order, kind, title, status, evidence_state, created_at, updated_at,
        invalidates_evidence_after, payload_json
      FROM steps_old;
      DROP TABLE steps_old;

      ALTER TABLE step_dependencies RENAME TO step_dependencies_old;
      CREATE TABLE step_dependencies (
        flow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        depends_on_step_id TEXT NOT NULL,
        PRIMARY KEY (flow_id, step_id, depends_on_step_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE,
        FOREIGN KEY (flow_id, step_id) REFERENCES steps(flow_id, step_id) ON DELETE CASCADE,
        FOREIGN KEY (flow_id, depends_on_step_id) REFERENCES steps(flow_id, step_id) ON DELETE CASCADE
      );
      INSERT INTO step_dependencies (flow_id, step_id, depends_on_step_id)
      SELECT flow_id, step_id, depends_on_step_id FROM step_dependencies_old;
      DROP TABLE step_dependencies_old;

      ALTER TABLE request_captures RENAME TO request_captures_old;
      CREATE TABLE request_captures (
        capture_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        triggering_step_id TEXT,
        protocol TEXT NOT NULL,
        duration_ms REAL,
        retry_count INTEGER NOT NULL,
        blocked INTEGER NOT NULL,
        request_json TEXT NOT NULL,
        response_json TEXT,
        failure_json TEXT,
        correlation_ids_json TEXT NOT NULL,
        origin_json TEXT NOT NULL,
        timings_json TEXT,
        capture_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, capture_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO request_captures (
        capture_id, flow_id, timestamp, triggering_step_id, protocol, duration_ms, retry_count, blocked,
        request_json, response_json, failure_json, correlation_ids_json, origin_json, timings_json, capture_json
      )
      SELECT
        capture_id, flow_id, timestamp, triggering_step_id, protocol, duration_ms, retry_count, blocked,
        request_json, response_json, failure_json, correlation_ids_json, origin_json, timings_json, capture_json
      FROM request_captures_old;
      DROP TABLE request_captures_old;

      ALTER TABLE redaction_rules RENAME TO redaction_rules_old;
      CREATE TABLE redaction_rules (
        rule_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        mode TEXT NOT NULL,
        target TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, rule_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO redaction_rules (rule_id, flow_id, kind, scope, mode, target, rule_json)
      SELECT rule_id, flow_id, kind, scope, mode, target, rule_json FROM redaction_rules_old;
      DROP TABLE redaction_rules_old;

      ALTER TABLE simulation_rules RENAME TO simulation_rules_old;
      CREATE TABLE simulation_rules (
        rule_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        title TEXT NOT NULL,
        applies_to TEXT NOT NULL,
        match_scope_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        rule_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, rule_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO simulation_rules (
        rule_id, flow_id, enabled, title, applies_to, match_scope_json, action_json, rule_json
      )
      SELECT
        rule_id, flow_id, enabled, title, applies_to, match_scope_json, action_json, rule_json
      FROM simulation_rules_old;
      DROP TABLE simulation_rules_old;

      ALTER TABLE timeline_events RENAME TO timeline_events_old;
      CREATE TABLE timeline_events (
        event_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        step_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, event_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO timeline_events (event_id, flow_id, timestamp, kind, step_id, summary, payload_json)
      SELECT event_id, flow_id, timestamp, kind, step_id, summary, payload_json FROM timeline_events_old;
      DROP TABLE timeline_events_old;

      ALTER TABLE checkpoints RENAME TO checkpoints_old;
      CREATE TABLE checkpoints (
        checkpoint_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        dependency_step_ids_json TEXT NOT NULL,
        invalidation_reasons_json TEXT NOT NULL,
        captures_json TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL,
        PRIMARY KEY (flow_id, checkpoint_id),
        FOREIGN KEY (flow_id) REFERENCES flows(flow_id) ON DELETE CASCADE
      );
      INSERT INTO checkpoints (
        checkpoint_id, flow_id, step_id, label, kind, created_at, status,
        dependency_step_ids_json, invalidation_reasons_json, captures_json, checkpoint_json
      )
      SELECT
        checkpoint_id, flow_id, step_id, label, kind, created_at, status,
        dependency_step_ids_json, invalidation_reasons_json, captures_json, checkpoint_json
      FROM checkpoints_old;
      DROP TABLE checkpoints_old;

      CREATE INDEX IF NOT EXISTS idx_steps_flow_order ON steps(flow_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_captures_flow_timestamp ON request_captures(flow_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_timeline_flow_timestamp ON timeline_events(flow_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_redaction_rules_flow ON redaction_rules(flow_id);
      CREATE INDEX IF NOT EXISTS idx_simulation_rules_flow ON simulation_rules(flow_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_flow ON checkpoints(flow_id);

      PRAGMA foreign_keys = ON;
    `,
  },
];
