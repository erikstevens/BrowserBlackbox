import {
  type BrowserContextSnapshot,
  DomainValidationError,
  parseCheckpoint,
  parseRecordedStep,
  transitionEvidenceState,
  type Checkpoint,
  type RecordedStep,
} from '@browser-blackbox/domain';
import type { RecordingSession } from './recording-session';

export type ReplayMode =
  | 'from-start'
  | 'up-to-step'
  | 'from-checkpoint'
  | 'pause-on-step';

export type ReplayPlan = {
  mode: ReplayMode;
  targetStepId: string | null;
  checkpointId: string | null;
  startStrategy: 'start' | 'checkpoint';
  checkpointStatus: 'valid' | 'stale' | 'not-applicable';
  checkpointReason: string;
  executionStepIds: string[];
};

export function createReplayFromStartPlan(session: RecordingSession): ReplayPlan {
  return {
    mode: 'from-start',
    targetStepId: session.present.steps.at(-1)?.id ?? null,
    checkpointId: null,
    startStrategy: 'start',
    checkpointStatus: 'not-applicable',
    checkpointReason: 'Replay starts from a fresh browser context.',
    executionStepIds: session.present.steps.map((step) => step.id),
  };
}

export function createReplayToStepPlan(
  session: RecordingSession,
  stepId: string,
  mode: Extract<ReplayMode, 'up-to-step' | 'pause-on-step'> = 'up-to-step',
): ReplayPlan {
  const targetIndex = getRequiredStepIndex(session, stepId);
  const checkpoint = findNearestValidCheckpoint(session, targetIndex);
  const executionStepIds = session.present.steps
    .slice(checkpoint ? getRequiredStepIndex(session, checkpoint.stepId) + 1 : 0, targetIndex + 1)
    .map((step) => step.id);

  return {
    mode,
    targetStepId: stepId,
    checkpointId: checkpoint?.id ?? null,
    startStrategy: checkpoint ? 'checkpoint' : 'start',
    checkpointStatus: checkpoint?.status ?? 'not-applicable',
    checkpointReason: checkpoint
      ? `Replay can resume from checkpoint ${checkpoint.label}.`
      : 'No valid checkpoint exists before the selected step.',
    executionStepIds,
  };
}

export function createReplayFromCheckpointPlan(
  session: RecordingSession,
  checkpointId: string,
): ReplayPlan {
  const checkpoint = session.present.checkpoints.find((entry) => entry.id === checkpointId);

  if (!checkpoint) {
    throw new DomainValidationError('ReplayPlan', [
      `checkpoint id ${checkpointId} does not exist in the recording session`,
    ]);
  }

  const checkpointIndex = getRequiredStepIndex(session, checkpoint.stepId);

  return {
    mode: 'from-checkpoint',
    targetStepId: session.present.steps.at(-1)?.id ?? null,
    checkpointId,
    startStrategy: isRestorableCheckpoint(checkpoint) ? 'checkpoint' : 'start',
    checkpointStatus: checkpoint.status,
    checkpointReason:
      isRestorableCheckpoint(checkpoint)
        ? `Replay resumes from checkpoint ${checkpoint.label}.`
        : checkpoint.status === 'valid'
          ? `Checkpoint ${checkpoint.label} does not have a compatible snapshot yet.`
          : `Checkpoint ${checkpoint.label} is stale and cannot be trusted.`,
    executionStepIds: session.present.steps
      .slice(isRestorableCheckpoint(checkpoint) ? checkpointIndex + 1 : 0)
      .map((step) => step.id),
  };
}

export function prepareSessionForReplay(
  session: RecordingSession,
  plan: ReplayPlan,
): RecordingSession {
  const pendingStepIds = new Set(plan.executionStepIds);
  const currentStepIds = new Set(
    plan.startStrategy === 'checkpoint' && plan.checkpointId
      ? session.present.checkpoints
          .find((checkpoint) => checkpoint.id === plan.checkpointId)
          ?.dependencyStepIds ?? []
      : [],
  );

  return {
    ...session,
    present: {
      steps: session.present.steps.map((step) =>
        parseRecordedStep({
          ...step,
          evidenceState: pendingStepIds.has(step.id)
            ? step.evidenceState === 'current'
              ? 'current'
              : transitionEvidence(step.evidenceState, 'pending-regeneration')
            : currentStepIds.has(step.id)
              ? 'current'
              : step.evidenceState,
        }),
      ),
      checkpoints: session.present.checkpoints.map((checkpoint) =>
        parseCheckpoint({
          ...checkpoint,
          status:
            checkpoint.id === plan.checkpointId && checkpoint.status === 'valid'
              ? 'valid'
              : checkpoint.status,
        }),
      ),
    },
  };
}

export function findNearestValidCheckpoint(
  session: RecordingSession,
  targetStepIndex: number,
): Checkpoint | null {
  const checkpoints = session.present.checkpoints
    .filter((checkpoint) => isRestorableCheckpoint(checkpoint))
    .filter((checkpoint) => getRequiredStepIndex(session, checkpoint.stepId) <= targetStepIndex)
    .sort(
      (left, right) =>
        getRequiredStepIndex(session, right.stepId) -
        getRequiredStepIndex(session, left.stepId),
    );

  return checkpoints[0] ?? null;
}

function isRestorableCheckpoint(
  checkpoint: Checkpoint,
): checkpoint is Checkpoint & { snapshot: BrowserContextSnapshot } {
  return checkpoint.status === 'valid' && checkpoint.snapshot !== undefined;
}

function getRequiredStepIndex(session: RecordingSession, stepId: string): number {
  const index = session.present.steps.findIndex((step) => step.id === stepId);

  if (index === -1) {
    throw new DomainValidationError('ReplayPlan', [
      `step id ${stepId} does not exist in the recording session`,
    ]);
  }

  return index;
}

function transitionEvidence(
  current: RecordedStep['evidenceState'],
  next: Exclude<RecordedStep['evidenceState'], 'current'>,
): RecordedStep['evidenceState'] {
  if (current === next) {
    return current;
  }

  return transitionEvidenceState(current, next);
}
