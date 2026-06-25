import { describe, expect, it } from 'vitest';
import {
  checkpointFixture,
  recordedStepFixture,
  type Checkpoint,
  type RecordedStep,
} from '@browser-blackbox/domain';
import { createRecordingSession } from './recording-session';
import {
  createReplayFromCheckpointPlan,
  createReplayFromStartPlan,
  createReplayToStepPlan,
  findNearestValidCheckpoint,
  prepareSessionForReplay,
} from './replay-planning';

function actionStep(
  id: string,
  title: string,
  dependencyStepIds: string[] = [],
): RecordedStep {
  return {
    ...recordedStepFixture,
    id,
    title,
    kind: 'action',
    dependencyStepIds,
    action: {
      type: 'click',
      selector: `page.getByTestId("${id}")`,
    },
  };
}

function checkpoint(id: string, stepId: string, dependencyStepIds: string[], status: Checkpoint['status'] = 'valid'): Checkpoint {
  return {
    ...checkpointFixture,
    id,
    label: id,
    stepId,
    dependencyStepIds,
    status,
    invalidationReasons: status === 'stale' ? ['Edited dependency'] : [],
  };
}

describe('replay planning', () => {
  it('builds a replay-from-start plan for the full flow', () => {
    const session = createRecordingSession({
      steps: [actionStep('step-1', 'Open'), actionStep('step-2', 'Submit', ['step-1'])],
      checkpoints: [],
    });

    expect(createReplayFromStartPlan(session)).toEqual({
      mode: 'from-start',
      targetStepId: 'step-2',
      checkpointId: null,
      startStrategy: 'start',
      checkpointStatus: 'not-applicable',
      checkpointReason: 'Replay starts from a fresh browser context.',
      executionStepIds: ['step-1', 'step-2'],
    });
  });

  it('chooses the nearest valid checkpoint before the selected step', () => {
    const session = createRecordingSession({
      steps: [
        actionStep('step-1', 'Open'),
        actionStep('step-2', 'Fill', ['step-1']),
        actionStep('step-3', 'Submit', ['step-2']),
        actionStep('step-4', 'Assert', ['step-3']),
      ],
      checkpoints: [
        checkpoint('checkpoint-2', 'step-2', ['step-1', 'step-2']),
        checkpoint('checkpoint-3', 'step-3', ['step-1', 'step-2', 'step-3'], 'stale'),
      ],
    });

    const nearest = findNearestValidCheckpoint(session, 3);
    expect(nearest?.id).toBe('checkpoint-2');

    const plan = createReplayToStepPlan(session, 'step-4');
    expect(plan.startStrategy).toBe('checkpoint');
    expect(plan.checkpointId).toBe('checkpoint-2');
    expect(plan.executionStepIds).toEqual(['step-3', 'step-4']);
  });

  it('falls back to start when replaying from a stale checkpoint', () => {
    const session = createRecordingSession({
      steps: [
        actionStep('step-1', 'Open'),
        actionStep('step-2', 'Fill', ['step-1']),
      ],
      checkpoints: [checkpoint('checkpoint-2', 'step-2', ['step-1', 'step-2'], 'stale')],
    });

    const plan = createReplayFromCheckpointPlan(session, 'checkpoint-2');
    expect(plan.startStrategy).toBe('start');
    expect(plan.checkpointStatus).toBe('stale');
    expect(plan.executionStepIds).toEqual(['step-1', 'step-2']);
  });

  it('marks replayed steps as pending regeneration', () => {
    const session = createRecordingSession({
      steps: [
        actionStep('step-1', 'Open'),
        { ...actionStep('step-2', 'Fill', ['step-1']), evidenceState: 'stale' },
        { ...actionStep('step-3', 'Submit', ['step-2']), evidenceState: 'stale' },
      ],
      checkpoints: [checkpoint('checkpoint-1', 'step-1', ['step-1'])],
    });

    const plan = createReplayToStepPlan(session, 'step-3');
    const prepared = prepareSessionForReplay(session, plan);

    expect(prepared.present.steps.map((step) => step.evidenceState)).toEqual([
      'current',
      'pending-regeneration',
      'pending-regeneration',
    ]);
  });
});
