import {
  DomainValidationError,
  invalidateCheckpoint,
  parseCheckpoint,
  parseRecordedStep,
  type Checkpoint,
  type EvidenceState,
  type RecordedStep,
} from '@browser-blackbox/domain';

export type RecordingSessionSnapshot = {
  steps: RecordedStep[];
  checkpoints: Checkpoint[];
};

export type RecordingSessionMutation =
  | 'initialize'
  | 'insert-step'
  | 'update-step'
  | 'disable-step'
  | 'remove-step'
  | 'reorder-step'
  | 'undo'
  | 'redo';

export type RecordingSession = {
  present: RecordingSessionSnapshot;
  history: {
    past: RecordingSessionSnapshot[];
    future: RecordingSessionSnapshot[];
  };
  selectedStepId: string | null;
  lastMutation: {
    kind: RecordingSessionMutation;
    affectedStepIds: string[];
    staleFromIndex: number | null;
    invalidatedCheckpointIds: string[];
  };
};

export function createRecordingSession(input: RecordingSessionSnapshot): RecordingSession {
  const snapshot = normalizeSnapshot(input);

  return {
    present: snapshot,
    history: {
      past: [],
      future: [],
    },
    selectedStepId: snapshot.steps[0]?.id ?? null,
    lastMutation: {
      kind: 'initialize',
      affectedStepIds: [],
      staleFromIndex: null,
      invalidatedCheckpointIds: [],
    },
  };
}

export function canUndoRecordingSession(session: RecordingSession): boolean {
  return session.history.past.length > 0;
}

export function canRedoRecordingSession(session: RecordingSession): boolean {
  return session.history.future.length > 0;
}

export function insertRecordingStep(
  session: RecordingSession,
  input: {
    index: number;
    step: RecordedStep;
  },
): RecordingSession {
  const steps = session.present.steps.slice();
  const index = normalizeInsertIndex(input.index, steps.length);
  const nextStep = parseRecordedStep(input.step);

  if (steps.some((step) => step.id === nextStep.id)) {
    throw new DomainValidationError('RecordingSession', [
      `step id ${nextStep.id} already exists in the recording session`,
    ]);
  }

  steps.splice(index, 0, nextStep);

  return applyStepMutation(session, {
    kind: 'insert-step',
    steps,
    affectedStepIds: [nextStep.id],
    staleFromIndex: index,
  });
}

export function replaceRecordingStep(
  session: RecordingSession,
  input: {
    stepId: string;
    step: RecordedStep;
  },
): RecordingSession {
  const steps = session.present.steps.slice();
  const index = steps.findIndex((step) => step.id === input.stepId);

  if (index === -1) {
    throw new DomainValidationError('RecordingSession', [
      `step id ${input.stepId} does not exist in the recording session`,
    ]);
  }

  const nextStep = parseRecordedStep(input.step);

  if (nextStep.id !== input.stepId) {
    throw new DomainValidationError('RecordingSession', [
      'step replacement must preserve the original step id',
    ]);
  }

  steps[index] = nextStep;

  return applyStepMutation(session, {
    kind: 'update-step',
    steps,
    affectedStepIds: [nextStep.id],
    staleFromIndex: index,
  });
}

export function disableRecordingStep(
  session: RecordingSession,
  input: {
    stepId: string;
    updatedAt: string;
  },
): RecordingSession {
  const current = getRequiredStep(session.present.steps, input.stepId);

  if (current.status === 'disabled') {
    return session;
  }

  return replaceRecordingStep(session, {
    stepId: input.stepId,
    step: {
      ...current,
      status: 'disabled',
      updatedAt: input.updatedAt,
    },
  });
}

export function removeRecordingStep(
  session: RecordingSession,
  input: {
    stepId: string;
  },
): RecordingSession {
  const index = session.present.steps.findIndex((step) => step.id === input.stepId);

  if (index === -1) {
    throw new DomainValidationError('RecordingSession', [
      `step id ${input.stepId} does not exist in the recording session`,
    ]);
  }

  const steps = session.present.steps.filter((step) => step.id !== input.stepId);

  return applyStepMutation(session, {
    kind: 'remove-step',
    steps,
    affectedStepIds: [input.stepId],
    staleFromIndex: Math.min(index, Math.max(steps.length - 1, 0)),
  });
}

export function reorderRecordingStep(
  session: RecordingSession,
  input: {
    stepId: string;
    toIndex: number;
  },
): RecordingSession {
  const steps = session.present.steps.slice();
  const fromIndex = steps.findIndex((step) => step.id === input.stepId);

  if (fromIndex === -1) {
    throw new DomainValidationError('RecordingSession', [
      `step id ${input.stepId} does not exist in the recording session`,
    ]);
  }

  const toIndex = normalizeMoveIndex(input.toIndex, steps.length);

  if (fromIndex === toIndex) {
    return session;
  }

  const [step] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, step);
  assertValidDependencyOrdering(steps);

  return applyStepMutation(session, {
    kind: 'reorder-step',
    steps,
    affectedStepIds: [input.stepId],
    staleFromIndex: Math.min(fromIndex, toIndex),
  });
}

export function undoRecordingSession(session: RecordingSession): RecordingSession {
  if (!canUndoRecordingSession(session)) {
    return session;
  }

  const previous = session.history.past[session.history.past.length - 1];
  const past = session.history.past.slice(0, -1);
  const future = [session.present, ...session.history.future];

  return {
    ...session,
    present: previous,
    history: {
      past,
      future,
    },
    selectedStepId: selectExistingStepId(session.selectedStepId, previous.steps),
    lastMutation: {
      kind: 'undo',
      affectedStepIds: [],
      staleFromIndex: null,
      invalidatedCheckpointIds: [],
    },
  };
}

export function redoRecordingSession(session: RecordingSession): RecordingSession {
  if (!canRedoRecordingSession(session)) {
    return session;
  }

  const [next, ...future] = session.history.future;
  const past = [...session.history.past, session.present];

  return {
    ...session,
    present: next,
    history: {
      past,
      future,
    },
    selectedStepId: selectExistingStepId(session.selectedStepId, next.steps),
    lastMutation: {
      kind: 'redo',
      affectedStepIds: [],
      staleFromIndex: null,
      invalidatedCheckpointIds: [],
    },
  };
}

function applyStepMutation(
  session: RecordingSession,
  input: {
    kind: Exclude<RecordingSessionMutation, 'initialize' | 'undo' | 'redo'>;
    steps: RecordedStep[];
    affectedStepIds: string[];
    staleFromIndex: number;
  },
): RecordingSession {
  assertValidDependencyOrdering(input.steps);

  const snapshot = invalidateEvidenceAndCheckpoints(session.present, input.steps, input);

  return {
    present: snapshot,
    history: {
      past: [...session.history.past, session.present],
      future: [],
    },
    selectedStepId: selectExistingStepId(
      input.affectedStepIds[0] ?? session.selectedStepId,
      snapshot.steps,
    ),
    lastMutation: {
      kind: input.kind,
      affectedStepIds: input.affectedStepIds,
      staleFromIndex: input.staleFromIndex,
      invalidatedCheckpointIds: session.present.checkpoints
        .filter((_, index) => snapshot.checkpoints[index]?.status === 'stale')
        .map((checkpoint) => checkpoint.id),
    },
  };
}

function invalidateEvidenceAndCheckpoints(
  previous: RecordingSessionSnapshot,
  nextSteps: RecordedStep[],
  input: {
    affectedStepIds: string[];
    staleFromIndex: number;
  },
): RecordingSessionSnapshot {
  const invalidatedSteps = nextSteps.map((step, index) =>
    index < input.staleFromIndex
      ? step
      : {
          ...step,
          evidenceState: forceEvidenceState(step.evidenceState, 'stale'),
        },
  );

  const nextStepIds = new Set(invalidatedSteps.map((step) => step.id));
  const stepIndexes = new Map(invalidatedSteps.map((step, index) => [step.id, index]));
  const checkpointReason = buildCheckpointInvalidationReason(input.affectedStepIds);

  const checkpoints = previous.checkpoints.map((checkpoint) => {
    const checkpointIndex = stepIndexes.get(checkpoint.stepId);
    const referencesAffectedStep = checkpoint.dependencyStepIds.some((stepId) =>
      input.affectedStepIds.includes(stepId),
    );
    const referencesMissingStep =
      !nextStepIds.has(checkpoint.stepId) ||
      checkpoint.dependencyStepIds.some((stepId) => !nextStepIds.has(stepId));
    const afterMutationBoundary =
      checkpointIndex !== undefined && checkpointIndex >= input.staleFromIndex;

    if (!referencesAffectedStep && !referencesMissingStep && !afterMutationBoundary) {
      return checkpoint;
    }

    return invalidateCheckpoint(checkpoint, checkpointReason);
  });

  return {
    steps: invalidatedSteps.map((step) => parseRecordedStep(step)),
    checkpoints: checkpoints.map((checkpoint) => parseCheckpoint(checkpoint)),
  };
}

function normalizeSnapshot(snapshot: RecordingSessionSnapshot): RecordingSessionSnapshot {
  const steps = snapshot.steps.map((step) => parseRecordedStep(step));
  assertValidDependencyOrdering(steps);

  return {
    steps,
    checkpoints: snapshot.checkpoints.map((checkpoint) => parseCheckpoint(checkpoint)),
  };
}

function getRequiredStep(steps: RecordedStep[], stepId: string): RecordedStep {
  const step = steps.find((entry) => entry.id === stepId);

  if (!step) {
    throw new DomainValidationError('RecordingSession', [
      `step id ${stepId} does not exist in the recording session`,
    ]);
  }

  return step;
}

function normalizeInsertIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new DomainValidationError('RecordingSession', [
      `insert index must be an integer between 0 and ${length}`,
    ]);
  }

  return index;
}

function normalizeMoveIndex(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new DomainValidationError('RecordingSession', [
      `move index must be an integer between 0 and ${Math.max(length - 1, 0)}`,
    ]);
  }

  return index;
}

function assertValidDependencyOrdering(steps: RecordedStep[]): void {
  const indexes = new Map(steps.map((step, index) => [step.id, index]));

  for (const step of steps) {
    const stepIndex = indexes.get(step.id);

    for (const dependencyStepId of step.dependencyStepIds) {
      const dependencyIndex = indexes.get(dependencyStepId);

      if (dependencyIndex === undefined) {
        throw new DomainValidationError('RecordingSession', [
          `step ${step.id} depends on missing step ${dependencyStepId}`,
        ]);
      }

      if ((stepIndex ?? 0) <= dependencyIndex) {
        throw new DomainValidationError('RecordingSession', [
          `step ${step.id} cannot appear before dependency ${dependencyStepId}`,
        ]);
      }
    }
  }
}

function forceEvidenceState(
  current: EvidenceState,
  next: Exclude<EvidenceState, 'current'>,
): EvidenceState {
  if (current === next) {
    return current;
  }

  return next;
}

function buildCheckpointInvalidationReason(affectedStepIds: string[]): string {
  return `Checkpoint invalidated after edits to steps: ${affectedStepIds.join(', ')}.`;
}

function selectExistingStepId(selectedStepId: string | null, steps: RecordedStep[]): string | null {
  if (selectedStepId && steps.some((step) => step.id === selectedStepId)) {
    return selectedStepId;
  }

  return steps[0]?.id ?? null;
}
