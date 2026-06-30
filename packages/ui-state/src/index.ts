import { create } from 'zustand';
import {
  type BrowserContextSnapshot,
  type DiagnosisResult,
  type InspectionMetadata,
  parseRedactionRule,
  parseDiagnosisResult,
  parseInspectionMetadata,
  parseRequestResponseCapture,
  parseTimelineEvent,
  checkpointFixture,
  domainVersions,
  recordedStepFixture,
  transitionEvidenceState,
  type AssertionStep,
  type Checkpoint,
  type RecordedStep,
  type RedactionRule,
  type RequestResponseCapture,
  type SimulationRule,
  type TimelineEvent,
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
  currentInspection: InspectionMetadata | null;
  captures: RequestResponseCapture[];
  redactionRules: RedactionRule[];
  simulationRules: SimulationRule[];
  timeline: TimelineEvent[];
  diagnosis: DiagnosisResult | null;
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
  addRedactionRule: (rule: RedactionRule) => void;
  removeRedactionRule: (ruleId: string) => void;
  addSimulationRule: (rule: SimulationRule) => void;
  replaceSimulationRule: (ruleId: string, rule: SimulationRule) => void;
  removeSimulationRule: (ruleId: string) => void;
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
    currentInspection: null,
    captures: [],
    redactionRules: [],
    simulationRules: [],
    timeline: [],
    diagnosis: null,
    recordingSession: createWorkspaceRecordingSession(),
    workingCopy: createWorkspaceWorkingCopyMetadata(now, {
      flowId: 'workspace-working-copy',
    }),
    replayPlan: null,
    setTargetUrl: (targetUrl) => useWorkspaceStore.setState({ targetUrl }),
    setBrowserRuntime: (browserRuntime) => useWorkspaceStore.setState({ browserRuntime }),
    setRuntimeDiagnostics: (diagnostics) =>
      useWorkspaceStore.setState((state) => {
        const evidence = buildEvidenceFromRuntimeEvents(diagnostics.recentEvents);
        const recordingSession = maybeCaptureRecordedStepsFromRuntimeEvents(
          state.recordingSession,
          diagnostics.recentEvents,
        );

        return {
          browserRuntime: diagnostics.state,
          runtimeHealth: diagnostics.health,
          runtimeEvents: diagnostics.recentEvents,
          currentInspection: enrichInspectionWithRelatedRequests(
            extractLatestInspectionFromRuntimeEvents(diagnostics.recentEvents),
            recordingSession,
            evidence.captures,
          ),
          captures: evidence.captures,
          timeline: evidence.timeline,
          diagnosis: evidence.diagnosis,
          recordingSession,
        };
      }),
    pushRuntimeUpdate: (update) =>
      useWorkspaceStore.setState((state) => {
        const runtimeEvents = [
          update.event,
          ...state.runtimeEvents.filter((event) => event.id !== update.event.id),
        ].slice(0, 80);
        const evidence = buildEvidenceFromRuntimeEvents(runtimeEvents);
        const recordingSession = maybeCaptureRecordedStep(state.recordingSession, update.event);

        return {
          browserRuntime: update.state,
          runtimeHealth: update.health,
          runtimeEvents,
          currentInspection: enrichInspectionWithRelatedRequests(
            parseInspectionMetadataFromRuntimeEvent(update.event) ?? state.currentInspection,
            recordingSession,
            evidence.captures,
          ),
          captures: evidence.captures,
          timeline: evidence.timeline,
          diagnosis: evidence.diagnosis,
          recordingSession,
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
          captures: [],
          currentInspection: null,
          simulationRules: [],
          timeline: [],
          diagnosis: null,
          recordingSession: replaceRecordingSession({
            steps: [],
            checkpoints: [],
          }),
        };
      }),
    addRedactionRule: (rule) =>
      useWorkspaceStore.setState((state) => ({
        redactionRules: deduplicateRedactionRules([...state.redactionRules, rule]),
      })),
    removeRedactionRule: (ruleId) =>
      useWorkspaceStore.setState((state) => ({
        redactionRules: state.redactionRules.filter((rule) => rule.id !== ruleId),
      })),
    addSimulationRule: (rule) =>
      useWorkspaceStore.setState((state) => ({
        simulationRules: deduplicateSimulationRules([...state.simulationRules, rule]),
      })),
    replaceSimulationRule: (ruleId, rule) =>
      useWorkspaceStore.setState((state) => ({
        simulationRules: deduplicateSimulationRules(
          state.simulationRules.map((entry) => (entry.id === ruleId ? rule : entry)),
        ),
      })),
    removeSimulationRule: (ruleId) =>
      useWorkspaceStore.setState((state) => ({
        simulationRules: state.simulationRules.filter((rule) => rule.id !== ruleId),
      })),
    hydrateWorkingCopySnapshot: (snapshot) =>
      useWorkspaceStore.setState((state) => {
        const hydrated = hydrateWorkspaceFromStoredRunSnapshot(snapshot);

        return {
          ...state,
          targetUrl: hydrated.targetUrl,
          workingCopy: hydrated.metadata,
          captures: hydrated.captures,
          redactionRules: hydrated.redactionRules,
          simulationRules: hydrated.simulationRules,
          timeline: hydrated.timeline,
          diagnosis: hydrated.diagnosis,
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
        captures: useWorkspaceStore.getState().captures,
        redactionRules: useWorkspaceStore.getState().redactionRules,
        simulationRules: useWorkspaceStore.getState().simulationRules,
        timeline: useWorkspaceStore.getState().timeline,
        diagnosis: useWorkspaceStore.getState().diagnosis,
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

function deduplicateRedactionRules(rules: RedactionRule[]): RedactionRule[] {
  const seen = new Set<string>();

  return rules.filter((rule) => {
    if (seen.has(rule.id)) {
      return false;
    }

    seen.add(rule.id);
    return true;
  });
}

function deduplicateSimulationRules(rules: SimulationRule[]): SimulationRule[] {
  const seen = new Set<string>();

  return rules.filter((rule) => {
    if (seen.has(rule.id)) {
      return false;
    }

    seen.add(rule.id);
    return true;
  });
}

export function createUserDefinedRedactionRule(input: {
  id: string;
  kind: RedactionRule['kind'];
  target: string;
  scope: RedactionRule['scope'];
}): RedactionRule {
  return parseRedactionRule({
    schemaVersion: domainVersions.domainSchemaVersion,
    id: input.id,
    kind: input.kind,
    target: input.target,
    scope: input.scope,
    mode: 'user-defined',
  });
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

function extractLatestInspectionFromRuntimeEvents(
  runtimeEvents: BrowserRuntimeEvent[],
): InspectionMetadata | null {
  for (const event of runtimeEvents) {
    const inspection = parseInspectionMetadataFromRuntimeEvent(event);
    if (inspection) {
      return inspection;
    }
  }

  return null;
}

function parseInspectionMetadataFromRuntimeEvent(
  event: BrowserRuntimeEvent,
): InspectionMetadata | null {
  if (event.code !== 'inspection.target.selected') {
    return null;
  }

  try {
    return parseInspectionMetadata(event.data?.inspection);
  } catch {
    return null;
  }
}

function enrichInspectionWithRelatedRequests(
  inspection: InspectionMetadata | null,
  recordingSession: RecordingSession,
  captures: RequestResponseCapture[],
): InspectionMetadata | null {
  if (!inspection) {
    return null;
  }

  const selectorKeys = new Set<string>();
  const candidates = [
    inspection.recommendations.primary.locator,
    ...inspection.recommendations.fallbacks.map((candidate) => candidate.locator),
  ];

  for (const locator of candidates) {
    selectorKeys.add(locator);
    const childLocator = extractChildLocator(locator);
    if (childLocator) {
      selectorKeys.add(childLocator);
    }
  }

  const matchedStepIds = new Set(
    recordingSession.present.steps
      .filter((step) => {
        const selector = getRecordedStepSelector(step);
        return selector ? selectorKeys.has(selector) : false;
      })
      .map((step) => step.id),
  );

  const relatedRequestIds = captures
    .filter((capture) => capture.triggeringStepId && matchedStepIds.has(capture.triggeringStepId))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .map((capture) => capture.id);

  return {
    ...inspection,
    relatedRequestIds,
  };
}

function getRecordedStepSelector(step: RecordedStep): string | null {
  if (step.kind === 'action') {
    switch (step.action.type) {
      case 'click':
      case 'double-click':
      case 'fill':
      case 'select-option':
      case 'set-checked':
      case 'upload-file':
        return step.action.selector;
      case 'press-key':
        return step.action.selector ?? null;
      default:
        return null;
    }
  }

  switch (step.assertion.kind) {
    case 'element-visible':
    case 'element-hidden':
    case 'element-enabled':
    case 'element-contains-text':
      return step.assertion.selector;
    default:
      return null;
  }
}

function extractChildLocator(locator: string): string | null {
  const lastGetBy = locator.lastIndexOf('.getBy');
  const lastLocator = locator.lastIndexOf('.locator(');
  const lastSegmentIndex = Math.max(lastGetBy, lastLocator);

  if (lastSegmentIndex <= 0) {
    return null;
  }

  return `page${locator.slice(lastSegmentIndex)}`;
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

function maybeCaptureRecordedStepsFromRuntimeEvents(
  recordingSession: RecordingSession,
  runtimeEvents: BrowserRuntimeEvent[],
): RecordingSession {
  const captureEvents = [...runtimeEvents]
    .reverse()
    .filter((event) => event.code === 'recording.step.captured');

  if (captureEvents.length === 0) {
    return recordingSession;
  }

  let session = replaceRecordingSession({
    steps: [],
    checkpoints: [],
  });
  for (const event of captureEvents) {
    session = maybeCaptureRecordedStep(session, event);
  }
  return session;
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

function buildEvidenceFromRuntimeEvents(
  runtimeEvents: BrowserRuntimeEvent[],
): {
  captures: RequestResponseCapture[];
  timeline: TimelineEvent[];
  diagnosis: DiagnosisResult | null;
} {
  const chronologicalEvents = [...runtimeEvents].reverse();
  const captureMap = new Map<string, RequestResponseCapture>();
  const requestTimelineIds = new Map<string, string>();
  const timeline: TimelineEvent[] = [];
  const assertionEvents: TimelineEvent[] = [];
  const consoleOrExceptionEvents: TimelineEvent[] = [];
  const replayFailures: Array<{
    actionType?: string;
    assertionKind?: string;
    detail?: string;
    id: string;
    stepId?: string;
    timestamp: string;
  }> = [];
  let latestCapturedStepId: string | undefined;

  for (const event of chronologicalEvents) {
    if (event.code === 'recording.step.captured') {
      latestCapturedStepId = `step-captured-${event.id}`;
      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'user-action',
          stepId: latestCapturedStepId,
          summary: event.message,
        }),
      );
      continue;
    }

    if (event.code === 'browser.navigation.committed') {
      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'navigation',
          stepId: latestCapturedStepId,
          summary: event.message,
        }),
      );
      continue;
    }

    if (event.code === 'replay.simulation_rule.applied') {
      const ruleId = typeof event.data?.ruleId === 'string' ? event.data.ruleId : null;
      if (!ruleId) {
        continue;
      }

      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'simulation-rule',
          ruleId,
          summary: event.message,
        }),
      );
      continue;
    }

    if (event.code === 'console.message' && (event.level === 'warn' || event.level === 'error')) {
      const timelineEvent = parseTimelineEvent({
        schemaVersion: domainVersions.domainSchemaVersion,
        id: `timeline-${event.id}`,
        timestamp: event.timestamp,
        kind: event.level === 'error' ? 'exception' : 'console',
        summary: event.message,
        severity: event.level === 'error' ? 'error' : 'warning',
      });
      timeline.push(timelineEvent);
      consoleOrExceptionEvents.push(timelineEvent);
      continue;
    }

    if (event.code === 'replay.assertion.passed' || event.code === 'replay.assertion.failed') {
      const stepId = typeof event.data?.stepId === 'string' ? event.data.stepId : null;
      const assertionKind =
        typeof event.data?.assertionKind === 'string' ? event.data.assertionKind : null;

      if (!stepId || !assertionKind) {
        continue;
      }

      const timelineEvent = parseTimelineEvent({
        schemaVersion: domainVersions.domainSchemaVersion,
        id: `timeline-${event.id}`,
        timestamp: event.timestamp,
        kind: 'assertion',
        stepId,
        summary: event.message,
        assertionKind: assertionKind as AssertionStep['assertion']['kind'],
        outcome: event.code === 'replay.assertion.passed' ? 'passed' : 'failed',
      });
      timeline.push(timelineEvent);
      assertionEvents.push(timelineEvent);
      if (event.code === 'replay.assertion.failed') {
        replayFailures.push({
          assertionKind,
          detail: event.detail,
          id: `timeline-${event.id}`,
          stepId,
          timestamp: event.timestamp,
        });
        if (isTimeoutFailure(event.detail)) {
          timeline.push(
            parseTimelineEvent({
              schemaVersion: domainVersions.domainSchemaVersion,
              id: `timeline-${event.id}-timeout`,
              timestamp: event.timestamp,
              kind: 'timeout',
              stepId,
              summary: event.detail,
            }),
          );
        }
      }
      continue;
    }

    if (event.code === 'replay.step.failed') {
      replayFailures.push({
        actionType:
          typeof event.data?.actionType === 'string' ? event.data.actionType : undefined,
        detail: event.detail,
        id: `timeline-${event.id}`,
        stepId: typeof event.data?.stepId === 'string' ? event.data.stepId : undefined,
        timestamp: event.timestamp,
      });
      if (isTimeoutFailure(event.detail)) {
        timeline.push(
          parseTimelineEvent({
            schemaVersion: domainVersions.domainSchemaVersion,
            id: `timeline-${event.id}`,
            timestamp: event.timestamp,
            kind: 'timeout',
            stepId: typeof event.data?.stepId === 'string' ? event.data.stepId : undefined,
            summary: event.message,
          }),
        );
      }
      continue;
    }

    if (event.code === 'replay.execution.failed' && isTimeoutFailure(event.detail)) {
      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'timeout',
          summary: event.detail,
        }),
      );
      continue;
    }

    if (event.code === 'network.response.body.unavailable') {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null;
      if (!requestId) {
        continue;
      }

      const existing = captureMap.get(requestId);
      if (!existing?.response) {
        continue;
      }

      captureMap.set(
        requestId,
        parseRequestResponseCapture({
          ...existing,
          response: {
            ...existing.response,
            body:
              normalizeCaptureBody(event.data?.responseBody, 'response') ??
              unavailableBody(event.detail ?? 'Response body capture was unavailable.'),
          },
        }),
      );
      continue;
    }

    if (event.code === 'network.request.started') {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null;
      const url = typeof event.data?.url === 'string' ? event.data.url : null;
      const method = typeof event.data?.method === 'string' ? event.data.method : null;
      const protocol =
        event.data?.protocol === 'websocket' ? 'websocket' : 'http';
      const retryCount =
        typeof event.data?.retryCount === 'number' ? event.data.retryCount : 0;

      if (!requestId || !url || !method) {
        continue;
      }

      captureMap.set(
        requestId,
        parseRequestResponseCapture({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: requestId,
          timestamp: event.timestamp,
          triggeringStepId: latestCapturedStepId,
          protocol,
          request: {
            url,
            method,
            headers: normalizeStringRecord(event.data?.headers),
            body:
              normalizeCaptureBody(event.data?.body, 'request') ??
              unavailableBody('No request body was provided for this request.'),
          },
          correlationIds: [],
          origin: {
            fromCache: false,
            fromServiceWorker: false,
          },
          retryCount,
          blocked: event.data?.blocked === true,
        }),
      );
      const timelineEvent = parseTimelineEvent({
        schemaVersion: domainVersions.domainSchemaVersion,
        id: `timeline-${event.id}`,
        timestamp: event.timestamp,
        kind: 'request',
        requestId,
        summary: event.message,
      });
      timeline.push(timelineEvent);
      requestTimelineIds.set(requestId, timelineEvent.id);
      continue;
    }

    if (event.code === 'network.response.received') {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null;
      if (!requestId) {
        continue;
      }

      const existing = captureMap.get(requestId);
      const url =
        typeof event.data?.url === 'string'
          ? event.data.url
          : existing?.request.url ?? 'unknown URL';
      const method =
        typeof event.data?.method === 'string'
          ? event.data.method
          : existing?.request.method ?? 'UNKNOWN';
      const status =
        typeof event.data?.status === 'number' ? event.data.status : 200;

      captureMap.set(
        requestId,
        parseRequestResponseCapture({
          ...(existing ?? {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: requestId,
            timestamp: event.timestamp,
            protocol:
              event.data?.protocol === 'websocket' ? 'websocket' : 'http',
            request: {
              url,
              method,
              headers: {},
              body: unavailableBody('Request body capture is not wired into the evidence ledger yet.'),
            },
            correlationIds: [],
            origin: {
              fromCache: false,
              fromServiceWorker: false,
            },
            retryCount: 0,
            blocked: false,
          }),
          protocol:
            event.data?.protocol === 'websocket'
              ? 'websocket'
              : existing?.protocol ?? 'http',
          durationMs:
            typeof event.data?.durationMs === 'number' ? event.data.durationMs : existing?.durationMs,
          correlationIds:
            normalizeStringArray(event.data?.correlationIds) ?? existing?.correlationIds ?? [],
          origin: {
            fromCache: event.data?.fromCache === true,
            fromServiceWorker: event.data?.fromServiceWorker === true,
          },
          retryCount:
            typeof event.data?.retryCount === 'number'
              ? event.data.retryCount
              : existing?.retryCount ?? 0,
          blocked: event.data?.blocked === true || existing?.blocked === true,
          response: {
            status,
            headers: normalizeStringRecord(event.data?.headers),
            body:
              normalizeCaptureBody(event.data?.responseBody, 'response') ??
              unavailableBody('Response body capture is not wired into the evidence ledger yet.'),
          },
          timings: normalizeCaptureTimings(event.data?.timings) ?? existing?.timings,
        }),
      );
      continue;
    }

    if (event.code === 'network.request.failed') {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null;
      if (!requestId) {
        continue;
      }

      const existing = captureMap.get(requestId);
      const url =
        typeof event.data?.url === 'string'
          ? event.data.url
          : existing?.request.url ?? 'unknown URL';
      const method =
        typeof event.data?.method === 'string'
          ? event.data.method
          : existing?.request.method ?? 'UNKNOWN';

      captureMap.set(
        requestId,
        parseRequestResponseCapture({
          ...(existing ?? {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: requestId,
            timestamp: event.timestamp,
            protocol:
              event.data?.protocol === 'websocket' ? 'websocket' : 'http',
            request: {
              url,
              method,
              headers: normalizeStringRecord(event.data?.headers),
              body:
                normalizeCaptureBody(event.data?.body, 'request') ??
                unavailableBody('Request body capture is not wired into the evidence ledger yet.'),
            },
            correlationIds: [],
            origin: {
              fromCache: false,
              fromServiceWorker: false,
            },
            retryCount: 0,
            blocked: false,
          }),
          protocol:
            event.data?.protocol === 'websocket'
              ? 'websocket'
              : existing?.protocol ?? 'http',
          blocked: event.data?.blocked === true,
          failure: {
            code: event.code,
            message: event.detail ?? event.message,
          },
          retryCount:
            typeof event.data?.retryCount === 'number'
              ? event.data.retryCount
              : existing?.retryCount ?? 0,
          request: {
            ...(existing?.request ?? {
              url,
              method,
              headers: {},
              body: unavailableBody('Request body capture is not wired into the evidence ledger yet.'),
            }),
            headers: normalizeStringRecord(event.data?.headers),
            body:
              normalizeCaptureBody(event.data?.body, 'request') ??
              existing?.request.body ??
              unavailableBody('Request body capture is not wired into the evidence ledger yet.'),
          },
        }),
      );
      continue;
    }

    if (event.code === 'network.response.body.captured') {
      const requestId = typeof event.data?.requestId === 'string' ? event.data.requestId : null;
      if (!requestId) {
        continue;
      }

      const existing = captureMap.get(requestId);
      if (!existing?.response) {
        continue;
      }

      captureMap.set(
        requestId,
        parseRequestResponseCapture({
          ...existing,
          response: {
            ...existing.response,
            body:
              normalizeCaptureBody(event.data?.responseBody, 'response') ??
              existing.response.body,
          },
        }),
      );
      continue;
    }

    if (event.code === 'replay.checkpoint.captured') {
      const checkpointId =
        typeof event.data?.checkpointId === 'string' ? event.data.checkpointId : null;
      if (!checkpointId) {
        continue;
      }

      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'checkpoint',
          checkpointId,
          summary: event.message,
          status: 'created',
        }),
      );
      continue;
    }

    if (event.code === 'replay.checkpoint.restored') {
      const checkpointId =
        typeof event.data?.checkpointId === 'string' ? event.data.checkpointId : null;
      if (!checkpointId) {
        continue;
      }

      timeline.push(
        parseTimelineEvent({
          schemaVersion: domainVersions.domainSchemaVersion,
          id: `timeline-${event.id}`,
          timestamp: event.timestamp,
          kind: 'checkpoint',
          checkpointId,
          summary: event.message,
          status: 'reused',
        }),
      );
    }
  }

  const captures = [...captureMap.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );

  return {
    captures,
    timeline: timeline.sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
    diagnosis: buildDiagnosisResult({
      assertionEvents,
      captures,
      consoleOrExceptionEvents,
      replayFailures,
      requestTimelineIds,
    }),
  };
}

function buildDiagnosisResult(input: {
  assertionEvents: TimelineEvent[];
  captures: RequestResponseCapture[];
  consoleOrExceptionEvents: TimelineEvent[];
  replayFailures: Array<{
    actionType?: string;
    assertionKind?: string;
    detail?: string;
    id: string;
    stepId?: string;
    timestamp: string;
  }>;
  requestTimelineIds: Map<string, string>;
}): DiagnosisResult | null {
  const findings: DiagnosisResult['findings'] = [];
  const failedAssertion = [...input.assertionEvents]
    .reverse()
    .find((event) => event.kind === 'assertion' && event.outcome === 'failed');

  if (failedAssertion && failedAssertion.kind === 'assertion') {
    const blockingCapture = [...input.captures]
      .reverse()
      .find(
        (capture) =>
          capture.timestamp <= failedAssertion.timestamp &&
          (capture.failure !== undefined ||
            (capture.response?.status !== undefined && capture.response.status >= 400)),
      );
    const consoleError = [...input.consoleOrExceptionEvents]
      .reverse()
      .find(
        (event) =>
          event.timestamp <= failedAssertion.timestamp &&
          ((event.kind === 'exception' && event.severity === 'error') ||
            (event.kind === 'console' && event.severity === 'error')),
      );

    if (blockingCapture) {
      findings.push({
        schemaVersion: domainVersions.domainSchemaVersion,
        ruleId: 'assertion_blocked_by_failed_request',
        confidence: blockingCapture.failure ? 'high' : 'medium',
        evidenceEventIds: [
          input.requestTimelineIds.get(blockingCapture.id) ?? `request-${blockingCapture.id}`,
          failedAssertion.id,
        ],
        affectedWindow: {
          startedAt: blockingCapture.timestamp,
          endedAt: failedAssertion.timestamp,
        },
        summary: `The assertion failed after ${blockingCapture.request.method} ${blockingCapture.request.url} returned blocking network evidence.`,
      });
    }

    if (consoleError && consoleError.kind !== 'request' && consoleError.kind !== 'assertion') {
      findings.push({
        schemaVersion: domainVersions.domainSchemaVersion,
        ruleId: 'assertion_blocked_by_console_error',
        confidence: 'medium',
        evidenceEventIds: [consoleError.id, failedAssertion.id],
        affectedWindow: {
          startedAt: consoleError.timestamp,
          endedAt: failedAssertion.timestamp,
        },
        summary: `The assertion failed after a console or exception error was observed: ${consoleError.summary}`,
      });
    }

    if (findings.length === 0) {
      findings.push({
        schemaVersion: domainVersions.domainSchemaVersion,
        ruleId: 'assertion_blocked_by_missing_dom_transition',
        confidence: 'low',
        evidenceEventIds: [failedAssertion.id],
        affectedWindow: {
          startedAt: failedAssertion.timestamp,
          endedAt: failedAssertion.timestamp,
        },
        summary: `The assertion failed without a stronger cataloged blocker, so the expected DOM transition likely never occurred.`,
      });
    }
  } else {
    const failedCapture = input.captures.find(
      (capture) => capture.failure !== undefined || (capture.response?.status ?? 0) >= 400,
    );
    if (failedCapture) {
      findings.push({
        schemaVersion: domainVersions.domainSchemaVersion,
        ruleId: 'navigation_blocked_by_request_failure',
        confidence: failedCapture.failure ? 'medium' : 'low',
        evidenceEventIds: [
          input.requestTimelineIds.get(failedCapture.id) ?? `request-${failedCapture.id}`,
        ],
        affectedWindow: {
          startedAt: failedCapture.timestamp,
          endedAt: failedCapture.timestamp,
        },
        summary: `A network request failed during replay evidence capture for ${failedCapture.request.url}.`,
      });
    }
  }

  const failedPopupWait = input.replayFailures.find(
    (failure) => failure.actionType === 'wait-for-popup',
  );
  if (failedPopupWait) {
    findings.push({
      schemaVersion: domainVersions.domainSchemaVersion,
      ruleId: 'popup_missing_without_trigger',
      confidence: 'low',
      evidenceEventIds: [failedPopupWait.id],
      affectedWindow: {
        startedAt: failedPopupWait.timestamp,
        endedAt: failedPopupWait.timestamp,
      },
      summary: 'Replay waited for a popup, but no popup was observed within the expected window.',
    });
  }

  const failedDownloadWait = input.replayFailures.find(
    (failure) => failure.actionType === 'wait-for-download',
  );
  if (failedDownloadWait) {
    findings.push({
      schemaVersion: domainVersions.domainSchemaVersion,
      ruleId: 'download_missing_without_trigger',
      confidence: 'low',
      evidenceEventIds: [failedDownloadWait.id],
      affectedWindow: {
        startedAt: failedDownloadWait.timestamp,
        endedAt: failedDownloadWait.timestamp,
      },
      summary: 'Replay waited for a download, but no download was observed within the expected window.',
    });
  }

  if (findings.length === 0) {
    return null;
  }

  const orderedFindings = findings.sort(compareDiagnosisFindings);
  return parseDiagnosisResult({
    schemaVersion: domainVersions.domainSchemaVersion,
    catalogVersion: domainVersions.diagnosisRuleCatalogVersion,
    findings: orderedFindings,
  });
}

function compareDiagnosisFindings(
  left: DiagnosisResult['findings'][number],
  right: DiagnosisResult['findings'][number],
): number {
  const confidenceRank = {
    high: 0,
    medium: 1,
    low: 2,
  } as const;

  return (
    confidenceRank[left.confidence] - confidenceRank[right.confidence] ||
    left.affectedWindow.startedAt.localeCompare(right.affectedWindow.startedAt) ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

function isTimeoutFailure(detail: string | undefined): detail is string {
  return typeof detail === 'string' && /timed out|timeout/i.test(detail);
}

function asRecord(
  value: unknown,
): Record<string, string | boolean | undefined> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, string | boolean | undefined>;
  }

  return null;
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (record, [key, entry]) => {
      if (typeof entry === 'string') {
        record[key] = entry;
      }
      return record;
    },
    {},
  );
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function normalizeCaptureTimings(
  value: unknown,
): RequestResponseCapture['timings'] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const timings = value as Record<string, unknown>;
  const normalized: NonNullable<RequestResponseCapture['timings']> = {};

  if (typeof timings.dnsMs === 'number') {
    normalized.dnsMs = timings.dnsMs;
  }
  if (typeof timings.connectMs === 'number') {
    normalized.connectMs = timings.connectMs;
  }
  if (typeof timings.tlsMs === 'number') {
    normalized.tlsMs = timings.tlsMs;
  }
  if (typeof timings.requestMs === 'number') {
    normalized.requestMs = timings.requestMs;
  }
  if (typeof timings.responseMs === 'number') {
    normalized.responseMs = timings.responseMs;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function unavailableBody(reason: string): RequestResponseCapture['request']['body'] {
  return {
    state: 'unavailable',
    reason,
  };
}

function normalizeCaptureBody(
  value: unknown,
  channel: 'request' | 'response',
): RequestResponseCapture['request']['body'] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const body = value as Record<string, unknown>;
  if (body.state === 'full' && typeof body.text === 'string') {
    return {
      state: 'full',
      ...(typeof body.contentType === 'string' ? { contentType: body.contentType } : {}),
      text: body.text,
    };
  }

  if (
    body.state === 'redacted' &&
    typeof body.text === 'string' &&
    Array.isArray(body.redactionRuleIds)
  ) {
    return {
      state: 'redacted',
      ...(typeof body.contentType === 'string' ? { contentType: body.contentType } : {}),
      text: body.text,
      redactionRuleIds: body.redactionRuleIds.filter(
        (entry): entry is string => typeof entry === 'string',
      ),
    };
  }

  if (
    (body.state === 'excluded' ||
      body.state === 'unavailable' ||
      body.state === 'truncated') &&
    typeof body.reason === 'string'
  ) {
    return {
      state: body.state,
      ...(typeof body.contentType === 'string' ? { contentType: body.contentType } : {}),
      reason: body.reason,
    };
  }

  return unavailableBody(`${channel} body capture payload was malformed.`);
}

export * from './recording-session';
export * from './replay-planning';
export * from './workspace-persistence';
