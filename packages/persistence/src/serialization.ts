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
import { DomainValidationError } from '@browser-blackbox/domain';
import type { StoredRunSnapshot, StoredRunSnapshotEnvelope } from './contracts';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

export function serializeSnapshotEnvelope(snapshot: StoredRunSnapshot): string {
  const envelope: StoredRunSnapshotEnvelope = {
    envelopeVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    snapshot: parseStoredRunSnapshot(snapshot),
  };

  return deterministicSerialize(envelope);
}

export function deserializeSnapshotEnvelope(serialized: string): StoredRunSnapshotEnvelope {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new DomainValidationError('StoredRunSnapshotEnvelope', [
      `invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  return parseStoredRunSnapshotEnvelope(parsed);
}

export function parseStoredRunSnapshotEnvelope(value: unknown): StoredRunSnapshotEnvelope {
  if (!isRecord(value)) {
    throw new DomainValidationError('StoredRunSnapshotEnvelope', ['envelope must be an object']);
  }

  const issues: string[] = [];

  if (value.envelopeVersion !== '1.0.0') {
    issues.push('envelopeVersion must equal 1.0.0');
  }

  if (!isIsoTimestamp(value.exportedAt)) {
    issues.push('exportedAt must be an ISO timestamp');
  }

  try {
    const snapshot = parseStoredRunSnapshot(value.snapshot);

    if (issues.length > 0) {
      throw new DomainValidationError('StoredRunSnapshotEnvelope', issues);
    }

    return {
      envelopeVersion: '1.0.0',
      exportedAt: String(value.exportedAt),
      snapshot,
    };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      issues.push(...error.issues.map((issue) => `snapshot.${issue}`));
    } else {
      issues.push(String(error));
    }
  }

  throw new DomainValidationError('StoredRunSnapshotEnvelope', issues);
}

export function parseStoredRunSnapshot(value: unknown): StoredRunSnapshot {
  if (!isRecord(value)) {
    throw new DomainValidationError('StoredRunSnapshot', ['snapshot must be an object']);
  }

  const issues: string[] = [];

  if (!isRecord(value.session)) {
    issues.push('session must be an object');
  }

  if (!isRecord(value.flow)) {
    issues.push('flow must be an object');
  }

  if (issues.length > 0) {
    throw new DomainValidationError('StoredRunSnapshot', issues);
  }

  const session = value.session as UnknownRecord;
  const flow = value.flow as UnknownRecord;

  const sessionIssues = [
    ['session.sessionId', session.sessionId],
    ['session.runId', session.runId],
    ['session.targetUrl', session.targetUrl],
    ['session.appVersion', session.appVersion],
    ['session.browserTarget', session.browserTarget],
    ['session.createdAt', session.createdAt],
    ['session.updatedAt', session.updatedAt],
  ].flatMap(([field, entry]) => {
    if ((field === 'session.createdAt' || field === 'session.updatedAt') && isIsoTimestamp(entry)) {
      return [];
    }
    if (field === 'session.browserTarget' && entry === 'chromium') {
      return [];
    }
    return isNonEmptyString(entry) ? [] : [`${field} must be valid`];
  });

  const flowIssues = [
    ['flow.flowId', flow.flowId],
    ['flow.schemaVersion', flow.schemaVersion],
    ['flow.createdAt', flow.createdAt],
  ].flatMap(([field, entry]) => {
    if (field === 'flow.createdAt') {
      return isIsoTimestamp(entry) ? [] : [`${field} must be an ISO timestamp`];
    }
    return isNonEmptyString(entry) ? [] : [`${field} must be valid`];
  });

  issues.push(...sessionIssues, ...flowIssues);

  if (!Array.isArray(value.steps)) {
    issues.push('steps must be an array');
  }
  if (!Array.isArray(value.captures)) {
    issues.push('captures must be an array');
  }
  if (!Array.isArray(value.redactionRules)) {
    issues.push('redactionRules must be an array');
  }
  if (!Array.isArray(value.simulationRules)) {
    issues.push('simulationRules must be an array');
  }
  if (!Array.isArray(value.timeline)) {
    issues.push('timeline must be an array');
  }
  if (!Array.isArray(value.checkpoints)) {
    issues.push('checkpoints must be an array');
  }

  if (issues.length > 0) {
    throw new DomainValidationError('StoredRunSnapshot', issues);
  }

  return {
    session: {
      sessionId: String(session.sessionId),
      runId: String(session.runId),
      targetUrl: String(session.targetUrl),
      appVersion: String(session.appVersion),
      browserTarget: 'chromium',
      createdAt: String(session.createdAt),
      updatedAt: String(session.updatedAt),
    },
    flow: {
      flowId: String(flow.flowId),
      schemaVersion: String(flow.schemaVersion),
      createdAt: String(flow.createdAt),
    },
    manifest: parseArtifactManifest(value.manifest),
    steps: (value.steps as unknown[]).map((entry) => parseRecordedStep(entry)),
    captures: (value.captures as unknown[]).map((entry) => parseRequestResponseCapture(entry)),
    redactionRules: (value.redactionRules as unknown[]).map((entry) => parseRedactionRule(entry)),
    simulationRules: (value.simulationRules as unknown[]).map((entry) => parseSimulationRule(entry)),
    timeline: (value.timeline as unknown[]).map((entry) => parseTimelineEvent(entry)),
    checkpoints: (value.checkpoints as unknown[]).map((entry) => parseCheckpoint(entry)),
    diagnosis:
      value.diagnosis === null || value.diagnosis === undefined
        ? null
        : parseDiagnosisResult(value.diagnosis),
  };
}
