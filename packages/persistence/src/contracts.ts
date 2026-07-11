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
import type { ProjectSettings } from '@browser-blackbox/shared';

export type StoredRunProjection = {
  projectionId: string;
  kind: 'working-copy' | 'reopened-artifact';
  sourceBundlePath?: string;
  sourceArtifactFormatVersion?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredRunSnapshot = {
  projection: StoredRunProjection;
  session: {
    sessionId: string;
    runId: string;
    targetUrl: string;
    appVersion: string;
    browserTarget: ArtifactManifest['replayEngine']['browserTarget'];
    createdAt: string;
    updatedAt: string;
  };
  flow: {
    flowId: string;
    schemaVersion: string;
    createdAt: string;
  };
  manifest: ArtifactManifest;
  projectSettings: ProjectSettings;
  steps: RecordedStep[];
  captures: RequestResponseCapture[];
  redactionRules: RedactionRule[];
  simulationRules: SimulationRule[];
  timeline: TimelineEvent[];
  checkpoints: Checkpoint[];
  diagnosis: DiagnosisResult | null;
};

export type StoredRunSnapshotEnvelope = {
  envelopeVersion: '1.0.0';
  exportedAt: string;
  snapshot: StoredRunSnapshot;
};

export type ArtifactBundleWriteInput = {
  rootDirectory: string;
  snapshot: StoredRunSnapshot;
  artifactContents?: Record<string, string>;
};

export type ArtifactBundleReadResult = {
  manifest: StoredRunSnapshot['manifest'];
  snapshot: StoredRunSnapshot;
  missingOptionalArtifacts: string[];
};

export type ArtifactCompatibilityAssessment =
  | {
      ok: true;
      supportedMajorVersions: number[];
    }
  | {
      ok: false;
      reason: 'unsupported-version';
      manifestVersion: string;
      supportedMajorVersions: number[];
    };

export type ArtifactExportWarning = {
  captureId: string;
  side: 'request' | 'response';
  url: string;
  reason:
    | 'email-like-content'
    | 'credential-keyword'
    | 'authorization-token-pattern'
    | 'session-identifier-pattern';
  preview: string;
};

export type ArtifactExportSafetyAssessment = {
  warningCount: number;
  findings: ArtifactExportWarning[];
};

export type ArtifactExportMode = 'safe-redacted' | 'unsafe-unredacted';

export type ArtifactBundleExportResult = {
  assessment: ArtifactExportSafetyAssessment;
  mode: ArtifactExportMode;
  rootDirectory: string;
};
