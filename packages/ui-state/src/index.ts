import { create } from 'zustand';
import {
  type BrowserContextSnapshot,
  checkpointFixture,
  domainVersions,
  recordedStepFixture,
  transitionEvidenceState,
  type AssertionStep,
  type Checkpoint,
  type RecordedStep,
} from '@browser-blackbox/domain';
import type { StoredRunSnapshot } from '@browser-blackbox/persistence/src/contracts';
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
  replaceRecordingSession,
  replaceRecordingStep,
  type RecordingSession,
  type RecordingSessionSnapshot,
  undoRecordingSession,
} from './recording-session';
import {
  createReplayFromCheckpointPlan,
  createReplayFromStartPlan,
  createReplayToStepPlan,
  prepareSessionForReplay,
  type ReplayPlan,
} from './replay-planning';
import {
  createStoredRunSnapshotFromWorkspace,
  createWorkspaceWorkingCopyMetadata,
  hydrateWorkspaceFromStoredRunSnapshot,
  type WorkspaceWorkingCopyMetadata,
} from './workspace-persistence';

type CaptureTemplate = 'reload' | 'url-assertion';

type WorkspaceState = {
  targetUrl: string;
  browserRuntime: BrowserRuntimeState;
  runtimeHealth: BrowserRuntimeHealth;
  runtimeEvents: BrowserRuntimeEvent[];
  recordingSession: RecordingSession;
  workingCopy: WorkspaceWorkingCopyMetadata;
  replayPlan: ReplayPlan | null;
  setTargetUrl: (targetUrl: string) => void;
  setBrowserRuntime: (browserRuntime: BrowserRuntimeState) => void;
  setRuntimeDiagnostics: (diagnostics: BrowserRuntimeDiagnostics) => void;
  pushRuntimeUpdate: (update: BrowserRuntimeUpdate) => void;
  selectRecordedStep: (stepId: string) => void;
  replaceRecordedStepInReview: (stepId: string, step: RecordedStep) => void;
  insertStepAfterSelection: (template: CaptureTemplate) => void;
  moveRecordedStep: (stepId: string, direction: 'up' | 'down') => void;
  disableRecordedStepInReview: (stepId: string) => void;
  removeRecordedStepFromReview: (stepId: string) => void;
  undoRecordingEdit: () => void;
  redoRecordingEdit: () => void;
  beginRuntimeCapture: (targetUrl: string, sessionId: string | null) => void;
  hydrateWorkingCopySnapshot: (snapshot: StoredRunSnapshot) => void;
  exportWorkingCopySnapshot: () => StoredRunSnapshot;
  previewReplayFromStart: () => void;
  previewReplayToSelectedStep: (mode?: 'up-to-step' | 'pause-on-step') => void;
  previewReplayFromCheckpoint: (checkpointId: string) => void;
  prepareReplayExecution: () => void;
  completeReplayExecution: (
    completedStepIds: string[],
    capturedCheckpoints?: Array<{
      checkpointId: string;
      snapshot: BrowserContextSnapshot;
    }>,
  ) => void;
};

export function createInitialWorkspaceState(): WorkspaceState {
  const now = '2026-06-25T12:00:00.000Z';

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
    workingCopy: createWorkspaceWorkingCopyMetadata(now, {
      flowId: 'workspace-working-copy',
    }),
    replayPlan: null,
    setTargetUrl: (targetUrl) => useWorkspaceStore.setState({ targetUrl }),
    setBrowserRuntime: (browserRuntime) => useWorkspaceStore.setState({ browserRuntime }),
    setRuntimeDiagnostics: (diagnostics) =>
      useWorkspaceStore.setState({
        browserRuntime: diagnostics.state,
        runtimeHealth: diagnostics.health,
        runtimeEvents: diagnostics.recentEvents,
      }),
    pushRuntimeUpdate: (update) =>
      useWorkspaceStore.setState((state) => {
        const runtimeEvents = [
          update.event,
          ...state.runtimeEvents.filter((event) => event.id !== update.event.id),
        ].slice(0, 80);

        return {
          browserRuntime: update.state,
          runtimeHealth: update.health,
          runtimeEvents,
          recordingSession: maybeCaptureRecordedStep(state.recordingSession, update.event),
        };
      }),
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
        const anchorIndex =
          selectedIndex === -1
            ? state.recordingSession.present.steps.length - 1
            : selectedIndex;
        const anchorStep =
          state.recordingSession.present.steps[anchorIndex] ??
          state.recordingSession.present.steps[
            state.recordingSession.present.steps.length - 1
          ];
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
        const currentIndex = state.recordingSession.present.steps.findIndex(
          (step) => step.id === stepId,
        );

        if (currentIndex === -1) {
          return state;
        }

        const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

        if (
          nextIndex < 0 ||
          nextIndex >= state.recordingSession.present.steps.length
        ) {
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
    beginRuntimeCapture: (targetUrl, sessionId) =>
      useWorkspaceStore.setState(() => {
        const nowAt = new Date().toISOString();
        const metadata = createWorkspaceWorkingCopyMetadata(nowAt, {
          flowId: 'workspace-working-copy',
          sessionId: sessionId ?? undefined,
        });

        return {
          targetUrl,
          workingCopy: metadata,
          recordingSession: replaceRecordingSession({
            steps: [],
            checkpoints: [],
          }),
        };
      }),
    hydrateWorkingCopySnapshot: (snapshot) =>
      useWorkspaceStore.setState((state) => {
        const hydrated = hydrateWorkspaceFromStoredRunSnapshot(snapshot);

        return {
          ...state,
          targetUrl: hydrated.targetUrl,
          workingCopy: hydrated.metadata,
          replayPlan: null,
          recordingSession: replaceRecordingSession(
            {
              steps: hydrated.steps,
              checkpoints: hydrated.checkpoints,
            },
            hydrated.steps[0]?.id ?? null,
          ),
        };
      }),
    exportWorkingCopySnapshot: () =>
      createStoredRunSnapshotFromWorkspace({
        targetUrl: useWorkspaceStore.getState().targetUrl,
        browserRuntime: useWorkspaceStore.getState().browserRuntime,
        recordingSession: useWorkspaceStore.getState().recordingSession,
        workingCopy: useWorkspaceStore.getState().workingCopy,
      }),
    previewReplayFromStart: () =>
      useWorkspaceStore.setState((state) => ({
        replayPlan: createReplayFromStartPlan(state.recordingSession),
      })),
    previewReplayToSelectedStep: (mode = 'up-to-step') =>
      useWorkspaceStore.setState((state) => {
        const targetStepId =
          state.recordingSession.selectedStepId ??
          state.recordingSession.present.steps.at(-1)?.id ??
          null;

        if (!targetStepId) {
          return state;
        }

        return {
          replayPlan: createReplayToStepPlan(state.recordingSession, targetStepId, mode),
        };
      }),
    previewReplayFromCheckpoint: (checkpointId) =>
      useWorkspaceStore.setState((state) => ({
        replayPlan: createReplayFromCheckpointPlan(state.recordingSession, checkpointId),
      })),
    prepareReplayExecution: () =>
      useWorkspaceStore.setState((state) => {
        if (!state.replayPlan) {
          return state;
        }

        return {
          recordingSession: prepareSessionForReplay(
            state.recordingSession,
            state.replayPlan,
          ),
        };
      }),
    completeReplayExecution: (completedStepIds, capturedCheckpoints = []) =>
      useWorkspaceStore.setState((state) => {
        if (!state.replayPlan) {
          return state;
        }

        const currentStepIds = new Set(completedStepIds);
        const checkpointSnapshots = new Map(
          capturedCheckpoints.map((entry) => [entry.checkpointId, entry.snapshot]),
        );
        return {
          replayPlan: null,
          recordingSession: {
            ...state.recordingSession,
            present: {
              steps: state.recordingSession.present.steps.map((step) => {
                if (!currentStepIds.has(step.id)) {
                  return step;
                }

                return {
                  ...step,
                  evidenceState:
                    step.evidenceState === 'current'
                      ? 'current'
                      : transitionEvidenceState(step.evidenceState, 'current'),
                };
              }),
              checkpoints: state.recordingSession.present.checkpoints.map((checkpoint) => {
                const recovered =
                  currentStepIds.has(checkpoint.stepId) &&
                  checkpoint.dependencyStepIds.every((stepId) => currentStepIds.has(stepId));

                if (!recovered) {
                  return checkpoint;
                }

                return {
                  ...checkpoint,
                  status: 'valid',
                  invalidationReasons: [],
                  snapshot:
                    checkpointSnapshots.get(checkpoint.id) ?? checkpoint.snapshot,
                };
              }),
            },
          },
        };
      }),
  };
}

export const useWorkspaceStore = create<WorkspaceState>(() =>
  createInitialWorkspaceState(),
);

export function getSelectedRecordedStep(
  recordingSession: RecordingSession,
): RecordedStep | null {
  return (
    recordingSession.present.steps.find(
      (step) => step.id === recordingSession.selectedStepId,
    ) ?? null
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
    snapshot: checkpointFixture.snapshot,
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
  template: CaptureTemplate,
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
      expectedUrl:
        anchorStep &&
        anchorStep.kind === 'action' &&
        anchorStep.action.type === 'navigate'
          ? anchorStep.action.url
          : 'https://example.test/dashboard',
      matchMode: 'exact',
    },
  };
}

function maybeCaptureRecordedStep(
  recordingSession: RecordingSession,
  event: BrowserRuntimeEvent,
): RecordingSession {
  const step = buildCapturedStep(event);
  if (!step) {
    return recordingSession;
  }

  const nextSession = insertRecordingStep(recordingSession, {
    index: recordingSession.present.steps.length,
    step,
  });

  const checkpoint = buildCapturedCheckpoint(step, nextSession.present.steps);
  if (!checkpoint) {
    return nextSession;
  }

  return {
    ...nextSession,
    present: {
      ...nextSession.present,
      checkpoints: [...nextSession.present.checkpoints, checkpoint],
    },
  };
}

function buildCapturedStep(event: BrowserRuntimeEvent): RecordedStep | null {
  if (event.code !== 'recording.step.captured') {
    return null;
  }

  const capture = asRecord(event.data?.capture);
  const nowAt =
    typeof event.data?.capturedAt === 'string' ? event.data.capturedAt : event.timestamp;
  const selector =
    capture && typeof capture.selector === 'string' ? capture.selector : null;
  const title =
    capture && typeof capture.title === 'string' ? capture.title : event.message;
  const kind = capture && typeof capture.kind === 'string' ? capture.kind : null;
  const previousStepId =
    capture && typeof capture.previousCaptureEventId === 'string'
      ? `step-captured-${capture.previousCaptureEventId}`
      : capture && typeof capture.previousStepId === 'string'
        ? capture.previousStepId
        : undefined;
  const dependencyStepIds = previousStepId ? [previousStepId] : [];

  if (kind === 'navigate' && typeof capture?.url === 'string') {
    return createActionStep({
      id: `step-captured-${event.id}`,
      title,
      createdAt: nowAt,
      dependencyStepIds,
      action: {
        type: 'navigate',
        url: capture.url,
      },
    });
  }

  if (kind === 'click' && selector) {
    return createActionStep({
      id: `step-captured-${event.id}`,
      title,
      createdAt: nowAt,
      dependencyStepIds,
      action: {
        type: 'click',
        selector,
      },
    });
  }

  if (
    kind === 'fill' &&
    selector &&
    typeof capture?.value === 'string' &&
    typeof capture?.sensitive === 'boolean'
  ) {
    return createActionStep({
      id: `step-captured-${event.id}`,
      title,
      createdAt: nowAt,
      dependencyStepIds,
      action: {
        type: 'fill',
        selector,
        value: capture.value,
        sensitive: capture.sensitive,
      },
    });
  }

  if (kind === 'select-option' && selector && typeof capture?.value === 'string') {
    return createActionStep({
      id: `step-captured-${event.id}`,
      title,
      createdAt: nowAt,
      dependencyStepIds,
      action: {
        type: 'select-option',
        selector,
        value: capture.value,
      },
    });
  }

  if (kind === 'set-checked' && selector && typeof capture?.checked === 'boolean') {
    return createActionStep({
      id: `step-captured-${event.id}`,
      title,
      createdAt: nowAt,
      dependencyStepIds,
      action: {
        type: 'set-checked',
        selector,
        checked: capture.checked,
      },
    });
  }

  return null;
}

function buildCapturedCheckpoint(
  step: RecordedStep,
  steps: RecordedStep[],
): Checkpoint | null {
  if (step.kind !== 'action' || step.action.type !== 'navigate') {
    return null;
  }

  const dependencyStepIds = steps
    .slice(0, steps.findIndex((entry) => entry.id === step.id) + 1)
    .map((entry) => entry.id);

  return {
    ...checkpointFixture,
    id: `checkpoint-${step.id}`,
    label: `Resume after ${step.title}`,
    kind: 'step-boundary',
    createdAt: step.updatedAt,
    stepId: step.id,
    dependencyStepIds,
    status: 'valid',
    invalidationReasons: [],
    snapshot: undefined,
  };
}

function asRecord(
  value: unknown,
): Record<string, string | boolean | undefined> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, string | boolean | undefined>;
  }

  return null;
}

export * from './recording-session';
export * from './replay-planning';
export * from './workspace-persistence';
