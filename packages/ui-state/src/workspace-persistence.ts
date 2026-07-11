import {
  type ArtifactManifest,
  type Checkpoint,
  type DiagnosisResult,
  domainVersions,
  type RecordedStep,
  type RedactionRule,
  type RequestResponseCapture,
  type SimulationRule,
  type TimelineEvent,
} from '@browser-blackbox/domain';
import type { StoredRunSnapshot } from '@browser-blackbox/persistence/src/contracts';
import type { BrowserRuntimeState } from '@browser-blackbox/runtime-browser';
import type { ProjectSettings } from '@browser-blackbox/shared';
import type { RecordingSession } from './recording-session';

export type WorkspaceWorkingCopyMetadata = {
  projectionId: string;
  flowId: string;
  runId: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspacePersistenceState = {
  targetUrl: string;
  browserRuntime: BrowserRuntimeState;
  recordingSession: RecordingSession;
  workingCopy: WorkspaceWorkingCopyMetadata;
  projectSettings: ProjectSettings;
  captures: RequestResponseCapture[];
  redactionRules: RedactionRule[];
  simulationRules: SimulationRule[];
  timeline: TimelineEvent[];
  diagnosis: DiagnosisResult | null;
};

export function createWorkspaceWorkingCopyMetadata(
  now: string,
  overrides?: Partial<WorkspaceWorkingCopyMetadata>,
): WorkspaceWorkingCopyMetadata {
  const seed = now.replace(/[:.]/g, '-');

  return {
    projectionId: overrides?.projectionId ?? `projection-working-${seed}`,
    flowId: overrides?.flowId ?? 'workspace-working-copy',
    runId: overrides?.runId ?? `run-working-${seed}`,
    sessionId: overrides?.sessionId ?? `session-working-${seed}`,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

export function createStoredRunSnapshotFromWorkspace(
  state: WorkspacePersistenceState,
): StoredRunSnapshot {
  const updatedAt = new Date().toISOString();
  const metadata = {
    ...state.workingCopy,
    updatedAt,
    sessionId: state.browserRuntime.sessionId ?? state.workingCopy.sessionId,
  };
  const manifest = createWorkingCopyManifest({
    targetUrl: state.browserRuntime.targetUrl ?? state.targetUrl,
    runId: metadata.runId,
    createdAt: updatedAt,
  });

  return {
    projection: {
      projectionId: metadata.projectionId,
      kind: 'working-copy',
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    },
    session: {
      sessionId: metadata.sessionId,
      runId: metadata.runId,
      targetUrl: manifest.targetUrl,
      appVersion: manifest.appVersion,
      browserTarget: manifest.replayEngine.browserTarget,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    },
    flow: {
      flowId: metadata.flowId,
      schemaVersion: domainVersions.domainSchemaVersion,
      createdAt: metadata.createdAt,
    },
    manifest,
    projectSettings: state.projectSettings,
    steps: state.recordingSession.present.steps,
    captures: state.captures,
    redactionRules: state.redactionRules,
    simulationRules: state.simulationRules,
    timeline: state.timeline,
    checkpoints: state.recordingSession.present.checkpoints,
    diagnosis: state.diagnosis,
  };
}

export function hydrateWorkspaceFromStoredRunSnapshot(snapshot: StoredRunSnapshot): {
  metadata: WorkspaceWorkingCopyMetadata;
  targetUrl: string;
  projectSettings: ProjectSettings;
  steps: RecordedStep[];
  captures: RequestResponseCapture[];
  redactionRules: RedactionRule[];
  simulationRules: SimulationRule[];
  timeline: TimelineEvent[];
  checkpoints: Checkpoint[];
  diagnosis: DiagnosisResult | null;
} {
  return {
    metadata: {
      projectionId: snapshot.projection.projectionId,
      flowId: snapshot.flow.flowId,
      runId: snapshot.session.runId,
      sessionId: snapshot.session.sessionId,
      createdAt: snapshot.projection.createdAt,
      updatedAt: snapshot.projection.updatedAt,
    },
    targetUrl: snapshot.session.targetUrl,
    projectSettings: snapshot.projectSettings,
    steps: snapshot.steps,
    captures: snapshot.captures,
    redactionRules: snapshot.redactionRules,
    simulationRules: snapshot.simulationRules,
    timeline: snapshot.timeline,
    checkpoints: snapshot.checkpoints,
    diagnosis: snapshot.diagnosis,
  };
}

function createWorkingCopyManifest(input: {
  targetUrl: string;
  runId: string;
  createdAt: string;
}): ArtifactManifest {
  return {
    schemaVersion: domainVersions.domainSchemaVersion,
    artifactFormatVersion: domainVersions.artifactFormatVersion,
    appVersion: '0.1.0',
    createdAt: input.createdAt,
    targetUrl: input.targetUrl,
    runId: input.runId,
    replayEngine: {
      id: 'playwright',
      version: '1.61.1',
      browserTarget: 'chromium',
    },
    redactionPolicyVersion: domainVersions.redactionPolicyVersion,
    checkpointModelVersion: domainVersions.checkpointModelVersion,
    compatibility: {
      minimumAppVersion: '0.1.0',
      supportedArtifactMajorVersions: [1],
    },
    artifacts: [
      {
        path: 'workspace/replay-metadata.json',
        kind: 'replay-metadata',
        required: false,
        present: false,
      },
    ],
  };
}
