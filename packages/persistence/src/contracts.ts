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

export type StoredRunSnapshot = {
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
  steps: RecordedStep[];
  captures: RequestResponseCapture[];
  redactionRules: RedactionRule[];
  simulationRules: SimulationRule[];
  timeline: TimelineEvent[];
  checkpoints: Checkpoint[];
  diagnosis: DiagnosisResult | null;
};
