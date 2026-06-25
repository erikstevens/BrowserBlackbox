import { describe, expect, it } from 'vitest';
import {
  type ActionStep,
  checkpointFixture,
  domainVersions,
  recordedStepFixture,
  type AssertionStep,
  type Checkpoint,
  type RecordedStep,
} from '@browser-blackbox/domain';
import {
  canRedoRecordingSession,
  canUndoRecordingSession,
  createRecordingSession,
  disableRecordingStep,
  insertRecordingStep,
  redoRecordingSession,
  removeRecordingStep,
  reorderRecordingStep,
  replaceRecordingStep,
  undoRecordingSession,
} from './recording-session';

function actionStep(
  id: string,
  title: string,
  selector: string,
  dependencyStepIds: string[] = [],
): ActionStep {
  return {
    ...recordedStepFixture,
    id,
    title,
    kind: 'action',
    dependencyStepIds,
    action: {
      type: 'click',
      selector,
    },
  };
}

function assertionStep(
  id: string,
  title: string,
  selector: string,
  dependencyStepIds: string[] = [],
): AssertionStep {
  return {
    ...recordedStepFixture,
    id,
    title,
    kind: 'assertion',
    dependencyStepIds,
    assertion: {
      schemaVersion: domainVersions.domainSchemaVersion,
      kind: 'element-visible',
      selector,
    },
  };
}

function checkpoint(stepId: string): Checkpoint {
  return {
    ...checkpointFixture,
    id: `checkpoint-${stepId}`,
    stepId,
    label: `Checkpoint ${stepId}`,
    dependencyStepIds: ['step-1', 'step-2', stepId].filter(
      (dependencyStepId, index, all) => all.indexOf(dependencyStepId) === index,
    ),
  };
}

describe('recording session editing', () => {
  it('marks downstream evidence stale after replacing a recorded step', () => {
    const step1 = actionStep('step-1', 'Open login form', 'page.getByRole("link", { name: "Login" })');
    const step2 = {
      ...actionStep('step-2', 'Fill email', 'page.getByLabel("Email")'),
      action: {
        type: 'fill',
        selector: 'page.getByLabel("Email")',
        value: 'qa@example.test',
        sensitive: false,
      },
    } satisfies RecordedStep;
    const step3 = assertionStep(
      'step-3',
      'Assert dashboard',
      'page.getByRole("heading", { name: "Dashboard" })',
      ['step-2'],
    );

    const session = createRecordingSession({
      steps: [step1, step2, step3],
      checkpoints: [checkpoint('step-3')],
    });

    const updated = replaceRecordingStep(session, {
      stepId: 'step-2',
      step: {
        ...step2,
        action: {
          type: 'fill',
          selector: 'page.getByLabel("Email")',
          value: 'changed@example.test',
          sensitive: false,
        },
        updatedAt: '2026-06-25T10:00:00.000Z',
      },
    });

    expect(updated.present.steps.map((step) => step.evidenceState)).toEqual([
      'current',
      'stale',
      'stale',
    ]);
    expect(updated.present.checkpoints[0]?.status).toBe('stale');
    expect(canUndoRecordingSession(updated)).toBe(true);
    expect(canRedoRecordingSession(updated)).toBe(false);
  });

  it('supports insert, disable, remove, undo, and redo', () => {
    const step1 = actionStep('step-1', 'Open login form', 'page.getByRole("link", { name: "Login" })');
    const step2 = actionStep('step-2', 'Submit form', 'page.getByRole("button", { name: "Sign in" })', [
      'step-1',
    ]);
    const inserted = {
      ...actionStep('step-1b', 'Fill password', 'page.getByLabel("Password")', ['step-1']),
      action: {
        type: 'fill',
        selector: 'page.getByLabel("Password")',
        value: '[REDACTED]',
        sensitive: true,
      },
    } satisfies RecordedStep;

    const session = createRecordingSession({
      steps: [step1, step2],
      checkpoints: [checkpoint('step-2')],
    });

    const insertedSession = insertRecordingStep(session, {
      index: 1,
      step: inserted,
    });
    const disabledSession = disableRecordingStep(insertedSession, {
      stepId: 'step-1b',
      updatedAt: '2026-06-25T10:05:00.000Z',
    });
    const removedSession = removeRecordingStep(disabledSession, {
      stepId: 'step-1b',
    });
    const undone = undoRecordingSession(removedSession);
    const redone = redoRecordingSession(undone);

    expect(insertedSession.present.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-1b',
      'step-2',
    ]);
    expect(disabledSession.present.steps[1]?.status).toBe('disabled');
    expect(removedSession.present.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
    expect(undone.present.steps.map((step) => step.id)).toEqual(['step-1', 'step-1b', 'step-2']);
    expect(redone.present.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
  });

  it('rejects reorders that violate declared step dependencies', () => {
    const step1 = actionStep('step-1', 'Open login form', 'page.getByRole("link", { name: "Login" })');
    const step2 = actionStep('step-2', 'Fill email', 'page.getByLabel("Email")', ['step-1']);
    const step3 = actionStep('step-3', 'Submit form', 'page.getByRole("button", { name: "Sign in" })', [
      'step-2',
    ]);

    const session = createRecordingSession({
      steps: [step1, step2, step3],
      checkpoints: [],
    });

    expect(() =>
      reorderRecordingStep(session, {
        stepId: 'step-3',
        toIndex: 1,
      }),
    ).toThrow('step step-3 cannot appear before dependency step-2');
  });

  it('allows reorders that preserve dependency order and invalidates later checkpoints', () => {
    const step1 = actionStep('step-1', 'Open login form', 'page.getByRole("link", { name: "Login" })');
    const step2 = actionStep('step-2', 'Choose tenant', 'page.getByText("Acme")', ['step-1']);
    const step3 = actionStep('step-3', 'Fill email', 'page.getByLabel("Email")', ['step-1']);
    const step4 = actionStep('step-4', 'Submit form', 'page.getByRole("button", { name: "Sign in" })', [
      'step-2',
      'step-3',
    ]);

    const session = createRecordingSession({
      steps: [step1, step2, step3, step4],
      checkpoints: [checkpoint('step-2'), checkpoint('step-4')],
    });

    const reordered = reorderRecordingStep(session, {
      stepId: 'step-3',
      toIndex: 1,
    });

    expect(reordered.present.steps.map((step) => step.id)).toEqual([
      'step-1',
      'step-3',
      'step-2',
      'step-4',
    ]);
    expect(reordered.present.steps.map((step) => step.evidenceState)).toEqual([
      'current',
      'stale',
      'stale',
      'stale',
    ]);
    expect(reordered.present.checkpoints.map((entry) => entry.status)).toEqual(['stale', 'stale']);
  });
});
