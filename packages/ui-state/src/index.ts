import { create } from 'zustand';
import {
  checkpointFixture,
  domainVersions,
  recordedStepFixture,
  type AssertionStep,
  type Checkpoint,
  type RecordedStep,
} from '@browser-blackbox/domain';
import type {
  BrowserRuntimeDiagnostics,
  BrowserRuntimeEvent,
  BrowserRuntimeHealth,
  BrowserRuntimeState,
  BrowserRuntimeUpdate,
} from '@browser-blackbox/runtime-browser';
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
  type RecordingSession,
  type RecordingSessionSnapshot,
  undoRecordingSession,
} from './recording-session';

type WorkspaceState = {
  targetUrl: string;
  browserRuntime: BrowserRuntimeState;
  runtimeHealth: BrowserRuntimeHealth;
  runtimeEvents: BrowserRuntimeEvent[];
  recordingSession: RecordingSession;
  setTargetUrl: (targetUrl: string) => void;
  setBrowserRuntime: (browserRuntime: BrowserRuntimeState) => void;
  setRuntimeDiagnostics: (diagnostics: BrowserRuntimeDiagnostics) => void;
  pushRuntimeUpdate: (update: BrowserRuntimeUpdate) => void;
  selectRecordedStep: (stepId: string) => void;
  replaceRecordedStepInReview: (stepId: string, step: RecordedStep) => void;
  insertStepAfterSelection: (template: 'reload' | 'url-assertion') => void;
  moveRecordedStep: (stepId: string, direction: 'up' | 'down') => void;
  disableRecordedStepInReview: (stepId: string) => void;
  removeRecordedStepFromReview: (stepId: string) => void;
  undoRecordingEdit: () => void;
  redoRecordingEdit: () => void;
};

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    targetUrl: 'https://example.com',
    browserRuntime: {
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    },
    runtimeHealth: {
      status: 'idle',
      lastEventAt: null,
      lastError: null,
      recentEventCount: 0,
      subscriberCount: 0,
    },
    runtimeEvents: [],
    recordingSession: createWorkspaceRecordingSession(),
    setTargetUrl: (targetUrl) => useWorkspaceStore.setState({ targetUrl }),
    setBrowserRuntime: (browserRuntime) => useWorkspaceStore.setState({ browserRuntime }),
    setRuntimeDiagnostics: (diagnostics) =>
      useWorkspaceStore.setState({
        browserRuntime: diagnostics.state,
        runtimeHealth: diagnostics.health,
        runtimeEvents: diagnostics.recentEvents,
      }),
    pushRuntimeUpdate: (update) =>
      useWorkspaceStore.setState((state) => ({
        browserRuntime: update.state,
        runtimeHealth: update.health,
        runtimeEvents: [
          update.event,
          ...state.runtimeEvents.filter((event) => event.id !== update.event.id),
        ].slice(0, 80),
      })),
    selectRecordedStep: (stepId) =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: {
          ...state.recordingSession,
          selectedStepId: stepId,
        },
      })),
    replaceRecordedStepInReview: (stepId, step) =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: replaceRecordingStep(state.recordingSession, {
          stepId,
          step,
        }),
      })),
    insertStepAfterSelection: (template) =>
      useWorkspaceStore.setState((state) => {
        const selectedStepId = state.recordingSession.selectedStepId;
        const selectedIndex = state.recordingSession.present.steps.findIndex(
          (step) => step.id === selectedStepId,
        );
        const anchorIndex = selectedIndex === -1 ? state.recordingSession.present.steps.length - 1 : selectedIndex;
        const anchorStep =
          state.recordingSession.present.steps[anchorIndex] ??
          state.recordingSession.present.steps[state.recordingSession.present.steps.length - 1];
        const nextStep = createInsertedStep(template, anchorStep);

        return {
          recordingSession: insertRecordingStep(state.recordingSession, {
            index: anchorIndex + 1,
            step: nextStep,
          }),
        };
      }),
    moveRecordedStep: (stepId, direction) =>
      useWorkspaceStore.setState((state) => {
        const currentIndex = state.recordingSession.present.steps.findIndex((step) => step.id === stepId);

        if (currentIndex === -1) {
          return state;
        }

        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (nextIndex < 0 || nextIndex >= state.recordingSession.present.steps.length) {
          return state;
        }

        return {
          recordingSession: reorderRecordingStep(state.recordingSession, {
            stepId,
            toIndex: nextIndex,
          }),
        };
      }),
    disableRecordedStepInReview: (stepId) =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: disableRecordingStep(state.recordingSession, {
          stepId,
          updatedAt: new Date().toISOString(),
        }),
      })),
    removeRecordedStepFromReview: (stepId) =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: removeRecordingStep(state.recordingSession, {
          stepId,
        }),
      })),
    undoRecordingEdit: () =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: undoRecordingSession(state.recordingSession),
      })),
    redoRecordingEdit: () =>
      useWorkspaceStore.setState((state) => ({
        recordingSession: redoRecordingSession(state.recordingSession),
      })),
  };
}

export const useWorkspaceStore = create<WorkspaceState>(() => createInitialWorkspaceState());

export function getSelectedRecordedStep(
  recordingSession: RecordingSession,
): RecordedStep | null {
  return (
    recordingSession.present.steps.find((step) => step.id === recordingSession.selectedStepId) ??
    null
  );
}

export function getRecordingUndoAvailability(recordingSession: RecordingSession): {
  canUndo: boolean;
  canRedo: boolean;
} {
  return {
    canUndo: canUndoRecordingSession(recordingSession),
    canRedo: canRedoRecordingSession(recordingSession),
  };
}

function createWorkspaceRecordingSession(): RecordingSession {
  return createRecordingSession(createWorkspaceRecordingSeed());
}

function createWorkspaceRecordingSeed(): RecordingSessionSnapshot {
  const createdAt = '2026-06-25T12:00:00.000Z';
  const step1 = createActionStep({
    id: 'step-open-login',
    title: 'Open login page',
    createdAt,
    action: {
      type: 'navigate',
      url: 'https://example.test/login',
    },
  });
  const step2 = createActionStep({
    id: 'step-fill-email',
    title: 'Fill email',
    createdAt,
    dependencyStepIds: [step1.id],
    action: {
      type: 'fill',
      selector: 'page.getByLabel("Email")',
      value: 'qa@example.test',
      sensitive: false,
    },
  });
  const step3 = createActionStep({
    id: 'step-submit-login',
    title: 'Submit login form',
    createdAt,
    dependencyStepIds: [step2.id],
    action: {
      type: 'click',
      selector: 'page.getByRole("button", { name: "Sign in" })',
    },
  });
  const step4: AssertionStep = {
    ...recordedStepFixture,
    id: 'step-assert-dashboard',
    title: 'Assert dashboard heading',
    kind: 'assertion',
    status: 'active',
    evidenceState: 'current',
    createdAt,
    updatedAt: createdAt,
    dependencyStepIds: [step3.id],
    invalidatesEvidenceAfter: true,
    assertion: {
      schemaVersion: domainVersions.domainSchemaVersion,
      kind: 'element-visible',
      selector: 'page.getByRole("heading", { name: "Dashboard" })',
    },
  };
  const checkpoint: Checkpoint = {
    ...checkpointFixture,
    id: 'checkpoint-post-login-review',
    stepId: step4.id,
    label: 'Dashboard visible',
    createdAt,
    dependencyStepIds: [step1.id, step2.id, step3.id, step4.id],
  };

  return {
    steps: [step1, step2, step3, step4],
    checkpoints: [checkpoint],
  };
}

function createActionStep(input: {
  id: string;
  title: string;
  createdAt: string;
  dependencyStepIds?: string[];
  action: RecordedStep extends infer T
    ? T extends { kind: 'action'; action: infer Action }
      ? Action
      : never
    : never;
}): RecordedStep {
  return {
    ...recordedStepFixture,
    id: input.id,
    title: input.title,
    kind: 'action',
    status: 'active',
    evidenceState: 'current',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    dependencyStepIds: input.dependencyStepIds ?? [],
    invalidatesEvidenceAfter: true,
    action: input.action,
  };
}

function createInsertedStep(
  template: 'reload' | 'url-assertion',
  anchorStep: RecordedStep | undefined,
): RecordedStep {
  const timestamp = new Date().toISOString();
  const dependencyStepIds = anchorStep ? [anchorStep.id] : [];

  if (template === 'reload') {
    return createActionStep({
      id: `step-reload-${timestamp}`,
      title: 'Reload current page',
      createdAt: timestamp,
      dependencyStepIds,
      action: {
        type: 'reload',
      },
    });
  }

  return {
    ...recordedStepFixture,
    id: `step-assert-url-${timestamp}`,
    title: 'Assert current URL',
    kind: 'assertion',
    status: 'active',
    evidenceState: 'current',
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencyStepIds,
    invalidatesEvidenceAfter: true,
    assertion: {
      schemaVersion: domainVersions.domainSchemaVersion,
      kind: 'url-matches',
      expectedUrl: anchorStep && anchorStep.kind === 'action' && anchorStep.action.type === 'navigate'
        ? anchorStep.action.url
        : 'https://example.test/dashboard',
      matchMode: 'exact',
    },
  };
}

export * from './recording-session';
