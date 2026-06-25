import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInitialWorkspaceState,
  getSelectedRecordedStep,
  getRecordingUndoAvailability,
  useWorkspaceStore,
} from './index';

describe('workspace recording review state', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(createInitialWorkspaceState());
  });

  it('boots with a seeded recording review session', () => {
    const state = useWorkspaceStore.getState();

    expect(state.recordingSession.present.steps).toHaveLength(4);
    expect(getSelectedRecordedStep(state.recordingSession)?.id).toBe('step-open-login');
    expect(getRecordingUndoAvailability(state.recordingSession)).toEqual({
      canUndo: false,
      canRedo: false,
    });
  });

  it('updates the selected step through the review store actions', () => {
    const state = useWorkspaceStore.getState();
    const selected = getSelectedRecordedStep(state.recordingSession);

    if (!selected) {
      throw new Error('expected a selected step');
    }

    state.replaceRecordedStepInReview(selected.id, {
      ...selected,
      title: 'Open login route',
      updatedAt: '2026-06-25T12:05:00.000Z',
    });

    const updatedSession = useWorkspaceStore.getState().recordingSession;

    expect(updatedSession.present.steps[0]?.title).toBe('Open login route');
    expect(updatedSession.present.steps.every((step) => step.evidenceState === 'stale')).toBe(true);
    expect(updatedSession.present.checkpoints[0]?.status).toBe('stale');
    expect(getRecordingUndoAvailability(updatedSession).canUndo).toBe(true);
  });

  it('supports insert, move, disable, undo, and redo from the workspace store', () => {
    const state = useWorkspaceStore.getState();

    state.selectRecordedStep('step-fill-email');
    state.insertStepAfterSelection('reload');

    let session = useWorkspaceStore.getState().recordingSession;
    const insertedStep = session.present.steps.find((step) => step.title === 'Reload current page');

    expect(insertedStep).toBeTruthy();

    if (!insertedStep) {
      throw new Error('expected inserted step');
    }

    useWorkspaceStore.getState().moveRecordedStep(insertedStep.id, 'down');
    useWorkspaceStore.getState().disableRecordedStepInReview(insertedStep.id);

    session = useWorkspaceStore.getState().recordingSession;
    expect(session.present.steps.find((step) => step.id === insertedStep.id)?.status).toBe('disabled');

    useWorkspaceStore.getState().undoRecordingEdit();
    expect(
      useWorkspaceStore.getState().recordingSession.present.steps.find(
        (step) => step.id === insertedStep.id,
      )?.status,
    ).toBe('active');

    useWorkspaceStore.getState().redoRecordingEdit();
    expect(
      useWorkspaceStore.getState().recordingSession.present.steps.find(
        (step) => step.id === insertedStep.id,
      )?.status,
    ).toBe('disabled');
  });
});
