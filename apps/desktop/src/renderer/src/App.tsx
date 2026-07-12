import { useEffect, useState } from 'react';
import {
  type BrowserContextSnapshot,
  domainVersions,
  productSummary,
  type CaptureBody,
  type InspectionMetadata,
  type RecordedStep,
  type RedactionRule,
  type RequestResponseCapture,
  type SimulationRule,
  type TimelineEvent,
} from '@browser-blackbox/domain';
import {
  generateApiCollection,
  generateApiRequestFixture,
  generatePlaywrightApiTest,
  generatePlaywrightSimulationRules,
  generatePlaywrightUiTest,
} from '@browser-blackbox/export';
import type {
  ApiExportWarning,
  PlaywrightUiExportWarning,
  SimulationExportWarning,
} from '@browser-blackbox/export';
import type {
  ArtifactBundleReadResult,
  ArtifactBundleExportResult,
  ArtifactExportMode,
} from '@browser-blackbox/persistence/src/contracts';
import { assessArtifactExportSafety } from '@browser-blackbox/persistence/src/export-safety';
import {
  DEFAULT_RESPONSE_BODY_CAPTURE_LIMIT_BYTES,
  isSensitiveEndpointUrl,
  type ProjectCapturePolicy,
} from '@browser-blackbox/shared';
import {
  createUserDefinedRedactionRule,
  getRecordingUndoAvailability,
  getSelectedRecordedStep,
  useWorkspaceStore,
} from '@browser-blackbox/ui-state';

export function App() {
  const url = useWorkspaceStore((state) => state.targetUrl);
  const browserRuntime = useWorkspaceStore((state) => state.browserRuntime);
  const runtimeHealth = useWorkspaceStore((state) => state.runtimeHealth);
  const runtimeEvents = useWorkspaceStore((state) => state.runtimeEvents);
  const currentInspection = useWorkspaceStore((state) => state.currentInspection);
  const projectSettings = useWorkspaceStore((state) => state.projectSettings);
  const captures = useWorkspaceStore((state) => state.captures);
  const redactionRules = useWorkspaceStore((state) => state.redactionRules);
  const simulationRules = useWorkspaceStore((state) => state.simulationRules);
  const timeline = useWorkspaceStore((state) => state.timeline);
  const diagnosis = useWorkspaceStore((state) => state.diagnosis);
  const recordingSession = useWorkspaceStore((state) => state.recordingSession);
  const replayPlan = useWorkspaceStore((state) => state.replayPlan);
  const setUrl = useWorkspaceStore((state) => state.setTargetUrl);
  const setBrowserRuntime = useWorkspaceStore((state) => state.setBrowserRuntime);
  const setProjectSettings = useWorkspaceStore((state) => state.setProjectSettings);
  const setRuntimeDiagnostics = useWorkspaceStore((state) => state.setRuntimeDiagnostics);
  const pushRuntimeUpdate = useWorkspaceStore((state) => state.pushRuntimeUpdate);
  const selectRecordedStep = useWorkspaceStore((state) => state.selectRecordedStep);
  const replaceRecordedStepInReview = useWorkspaceStore(
    (state) => state.replaceRecordedStepInReview,
  );
  const insertStepAfterSelection = useWorkspaceStore((state) => state.insertStepAfterSelection);
  const insertAuthoredStepAfterSelection = useWorkspaceStore(
    (state) => state.insertAuthoredStepAfterSelection,
  );
  const moveRecordedStep = useWorkspaceStore((state) => state.moveRecordedStep);
  const disableRecordedStepInReview = useWorkspaceStore(
    (state) => state.disableRecordedStepInReview,
  );
  const removeRecordedStepFromReview = useWorkspaceStore(
    (state) => state.removeRecordedStepFromReview,
  );
  const undoRecordingEdit = useWorkspaceStore((state) => state.undoRecordingEdit);
  const redoRecordingEdit = useWorkspaceStore((state) => state.redoRecordingEdit);
  const beginRuntimeCapture = useWorkspaceStore((state) => state.beginRuntimeCapture);
  const addRedactionRule = useWorkspaceStore((state) => state.addRedactionRule);
  const removeRedactionRule = useWorkspaceStore((state) => state.removeRedactionRule);
  const addSimulationRule = useWorkspaceStore((state) => state.addSimulationRule);
  const replaceSimulationRule = useWorkspaceStore((state) => state.replaceSimulationRule);
  const removeSimulationRule = useWorkspaceStore((state) => state.removeSimulationRule);
  const hydrateWorkingCopySnapshot = useWorkspaceStore(
    (state) => state.hydrateWorkingCopySnapshot,
  );
  const exportWorkingCopySnapshot = useWorkspaceStore(
    (state) => state.exportWorkingCopySnapshot,
  );
  const previewReplayFromStart = useWorkspaceStore((state) => state.previewReplayFromStart);
  const previewReplayToSelectedStep = useWorkspaceStore(
    (state) => state.previewReplayToSelectedStep,
  );
  const previewReplayFromCheckpoint = useWorkspaceStore(
    (state) => state.previewReplayFromCheckpoint,
  );
  const prepareReplayExecution = useWorkspaceStore((state) => state.prepareReplayExecution);
  const completeReplayExecution = useWorkspaceStore(
    (state) => state.completeReplayExecution,
  );
  const [pendingAction, setPendingAction] = useState<
    'launch' | 'stop' | 'replay' | null
  >(null);
  const [inspectionModeEnabled, setInspectionModeEnabled] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [newRuleKind, setNewRuleKind] = useState<RedactionRule['kind']>('json-path');
  const [newRuleScope, setNewRuleScope] = useState<RedactionRule['scope']>('both');
  const [newRuleTarget, setNewRuleTarget] = useState('');
  const [selectedSimulationRuleId, setSelectedSimulationRuleId] = useState<string | null>(null);
  const [pendingActionInsertType, setPendingActionInsertType] =
    useState<SupportedActionType>('click');
  const [simulationTitle, setSimulationTitle] = useState('Block route during replay');
  const [simulationAppliesTo, setSimulationAppliesTo] =
    useState<SimulationRule['appliesTo']>('global');
  const [simulationRoutePattern, setSimulationRoutePattern] = useState('**/*');
  const [simulationDomain, setSimulationDomain] = useState('');
  const [simulationMethod, setSimulationMethod] = useState('GET');
  const [simulationFlowContext, setSimulationFlowContext] = useState('');
  const [simulationActionKind, setSimulationActionKind] = useState<
    SimulationRule['action']['kind']
  >('route-block');
  const [simulationLatencyValue, setSimulationLatencyValue] = useState('250');
  const [simulationStatusValue, setSimulationStatusValue] = useState('503');
  const [simulationFixturePath, setSimulationFixturePath] = useState('');
  const [simulationEnabled, setSimulationEnabled] = useState(true);
  const [acknowledgeVisibleBodyExport, setAcknowledgeVisibleBodyExport] = useState(false);
  const [pendingExportMode, setPendingExportMode] = useState<ArtifactExportMode | null>(null);
  const [lastArtifactExport, setLastArtifactExport] =
    useState<ArtifactBundleExportResult | null>(null);
  const [timelineFilter, setTimelineFilter] = useState<'all' | TimelineKindFilter>('all');
  const [artifactReopenPath, setArtifactReopenPath] = useState('');
  const [sensitiveEndpointDraft, setSensitiveEndpointDraft] = useState('');
  const [lastReopenedArtifact, setLastReopenedArtifact] =
    useState<(ArtifactBundleReadResult & { rootDirectory: string }) | null>(null);
  const selectedRecordedStep = getSelectedRecordedStep(recordingSession);
  const relatedCaptures =
    currentInspection === null
      ? []
      : currentInspection.relatedRequestIds.flatMap((requestId) => {
          const capture = captures.find((entry) => entry.id === requestId);
          return capture ? [capture] : [];
        });
  const selectedCapture =
    (selectedCaptureId ? captures.find((capture) => capture.id === selectedCaptureId) : null) ??
    captures[0] ??
    null;
  const { canUndo, canRedo } = getRecordingUndoAvailability(recordingSession);
  const artifactExportAssessment = assessArtifactExportSafety(exportWorkingCopySnapshot());
  const generatedUiTest = generatePlaywrightUiTest({
    flowTitle:
      recordingSession.present.steps[0]?.title
        ? `${recordingSession.present.steps[0].title} flow`
        : undefined,
    steps: recordingSession.present.steps,
    simulationRules,
  });
  const generatedSimulationRules = generatePlaywrightSimulationRules({
    simulationRules,
  });
  const generatedApiTest = generatePlaywrightApiTest({
    flowTitle:
      recordingSession.present.steps[0]?.title
        ? `${recordingSession.present.steps[0].title} flow`
        : undefined,
    steps: recordingSession.present.steps,
    captures,
  });
  const generatedApiFixture = generateApiRequestFixture({
    flowTitle:
      recordingSession.present.steps[0]?.title
        ? `${recordingSession.present.steps[0].title} flow`
        : undefined,
    steps: recordingSession.present.steps,
    captures,
  });
  const generatedApiCollection = generateApiCollection({
    flowTitle:
      recordingSession.present.steps[0]?.title
        ? `${recordingSession.present.steps[0].title} flow`
        : undefined,
    steps: recordingSession.present.steps,
    captures,
  });
  const selectedStepIndex = selectedRecordedStep
    ? recordingSession.present.steps.findIndex((step) => step.id === selectedRecordedStep.id)
    : -1;
  const selectedSimulationRule =
    (selectedSimulationRuleId
      ? simulationRules.find((rule) => rule.id === selectedSimulationRuleId) ?? null
      : null);
  const appliedSimulationTimeline = timeline.filter(
    (entry) => entry.kind === 'simulation-rule',
  );
  const filteredTimeline =
    timelineFilter === 'all'
      ? timeline
      : timeline.filter((entry) => matchesTimelineFilter(entry, timelineFilter));

  useEffect(() => {
    void window.desktopShell
      .loadWorkingCopySnapshot()
      .then((snapshot) => {
        if (snapshot) {
          hydrateWorkingCopySnapshot(snapshot);
        }
      })
      .finally(() => {
        setPersistenceReady(true);
      });
  }, [hydrateWorkingCopySnapshot]);

  useEffect(() => {
    void window.desktopShell.getInspectionMode().then(setInspectionModeEnabled).catch(() => {
      setInspectionModeEnabled(false);
    });
  }, []);

  useEffect(() => {
    void window.desktopShell
      .getBrowserRuntimeDiagnostics()
      .then(setRuntimeDiagnostics)
      .catch((error) => {
        setBrowserRuntime({
          phase: 'error',
          targetUrl: null,
          pageUrl: null,
          sessionId: null,
          playwrightAttached: false,
          cdpAttached: false,
          lastError: error instanceof Error ? error.message : String(error),
        });
      });

    const unsubscribe = window.desktopShell.onBrowserRuntimeEvent((update) => {
      pushRuntimeUpdate(update);
    });

    return unsubscribe;
  }, [pushRuntimeUpdate, setBrowserRuntime, setRuntimeDiagnostics]);

  useEffect(() => {
    const latestInspectionModeEvent = runtimeEvents.find(
      (event) => event.code === 'inspection.mode.changed',
    );
    if (latestInspectionModeEvent && typeof latestInspectionModeEvent.data?.enabled === 'boolean') {
      setInspectionModeEnabled(latestInspectionModeEvent.data.enabled);
    }
  }, [runtimeEvents]);

  useEffect(() => {
    if (browserRuntime.phase !== 'running') {
      setInspectionModeEnabled(false);
    }
  }, [browserRuntime.phase]);

  useEffect(() => {
    if (!persistenceReady) {
      return;
    }

    void window.desktopShell.saveWorkingCopySnapshot(exportWorkingCopySnapshot());
  }, [
    browserRuntime.sessionId,
    exportWorkingCopySnapshot,
    persistenceReady,
    projectSettings,
    recordingSession,
    url,
  ]);

  useEffect(() => {
    void window.desktopShell.setRedactionRules(redactionRules);
  }, [redactionRules]);

  useEffect(() => {
    void window.desktopShell.setCapturePolicy(projectSettings.capturePolicy);
  }, [projectSettings]);

  useEffect(() => {
    if (captures.length === 0) {
      if (selectedCaptureId !== null) {
        setSelectedCaptureId(null);
      }
      return;
    }

    if (!selectedCaptureId || !captures.some((capture) => capture.id === selectedCaptureId)) {
      setSelectedCaptureId(captures[0]?.id ?? null);
    }
  }, [captures, selectedCaptureId]);

  async function launchManagedChromium(): Promise<void> {
    setPendingAction('launch');
    beginRuntimeCapture(url, null);

    try {
      const result = await window.desktopShell.launchBrowserSession({
        targetUrl: url,
        capturePolicy: projectSettings.capturePolicy,
        redactionRules,
      });
      setBrowserRuntime(result.state);
    } catch (error) {
      setBrowserRuntime({
        ...browserRuntime,
        phase: browserRuntime.phase,
        playwrightAttached: browserRuntime.playwrightAttached,
        cdpAttached: browserRuntime.cdpAttached,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function stopManagedChromium(): Promise<void> {
    setPendingAction('stop');

    try {
      const result = await window.desktopShell.stopBrowserSession();
      setBrowserRuntime(result.state);
    } catch (error) {
      setBrowserRuntime({
        ...browserRuntime,
        phase: browserRuntime.phase,
        playwrightAttached: browserRuntime.playwrightAttached,
        cdpAttached: browserRuntime.cdpAttached,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function runReplay(): Promise<void> {
    if (!replayPlan) {
      return;
    }

    setPendingAction('replay');
    prepareReplayExecution();

    try {
      const result = await window.desktopShell.runReplay({
        targetUrl: browserRuntime.targetUrl ?? url,
        steps: useWorkspaceStore.getState().recordingSession.present.steps,
        checkpoints: useWorkspaceStore.getState().recordingSession.present.checkpoints,
        plan: replayPlan,
        capturePolicy: useWorkspaceStore.getState().projectSettings.capturePolicy,
        redactionRules: useWorkspaceStore.getState().redactionRules,
        simulationRules: useWorkspaceStore.getState().simulationRules,
      });
      setBrowserRuntime(result.state);
      completeReplayExecution(result.completedStepIds, result.capturedCheckpoints);
    } catch (error) {
      setBrowserRuntime({
        ...browserRuntime,
        phase: browserRuntime.phase,
        playwrightAttached: browserRuntime.playwrightAttached,
        cdpAttached: browserRuntime.cdpAttached,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
    }
  }

  function resetSimulationRuleDraft(): void {
    setSelectedSimulationRuleId(null);
    setSimulationTitle('Block route during replay');
    setSimulationAppliesTo('global');
    setSimulationRoutePattern('**/*');
    setSimulationDomain('');
    setSimulationMethod('GET');
    setSimulationFlowContext('');
    setSimulationActionKind('route-block');
    setSimulationLatencyValue('250');
    setSimulationStatusValue('503');
    setSimulationFixturePath('');
    setSimulationEnabled(true);
  }

  function loadSimulationRuleDraft(rule: SimulationRule): void {
    setSelectedSimulationRuleId(rule.id);
    setSimulationTitle(rule.title);
    setSimulationAppliesTo(rule.appliesTo);
    setSimulationRoutePattern(rule.match.routePattern ?? '');
    setSimulationDomain(rule.match.domain ?? '');
    setSimulationMethod(rule.match.method ?? 'GET');
    setSimulationFlowContext(rule.match.flowContext ?? '');
    setSimulationEnabled(rule.enabled);
    setSimulationActionKind(rule.action.kind);
    if ('valueMsOrKbps' in rule.action) {
      setSimulationLatencyValue(String(rule.action.valueMsOrKbps));
      setSimulationStatusValue('503');
      setSimulationFixturePath('');
      return;
    }
    if (rule.action.kind === 'forced-status') {
      setSimulationStatusValue(String(rule.action.status));
      setSimulationLatencyValue('250');
      setSimulationFixturePath('');
      return;
    }
    if (rule.action.kind === 'delayed-response') {
      setSimulationLatencyValue(String(rule.action.delayMs));
      setSimulationStatusValue(String(rule.action.status ?? 200));
      setSimulationFixturePath(rule.action.fixturePath ?? '');
      return;
    }
    if (rule.action.kind === 'response-fixture') {
      setSimulationStatusValue(String(rule.action.status ?? 200));
      setSimulationFixturePath(rule.action.fixturePath);
      setSimulationLatencyValue('250');
      return;
    }
    setSimulationLatencyValue('250');
    setSimulationStatusValue('503');
    setSimulationFixturePath('');
  }

  function saveSimulationRule(): void {
    const rule = buildSimulationRuleDraft({
      actionKind: simulationActionKind,
      appliesTo: simulationAppliesTo,
      domain: simulationDomain,
      enabled: simulationEnabled,
      fixturePath: simulationFixturePath,
      flowContext: simulationFlowContext,
      id: selectedSimulationRuleId ?? `sim-user-${Date.now()}`,
      latencyValue: simulationLatencyValue,
      method: simulationMethod,
      routePattern: simulationRoutePattern,
      statusValue: simulationStatusValue,
      title: simulationTitle,
    });

    if (selectedSimulationRuleId) {
      replaceSimulationRule(selectedSimulationRuleId, rule);
    } else {
      addSimulationRule(rule);
    }

    loadSimulationRuleDraft(rule);
  }

  function updateCapturePolicy(
    partial: Partial<ProjectCapturePolicy>,
  ): void {
    setProjectSettings({
      capturePolicy: {
        ...projectSettings.capturePolicy,
        ...partial,
      },
    });
  }

  function addSensitiveEndpointPattern(): void {
    const next = sensitiveEndpointDraft.trim();
    if (next.length === 0) {
      return;
    }

    if (projectSettings.capturePolicy.sensitiveEndpointPatterns.includes(next)) {
      setSensitiveEndpointDraft('');
      return;
    }

    updateCapturePolicy({
      sensitiveEndpointPatterns: [
        ...projectSettings.capturePolicy.sensitiveEndpointPatterns,
        next,
      ],
    });
    setSensitiveEndpointDraft('');
  }

  function addAssertionFromInspection(
    kind: SupportedAssertionKind,
  ): void {
    if (!currentInspection) {
      return;
    }

    insertAuthoredStepAfterSelection(
      createInspectionAssertionStep(currentInspection, kind),
    );
  }

  function addClickStepFromInspection(): void {
    if (!currentInspection) {
      return;
    }

    insertAuthoredStepAfterSelection(createInspectionClickStep(currentInspection));
  }

  function addActionFromToolbar(): void {
    insertAuthoredStepAfterSelection(
      createToolbarActionStep(
        pendingActionInsertType,
        selectedRecordedStep,
        currentInspection,
      ),
    );
  }

  async function toggleInspectionMode(): Promise<void> {
    const nextEnabled = await window.desktopShell.setInspectionMode(!inspectionModeEnabled);
    setInspectionModeEnabled(nextEnabled);
  }

  async function exportArtifactBundle(mode: ArtifactExportMode): Promise<void> {
    setPendingExportMode(mode);

    try {
      const result = await window.desktopShell.exportArtifactBundle({
        snapshot: exportWorkingCopySnapshot(),
        mode,
      });
      setLastArtifactExport(result);
      setArtifactReopenPath(result.rootDirectory);
      setAcknowledgeVisibleBodyExport(false);
    } finally {
      setPendingExportMode(null);
    }
  }

  async function reopenArtifactBundle(): Promise<void> {
    if (artifactReopenPath.trim().length === 0) {
      return;
    }

    if (browserRuntime.phase !== 'idle') {
      try {
        const stopped = await window.desktopShell.stopBrowserSession();
        setBrowserRuntime(stopped.state);
      } catch {
        // Keep the reopen flow visible even if session teardown fails.
      }
    }

    const result = await window.desktopShell.reopenArtifactBundle(artifactReopenPath.trim());
    hydrateWorkingCopySnapshot(result.snapshot);
    setLastReopenedArtifact({
      ...result,
      rootDirectory: artifactReopenPath.trim(),
    });
    setBrowserRuntime({
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    });
  }

  function createRedactionRule(): void {
    const target = newRuleTarget.trim();
    if (target.length === 0) {
      return;
    }

    addRedactionRule(
      createUserDefinedRedactionRule({
        id: `rule-user-${Date.now()}`,
        kind: newRuleKind,
        scope: newRuleScope,
        target,
      }),
    );
    setNewRuleTarget('');
  }

  function handleTimelineEntrySelection(entry: typeof timeline[number]): void {
    if (entry.kind === 'request') {
      setSelectedCaptureId(entry.requestId);
      return;
    }

    if ('stepId' in entry && entry.stepId) {
      selectRecordedStep(entry.stepId);
    }
  }

  return (
    <main className="app-shell">
      <div className="app-frame">
        <section className="sidebar-stack">
          <header className="hero-panel">
            <p className="eyebrow">Phase 4 recording review</p>
            <div className="hero-grid">
              <div className="hero-copy">
                <h1 className="hero-title">QA Browser Shell</h1>
                <p className="hero-summary">{productSummary}</p>
              </div>
              <section className="hero-card">
                <p className="section-label">Editable review lane</p>
                <p className="hero-card-copy">
                  The shell now exposes a canonical step-review surface backed by
                  shared flow-edit state, so small recording mistakes can be fixed as
                  data before replay instead of forcing a fresh browser capture.
                </p>
              </section>
            </div>
          </header>

          <article className="panel control-panel">
            <p className="section-label">Target launch</p>
            <label className="field-label" htmlFor="target-url">
              Target URL
            </label>
            <input
              id="target-url"
              className="url-input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
            />
            <div className="button-row">
              <button
                className="button button-primary"
                disabled={pendingAction !== null}
                onClick={() => void launchManagedChromium()}
              >
                Launch managed Chromium
              </button>
              <button
                className="button button-secondary"
                disabled={pendingAction !== null || browserRuntime.phase === 'idle'}
                onClick={() => void stopManagedChromium()}
              >
                Stop session
              </button>
            </div>
            <div className="runtime-status">
              <p className="status-row">
                <span className="status-label">Phase</span>
                <span className={`status-pill status-${browserRuntime.phase}`}>
                  {browserRuntime.phase}
                </span>
              </p>
              <p className="status-row">
                <span className="status-label">Health</span>
                <span className={`status-pill status-health-${runtimeHealth.status}`}>
                  {runtimeHealth.status}
                </span>
              </p>
              <p className="status-row">
                <span className="status-label">Target</span>
                <span className="status-value">{browserRuntime.targetUrl ?? 'Not launched'}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Page</span>
                <span className="status-value">{browserRuntime.pageUrl ?? 'No page yet'}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Session</span>
                <span className="status-value">
                  {browserRuntime.sessionId ?? 'No active session'}
                </span>
              </p>
              <p className="status-row">
                <span className="status-label">Playwright</span>
                <span className="status-value">
                  {browserRuntime.playwrightAttached ? 'Attached' : 'Not attached'}
                </span>
              </p>
              <p className="status-row">
                <span className="status-label">CDP</span>
                <span className="status-value">
                  {browserRuntime.cdpAttached ? 'Attached' : 'Not attached'}
                </span>
              </p>
              <p className="status-row">
                <span className="status-label">Recent events</span>
                <span className="status-value">{runtimeHealth.recentEventCount}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Subscribers</span>
                <span className="status-value">{runtimeHealth.subscriberCount}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Last event</span>
                <span className="status-value">
                  {runtimeHealth.lastEventAt
                    ? formatTimestamp(runtimeHealth.lastEventAt)
                    : 'No events yet'}
                </span>
              </p>
              {browserRuntime.lastError ? (
                <p className="runtime-error">{browserRuntime.lastError}</p>
              ) : null}
              {!browserRuntime.lastError && runtimeHealth.lastError ? (
                <p className="runtime-error">{runtimeHealth.lastError}</p>
              ) : null}
            </div>
          </article>

          <article className="panel control-panel">
            <p className="section-label">Evidence ledger</p>
            <div className="runtime-status">
              <p className="status-row">
                <span className="status-label">Requests</span>
                <span className="status-value">{captures.length}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Timeline events</span>
                <span className="status-value">{timeline.length}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Diagnosis</span>
                <span className="status-value">
                  {diagnosis ? diagnosis.findings.length : 0}
                </span>
              </p>
              <p className="panel-copy">
                {diagnosis?.findings[0]?.summary ??
                  diagnosis?.noDeterminationReason ??
                  'No deterministic diagnosis has been derived from the current evidence yet.'}
              </p>
            </div>
          </article>

          <article className="panel control-panel" data-testid="project-settings-panel">
            <p className="section-label">Project settings</p>
            <p className="panel-copy">
              Persist capture policy for this workspace. Mandatory credential and
              secret redaction still applies even when visible response bodies are
              allowed by project setting.
            </p>
            <div className="runtime-status">
              <label className="checkbox-field" htmlFor="capture-request-bodies">
                <input
                  id="capture-request-bodies"
                  type="checkbox"
                  checked={projectSettings.capturePolicy.captureRequestBodies}
                  onChange={(event) =>
                    updateCapturePolicy({
                      captureRequestBodies: event.target.checked,
                    })
                  }
                />
                <span>Capture request bodies</span>
              </label>
              <label className="checkbox-field" htmlFor="capture-response-bodies">
                <input
                  id="capture-response-bodies"
                  type="checkbox"
                  checked={projectSettings.capturePolicy.captureResponseBodies}
                  onChange={(event) =>
                    updateCapturePolicy({
                      captureResponseBodies: event.target.checked,
                    })
                  }
                />
                <span>Capture response bodies</span>
              </label>
              <label className="field-label" htmlFor="response-body-mode">
                Response body policy
              </label>
              <select
                id="response-body-mode"
                className="field-input"
                value={projectSettings.capturePolicy.responseBodyCaptureMode}
                disabled={!projectSettings.capturePolicy.captureResponseBodies}
                onChange={(event) =>
                  updateCapturePolicy({
                    responseBodyCaptureMode:
                      event.target.value === 'full-with-warning'
                        ? 'full-with-warning'
                        : 'safe-default',
                  })
                }
              >
                <option value="safe-default">Safe default</option>
                <option value="full-with-warning">Visible bodies with warning</option>
              </select>
              <label className="field-label" htmlFor="response-body-limit">
                Response body size limit
              </label>
              <select
                id="response-body-limit"
                className="field-input"
                value={String(projectSettings.capturePolicy.responseBodySizeLimitBytes)}
                disabled={!projectSettings.capturePolicy.captureResponseBodies}
                onChange={(event) =>
                  updateCapturePolicy({
                    responseBodySizeLimitBytes: Number(event.target.value),
                  })
                }
              >
                {RESPONSE_BODY_LIMIT_OPTIONS.map((entry) => (
                  <option key={entry} value={entry}>
                    {formatByteLimit(entry)}
                  </option>
                ))}
              </select>
              <p className="panel-copy">
                {describeCapturePolicy(projectSettings.capturePolicy)}
              </p>
              <div className="network-detail-card">
                <p className="section-label">Sensitive endpoint patterns</p>
                <p className="panel-copy">
                  Add project-specific path fragments or `*` wildcard patterns that
                  should be treated like auth/session endpoints under the safe
                  default capture policy.
                </p>
                <label className="field-label" htmlFor="sensitive-endpoint-pattern">
                  New pattern
                </label>
                <input
                  id="sensitive-endpoint-pattern"
                  className="field-input"
                  value={sensitiveEndpointDraft}
                  onChange={(event) => setSensitiveEndpointDraft(event.target.value)}
                  placeholder="Example: /api/billing/*"
                />
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => addSensitiveEndpointPattern()}
                  >
                    Add endpoint pattern
                  </button>
                </div>
                {projectSettings.capturePolicy.sensitiveEndpointPatterns.length === 0 ? (
                  <p className="empty-state">
                    No project-defined sensitive endpoints yet. Built-in auth and
                    session endpoints are still protected by default.
                  </p>
                ) : (
                  <div className="checkpoint-list">
                    {projectSettings.capturePolicy.sensitiveEndpointPatterns.map((pattern) => (
                      <div className="step-review-card" key={pattern}>
                        <div className="step-review-header">
                          <span className="step-index">custom-sensitive-endpoint</span>
                          <button
                            className="button button-danger"
                            type="button"
                            onClick={() =>
                              updateCapturePolicy({
                                sensitiveEndpointPatterns:
                                  projectSettings.capturePolicy.sensitiveEndpointPatterns.filter(
                                    (entry) => entry !== pattern,
                                  ),
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <p className="step-title">{pattern}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {projectSettings.capturePolicy.responseBodyCaptureMode ===
                'full-with-warning' &&
              projectSettings.capturePolicy.captureResponseBodies ? (
                <p className="runtime-error">
                  Visible response-body capture is enabled for this project. Sensitive
                  endpoints may now retain redacted but otherwise inspectable payload
                  content when responses are textual and within the configured size limit.
                </p>
              ) : null}
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Request detail</p>
                <p className="panel-copy">
                  Inspect captured browser requests with canonical body-state explanations,
                  timing phases, and the active project capture policy.
                </p>
              </div>
            </div>
            <div className="network-detail-grid" data-testid="network-capture-panel">
              <div className="network-capture-list">
                {captures.length === 0 ? (
                  <p className="empty-state">
                    No request evidence has been captured yet. Launch a session and
                    interact with the page to inspect request and response details here.
                  </p>
                ) : (
                  captures.map((capture) => {
                    const selected = selectedCapture?.id === capture.id;
                    return (
                      <button
                        key={capture.id}
                        type="button"
                        className={`step-review-card network-capture-card${
                          selected ? ' step-review-card-selected' : ''
                        }`}
                        data-testid={`request-card-${capture.id}`}
                        onClick={() => setSelectedCaptureId(capture.id)}
                      >
                        <div className="step-review-header">
                          <span className="step-index">{capture.request.method}</span>
                          <span
                            className={`status-pill ${getCaptureStatusClassName(capture)}`}
                          >
                            {describeCaptureOutcome(capture)}
                          </span>
                        </div>
                        <p className="step-title">{formatRequestLabel(capture.request.url)}</p>
                        <p className="step-summary">{capture.request.url}</p>
                        <div className="step-review-tags">
                          <span className="review-tag">
                            {formatTimestamp(capture.timestamp)}
                          </span>
                          <span className="review-tag">{capture.protocol}</span>
                          {capture.triggeringStepId ? (
                            <span className="review-tag">linked step</span>
                          ) : null}
                          {capture.blocked ? <span className="review-tag">blocked</span> : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="step-editor-shell">
                {selectedCapture ? (
                  <div className="network-detail-stack" data-testid="request-detail-view">
                    <div className="step-editor-header">
                      <div>
                        <p className="section-label">Selected request</p>
                        <h2 className="step-editor-title">
                          {selectedCapture.request.method}{' '}
                          {formatRequestLabel(selectedCapture.request.url)}
                        </h2>
                      </div>
                      <div className="step-review-tags">
                        <span className="review-tag">{selectedCapture.id}</span>
                        <span className="review-tag">
                          {selectedCapture.response?.status ??
                            (selectedCapture.failure ? 'failed' : 'pending')}
                        </span>
                      </div>
                    </div>

                    <div className="runtime-status">
                      <p className="status-row">
                        <span className="status-label">URL</span>
                        <span className="status-value">{selectedCapture.request.url}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Triggered by step</span>
                        <span className="status-value">
                          {selectedCapture.triggeringStepId ?? 'No correlated step'}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Origin</span>
                        <span className="status-value">
                          {describeCaptureOrigin(selectedCapture)}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Protocol</span>
                        <span className="status-value">{selectedCapture.protocol}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Duration</span>
                        <span className="status-value">
                          {formatDuration(selectedCapture.durationMs)}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Retry count</span>
                        <span className="status-value">{selectedCapture.retryCount}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Blocked</span>
                        <span className="status-value">
                          {selectedCapture.blocked ? 'yes' : 'no'}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Correlation IDs</span>
                        <span className="status-value">
                          {selectedCapture.correlationIds.join(', ') || 'None'}
                        </span>
                      </p>
                    </div>

                    <div className="network-body-grid">
                      <RequestBodySection
                        title="Request payload"
                        headers={selectedCapture.request.headers}
                        body={selectedCapture.request.body}
                        sensitiveEndpointPatterns={
                          projectSettings.capturePolicy.sensitiveEndpointPatterns
                        }
                        testId="request-body-section"
                      />
                      <RequestBodySection
                        title="Response payload"
                        headers={selectedCapture.response?.headers ?? null}
                        body={selectedCapture.response?.body}
                        status={selectedCapture.response?.status}
                        failure={selectedCapture.failure}
                        sensitiveEndpointPatterns={
                          projectSettings.capturePolicy.sensitiveEndpointPatterns
                        }
                        targetUrl={selectedCapture.request.url}
                        testId="response-body-section"
                      />
                    </div>

                    <div className="network-detail-card">
                      <p className="section-label">Capture policy</p>
                      <p className="inspection-reason">
                        Guaranteed secret redaction is always active for credential-like
                        transport fields. Additional user-defined masking rules are a
                        separate layer and are configured below.
                      </p>
                      <p className="inspection-reason">
                        Full visible bodies may still contain personal or regulated data
                        unless explicit redaction rules are added before sharing or export.
                      </p>
                    </div>

                    <div className="network-detail-card" data-testid="redaction-rules-panel">
                      <div className="panel-header">
                        <div>
                          <p className="section-label">Redaction rules</p>
                          <p className="panel-copy">
                            Guaranteed rules always protect credential-like transport data.
                            Add user-defined rules for known business fields, headers,
                            cookies, query params, or regex patterns captured in this workspace.
                          </p>
                        </div>
                      </div>
                      <div className="rule-editor-grid">
                        <label className="field-label" htmlFor="redaction-kind">
                          Rule kind
                        </label>
                        <select
                          id="redaction-kind"
                          className="url-input"
                          value={newRuleKind}
                          onChange={(event) =>
                            setNewRuleKind(event.target.value as RedactionRule['kind'])
                          }
                        >
                          <option value="json-path">JSON path</option>
                          <option value="form-field">Form field</option>
                          <option value="query-param">Query param</option>
                          <option value="header">Header</option>
                          <option value="cookie">Cookie</option>
                          <option value="regex">Regex pattern</option>
                        </select>

                        <label className="field-label" htmlFor="redaction-scope">
                          Scope
                        </label>
                        <select
                          id="redaction-scope"
                          className="url-input"
                          value={newRuleScope}
                          onChange={(event) =>
                            setNewRuleScope(event.target.value as RedactionRule['scope'])
                          }
                        >
                          <option value="both">Request and response</option>
                          <option value="request">Request only</option>
                          <option value="response">Response only</option>
                        </select>

                        <label className="field-label" htmlFor="redaction-target">
                          Target
                        </label>
                        <input
                          id="redaction-target"
                          className="url-input"
                          value={newRuleTarget}
                          onChange={(event) => setNewRuleTarget(event.target.value)}
                          placeholder={describeRuleTargetPlaceholder(newRuleKind)}
                        />

                        <div className="button-row">
                          <button
                            className="button button-primary"
                            disabled={newRuleTarget.trim().length === 0}
                            onClick={() => createRedactionRule()}
                            type="button"
                          >
                            Add redaction rule
                          </button>
                        </div>
                      </div>

                      <div className="checkpoint-list">
                        {redactionRules.length === 0 ? (
                          <p className="empty-state">
                            No user-defined rules yet. Mandatory credential redaction still
                            applies even with an empty list.
                          </p>
                        ) : (
                          redactionRules.map((rule) => (
                            <div className="step-review-card" key={rule.id}>
                              <div className="step-review-header">
                                <span className="step-index">{rule.kind}</span>
                                <span className="status-value">{rule.scope}</span>
                              </div>
                              <p className="step-summary">{rule.target}</p>
                              <div className="step-review-tags">
                                <span className="review-tag">{rule.mode}</span>
                                <span className="review-tag">{rule.id}</span>
                              </div>
                              <div className="button-row">
                                <button
                                  className="button button-secondary"
                                  onClick={() => removeRedactionRule(rule.id)}
                                  type="button"
                                >
                                  Remove rule
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="network-detail-card" data-testid="request-timing-panel">
                      <p className="section-label">Timing phases</p>
                      {selectedCapture.timings ? (
                        <div className="timing-grid">
                          {renderTimingRow('DNS', selectedCapture.timings.dnsMs)}
                          {renderTimingRow('Connect', selectedCapture.timings.connectMs)}
                          {renderTimingRow('TLS', selectedCapture.timings.tlsMs)}
                          {renderTimingRow('Request', selectedCapture.timings.requestMs)}
                          {renderTimingRow('Response', selectedCapture.timings.responseMs)}
                        </div>
                      ) : (
                        <p className="empty-state">
                          Chromium timing phases are not available for this request.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">
                    Select a captured request to inspect its request, response, and timing
                    evidence.
                  </p>
                )}
              </div>
            </div>
          </article>

          <article className="panel full-width-panel" data-testid="artifact-export-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Artifact export</p>
                <p className="panel-copy">
                  Export a reopenable run artifact bundle. Default export removes
                  visible body payloads that still match the export-safety heuristic
                  unless you explicitly choose the visible-body override path.
                </p>
              </div>
            </div>
            <div className="network-detail-grid">
              <div className="network-detail-card">
                <p className="section-label">Safety assessment</p>
                <div className="runtime-status">
                  <p className="status-row">
                    <span className="status-label">Warning count</span>
                    <span className="status-value">
                      {artifactExportAssessment.warningCount}
                    </span>
                  </p>
                  <p className="panel-copy">
                    {artifactExportAssessment.warningCount === 0
                      ? 'No visible-body export warnings are currently detected.'
                      : 'Some captured full bodies still look sensitive. The safe export path will exclude those bodies unless you explicitly override it.'}
                  </p>
                </div>
                <div className="checkpoint-list">
                  {artifactExportAssessment.findings.length === 0 ? (
                    <p className="empty-state">
                      The current working copy is ready for default artifact export.
                    </p>
                  ) : (
                    artifactExportAssessment.findings.map((finding) => (
                      <div className="step-review-card" key={`${finding.captureId}-${finding.side}`}>
                        <div className="step-review-header">
                          <span className="step-index">{finding.side}</span>
                          <span className="status-value">{finding.reason}</span>
                        </div>
                        <p className="step-summary">{finding.url}</p>
                        <p className="inspection-reason">{finding.preview}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="network-detail-card">
                <p className="section-label">Playwright UI export preview</p>
                <p className="inspection-reason">
                  This preview is generated directly from the canonical recorded flow and
                  written into the artifact bundle as a standard Playwright `*.spec.ts` file.
                </p>
                <div className="runtime-status">
                  <p className="status-row">
                    <span className="status-label">Export file</span>
                    <span className="status-value">{generatedUiTest.fileName}</span>
                  </p>
                  <p className="status-row">
                    <span className="status-label">Test name</span>
                    <span className="status-value">{generatedUiTest.testName}</span>
                  </p>
                  {simulationRules.length > 0 ? (
                    <p className="status-row">
                      <span className="status-label">Simulation helper</span>
                      <span className="status-value">{generatedSimulationRules.fileName}</span>
                    </p>
                  ) : null}
                </div>
                {generatedUiTest.warnings.length > 0 ? (
                  <div className="checkpoint-list" data-testid="ui-export-warnings">
                    {generatedUiTest.warnings.map((warning: PlaywrightUiExportWarning) => (
                      <div
                        className="step-review-card"
                        key={`${warning.kind}-${'stepId' in warning ? warning.stepId : warning.ruleId}`}
                      >
                        <div className="step-review-header">
                          <span className="step-index">{warning.kind}</span>
                          <span className="status-value">
                            {'stepId' in warning ? warning.stepId : warning.ruleId}
                          </span>
                        </div>
                        <p className="step-summary">{warning.title}</p>
                        {'detail' in warning ? (
                          <p className="inspection-reason">{warning.detail}</p>
                        ) : (
                          <p className="inspection-reason">
                            Disabled steps are omitted from the default export.
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <pre className="network-body-text" data-testid="ui-export-preview">
                  {generatedUiTest.code}
                </pre>
                {simulationRules.length > 0 ? (
                  <>
                    {generatedSimulationRules.warnings.length > 0 ? (
                      <div
                        className="checkpoint-list"
                        data-testid="simulation-export-warnings"
                      >
                        {generatedSimulationRules.warnings.map(
                          (warning: SimulationExportWarning) => (
                            <div
                              className="step-review-card"
                              key={`${warning.kind}-${warning.ruleId}`}
                            >
                              <div className="step-review-header">
                                <span className="step-index">{warning.kind}</span>
                                <span className="status-value">{warning.ruleId}</span>
                              </div>
                              <p className="step-summary">{warning.title}</p>
                              <p className="inspection-reason">{warning.detail}</p>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                    <pre
                      className="network-body-text"
                      data-testid="simulation-export-preview"
                    >
                      {generatedSimulationRules.code}
                    </pre>
                  </>
                ) : null}
              </div>

              <div className="network-detail-card">
                <p className="section-label">API export preview</p>
                <p className="inspection-reason">
                  The API export core emits a Playwright request-context spec plus a grouped
                  JSON fixture built from the canonical redacted capture model.
                </p>
                <div className="runtime-status">
                  <p className="status-row">
                    <span className="status-label">API test file</span>
                    <span className="status-value">{generatedApiTest.fileName}</span>
                  </p>
                  <p className="status-row">
                    <span className="status-label">Fixture file</span>
                    <span className="status-value">{generatedApiFixture.fileName}</span>
                  </p>
                  <p className="status-row">
                    <span className="status-label">Collection file</span>
                    <span className="status-value">{generatedApiCollection.fileName}</span>
                  </p>
                </div>
                {generatedApiTest.warnings.length > 0 ? (
                  <div className="checkpoint-list" data-testid="api-export-warnings">
                    {generatedApiTest.warnings.map((warning: ApiExportWarning) => (
                      <div
                        className="step-review-card"
                        key={`${warning.kind}-${warning.captureId}`}
                      >
                        <div className="step-review-header">
                          <span className="step-index">{warning.kind}</span>
                          <span className="status-value">{warning.captureId}</span>
                        </div>
                        <p className="step-summary">
                          {'url' in warning ? warning.url : 'Protocol-specific capture omitted'}
                        </p>
                        <p className="inspection-reason">{warning.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                <pre className="network-body-text" data-testid="api-export-preview">
                  {generatedApiTest.code}
                </pre>
                <pre className="network-body-text" data-testid="api-fixture-preview">
                  {generatedApiFixture.code}
                </pre>
                <pre className="network-body-text" data-testid="api-collection-preview">
                  {generatedApiCollection.code}
                </pre>
              </div>

              <div className="network-detail-card">
                <p className="section-label">Export actions</p>
                <p className="inspection-reason">
                  Default export preserves mandatory and configured redaction behavior
                  and excludes warning-flagged visible bodies from the artifact bundle.
                </p>
                <div className="button-row">
                  <button
                    className="button button-primary"
                    disabled={pendingExportMode !== null}
                    onClick={() => void exportArtifactBundle('safe-redacted')}
                    type="button"
                  >
                    Export safe artifact bundle
                  </button>
                </div>
                {artifactExportAssessment.warningCount > 0 ? (
                  <>
                    <label className="export-warning-toggle">
                      <input
                        checked={acknowledgeVisibleBodyExport}
                        onChange={(event) =>
                          setAcknowledgeVisibleBodyExport(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        I understand this export may contain visible personal,
                        credential, or session-like payload data.
                      </span>
                    </label>
                    <div className="button-row">
                      <button
                        className="button button-danger"
                        disabled={
                          pendingExportMode !== null || !acknowledgeVisibleBodyExport
                        }
                        onClick={() => void exportArtifactBundle('unsafe-unredacted')}
                        type="button"
                      >
                        Export with visible bodies
                      </button>
                    </div>
                  </>
                ) : null}
                {lastArtifactExport ? (
                  <div className="runtime-status" data-testid="artifact-export-result">
                    <p className="status-row">
                      <span className="status-label">Last export mode</span>
                      <span className="status-value">{lastArtifactExport.mode}</span>
                    </p>
                    <p className="status-row">
                      <span className="status-label">Bundle path</span>
                      <span className="status-value">{lastArtifactExport.rootDirectory}</span>
                    </p>
                    <p className="status-row">
                      <span className="status-label">Warnings recorded</span>
                      <span className="status-value">
                        {lastArtifactExport.assessment.warningCount}
                      </span>
                    </p>
                  </div>
                ) : null}
                <div className="checkpoint-list" data-testid="artifact-reopen-panel">
                  <label className="field-label" htmlFor="artifact-reopen-path">
                    Artifact bundle path
                  </label>
                  <input
                    id="artifact-reopen-path"
                    className="url-input"
                    value={artifactReopenPath}
                    onChange={(event) => setArtifactReopenPath(event.target.value)}
                  />
                  <div className="button-row">
                    <button
                      className="button button-secondary"
                      disabled={artifactReopenPath.trim().length === 0}
                      onClick={() => void reopenArtifactBundle()}
                      type="button"
                    >
                      Reopen artifact bundle
                    </button>
                  </div>
                  {lastReopenedArtifact ? (
                    <div className="runtime-status" data-testid="artifact-reopen-result">
                      <p className="status-row">
                        <span className="status-label">Projection</span>
                        <span className="status-value">
                          {lastReopenedArtifact.snapshot.projection.kind}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Artifact format</span>
                        <span className="status-value">
                          {lastReopenedArtifact.manifest.artifactFormatVersion}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Source bundle</span>
                        <span className="status-value">{lastReopenedArtifact.rootDirectory}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Missing optional</span>
                        <span className="status-value">
                          {lastReopenedArtifact.missingOptionalArtifacts.length}
                        </span>
                      </p>
                      {lastReopenedArtifact.missingOptionalArtifacts.length > 0 ? (
                        <div className="checkpoint-list">
                          {lastReopenedArtifact.missingOptionalArtifacts.map((artifactPath) => (
                            <div className="step-review-card" key={artifactPath}>
                              <div className="step-review-header">
                                <span className="step-index">optional-missing</span>
                                <span className="status-value">{artifactPath}</span>
                              </div>
                              <p className="inspection-reason">
                                Reopen degraded gracefully because this artifact is optional.
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="inspection-reason">
                          No optional artifacts were missing from the reopened bundle.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Inspector lane</p>
                <p className="panel-copy">
                  Turn on inspect mode to hover live elements in the embedded browser,
                  preview the active locator overlay, and click once to pin the current
                  target into the review lane.
                </p>
              </div>
              <div className="recording-toolbar">
                <button
                  className={`button ${inspectionModeEnabled ? 'button-danger' : 'button-secondary'}`}
                  disabled={browserRuntime.phase !== 'running' || pendingAction !== null}
                  onClick={() => void toggleInspectionMode()}
                >
                  {inspectionModeEnabled ? 'Exit inspect mode' : 'Enter inspect mode'}
                </button>
              </div>
            </div>
            {currentInspection ? (
              <div className="inspection-grid" data-testid="inspection-panel">
                <div className="inspection-card">
                  <p className="inspection-title">
                    {currentInspection.target.tagName}
                    {currentInspection.target.accessibleName
                      ? ` · ${currentInspection.target.accessibleName}`
                      : ''}
                  </p>
                  <p className="step-summary">
                    {inspectionModeEnabled
                      ? 'Inspect mode is live. Move across the embedded browser to update the overlay, then click an element to pin this panel.'
                      : 'Enable inspect mode, then hover and click inside the embedded browser to refresh this panel.'}
                  </p>
                  <div className="step-review-tags">
                    <span className="review-tag">
                      {currentInspection.target.interactiveType}
                    </span>
                    {currentInspection.target.role ? (
                      <span className="review-tag">{currentInspection.target.role}</span>
                    ) : null}
                    {currentInspection.context.inShadowDom ? (
                      <span className="review-tag">shadow dom</span>
                    ) : null}
                    {currentInspection.context.iframeDepth > 0 ? (
                      <span className="review-tag">
                        iframe depth {currentInspection.context.iframeDepth}
                      </span>
                    ) : null}
                  </div>
                  <div className="runtime-status">
                    <p className="status-row">
                      <span className="status-label">Primary locator</span>
                      <span className="status-value">
                        {currentInspection.recommendations.primary.locator}
                      </span>
                    </p>
                    <p className="status-row">
                      <span className="status-label">Stability</span>
                      <span className="status-value">
                        {currentInspection.recommendations.primary.stability} ·{' '}
                        {currentInspection.recommendations.primary.stabilityScore}/100
                      </span>
                    </p>
                    <p className="status-row">
                      <span className="status-label">Uniqueness</span>
                      <span className="status-value">
                        {currentInspection.recommendations.primary.uniqueness}
                      </span>
                    </p>
                    <p className="status-row">
                      <span className="status-label">Test ID</span>
                      <span className="status-value">
                        {currentInspection.context.testId ?? 'None'}
                      </span>
                    </p>
                    {currentInspection.context.iframeSource ? (
                      <p className="status-row">
                        <span className="status-label">Frame source</span>
                        <span className="status-value">
                          {currentInspection.context.iframeSource}
                        </span>
                      </p>
                    ) : null}
                    <p className="status-row">
                      <span className="status-label">Visible / enabled / obscured</span>
                      <span className="status-value">
                        {formatBoolean(currentInspection.context.visible)} /{' '}
                        {formatBoolean(currentInspection.context.enabled)} /{' '}
                        {formatBoolean(currentInspection.context.obscured)}
                      </span>
                    </p>
                    {currentInspection.target.labelText ? (
                      <p className="status-row">
                        <span className="status-label">Label</span>
                        <span className="status-value">
                          {currentInspection.target.labelText}
                        </span>
                      </p>
                    ) : null}
                    {currentInspection.target.textContent ? (
                      <p className="status-row">
                        <span className="status-label">Text</span>
                        <span className="status-value">
                          {currentInspection.target.textContent}
                        </span>
                      </p>
                    ) : null}
                    {currentInspection.target.interactiveType !== 'other' &&
                    !currentInspection.target.accessibleName ? (
                      <p className="runtime-error">
                        This interactive target does not expose a stable accessible name.
                      </p>
                    ) : null}
                    {currentInspection.stableParent ? (
                      <div className="inspection-reasoning">
                        <p className="section-label">Stable parent anchor</p>
                        <p className="inspection-reason">
                          {currentInspection.stableParent.locator}
                        </p>
                        <p className="inspection-reason">
                          Strategy: {currentInspection.stableParent.strategy}
                        </p>
                        {currentInspection.stableParent.reasoning.map((reason) => (
                          <p className="inspection-reason" key={reason}>
                            {reason}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <div className="inspection-reasoning">
                      <p className="section-label">Primary reasoning</p>
                      {currentInspection.recommendations.primary.reasoning.map((reason) => (
                        <p className="inspection-reason" key={reason}>
                          {reason}
                        </p>
                      ))}
                    </div>
                    <div className="inspection-authoring-card">
                      <p className="section-label">Author from inspection</p>
                      <p className="panel-copy">
                        Turn the pinned inspected target into a review step without
                        retyping selectors.
                      </p>
                      <div className="authoring-action-grid">
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => addAssertionFromInspection('element-visible')}
                        >
                          Add visible assertion
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => addAssertionFromInspection('element-contains-text')}
                        >
                          Add text assertion
                        </button>
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() => addClickStepFromInspection()}
                        >
                          Add click step
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="inspection-card">
                  <p className="section-label">Fallback locators</p>
                  {currentInspection.recommendations.fallbacks.length === 0 ? (
                    <p className="empty-state">
                      No fallback locator candidates were derived for the current target.
                    </p>
                  ) : (
                    <div className="checkpoint-list">
                      {currentInspection.recommendations.fallbacks.map((candidate) => (
                        <div className="step-review-card" key={candidate.locator}>
                          <div className="step-review-header">
                            <span className="step-index">{candidate.strategy}</span>
                            <span className="status-value">
                              {candidate.stability} · {candidate.stabilityScore}/100
                            </span>
                          </div>
                          <p className="step-summary">{candidate.locator}</p>
                          {candidate.reasoning.map((reason) => (
                            <p className="inspection-reason" key={reason}>
                              {reason}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="section-label inspection-subheading">Attributes</p>
                  <div className="inspection-attributes">
                    {Object.entries(currentInspection.target.attributes).map(([key, value]) => (
                      <div className="review-tag" key={key}>
                        {key}={value}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="inspection-card">
                  <p className="section-label">Related requests</p>
                  {relatedCaptures.length === 0 ? (
                    <p className="empty-state">
                      No request correlation is available for the current target yet.
                    </p>
                  ) : (
                    <div className="checkpoint-list">
                      {relatedCaptures.map((capture) => (
                        <div className="step-review-card" key={capture.id}>
                          <button
                            type="button"
                            className="network-link-button"
                            onClick={() => setSelectedCaptureId(capture.id)}
                          >
                          <div className="step-review-header">
                            <span className="step-index">
                              {capture.request.method}
                            </span>
                            <span className="status-value">
                              {capture.response?.status ??
                                (capture.failure ? 'failed' : 'pending')}
                            </span>
                          </div>
                          <p className="step-summary">{capture.request.url}</p>
                          <p className="inspection-reason">
                            request id: {capture.id}
                          </p>
                          {capture.correlationIds.length > 0 ? (
                            <p className="inspection-reason">
                              correlation: {capture.correlationIds.join(', ')}
                            </p>
                          ) : null}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="empty-state" data-testid="inspection-panel">
                Launch a session, enable inspect mode, then hover and click an element
                inside the embedded browser to inspect its selector metadata.
              </p>
            )}
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Recorded flow review</p>
                <p className="panel-copy">
                  Edit recorded steps, insert supported actions or assertions, and
                  review what evidence is now stale before replay regenerates it.
                </p>
              </div>
              <div className="recording-toolbar">
                <div className="authoring-cluster">
                  <p className="authoring-cluster-label">History</p>
                  <div className="authoring-action-grid">
                    <button
                      className="button button-secondary"
                      disabled={!canUndo}
                      onClick={() => undoRecordingEdit()}
                    >
                      Undo
                    </button>
                    <button
                      className="button button-secondary"
                      disabled={!canRedo}
                      onClick={() => redoRecordingEdit()}
                    >
                      Redo
                    </button>
                  </div>
                </div>
                <div className="authoring-cluster authoring-cluster-wide">
                  <p className="authoring-cluster-label">Compose action</p>
                  <div className="authoring-action-grid authoring-action-grid-wide">
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('reload')}
                    >
                      Quick reload
                    </button>
                    <select
                      aria-label="Insert action type"
                      className="field-input authoring-select"
                      value={pendingActionInsertType}
                      onChange={(event) =>
                        setPendingActionInsertType(event.target.value as SupportedActionType)
                      }
                    >
                      {SUPPORTED_ACTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button button-secondary"
                      onClick={() => addActionFromToolbar()}
                    >
                      Insert action
                    </button>
                  </div>
                </div>
                <div className="authoring-cluster authoring-cluster-wide">
                  <p className="authoring-cluster-label">Compose assertion</p>
                  <div className="authoring-action-grid">
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('assert-visible')}
                    >
                      Visible
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('assert-enabled')}
                    >
                      Enabled
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('assert-hidden')}
                    >
                      Hidden
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('assert-text')}
                    >
                      Text
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => insertStepAfterSelection('url-assertion')}
                    >
                      URL
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="recording-review-grid">
              <div className="step-review-list" data-testid="recorded-step-list">
                {recordingSession.present.steps.map((step, index) => (
                  <button
                    key={step.id}
                    className={`step-review-card step-review-card-${step.kind} step-review-card-${step.status}${
                      step.id === recordingSession.selectedStepId
                        ? ' step-review-card-selected'
                        : ''
                    }`}
                    onClick={() => selectRecordedStep(step.id)}
                    type="button"
                  >
                    <div className="step-review-header">
                      <div className="step-review-meta">
                        <span className="step-index">Step {index + 1}</span>
                        <span className={`step-kind-pill step-kind-pill-${step.kind}`}>
                          {step.kind}
                        </span>
                      </div>
                      <div className="step-review-meta">
                        <span className={`status-pill status-${step.evidenceState}`}>
                          {step.evidenceState}
                        </span>
                        {step.status === 'disabled' ? (
                          <span className="review-tag review-tag-warning">disabled</span>
                        ) : null}
                      </div>
                    </div>
                    <p className="step-title">{step.title}</p>
                    <p className="step-summary">{describeRecordedStep(step)}</p>
                    <div className="step-review-signal-row">
                      <span className={`step-signal-bar step-signal-bar-${step.evidenceState}`} />
                      <span className="step-signal-copy">
                        {describeEvidenceState(step.evidenceState)}
                      </span>
                    </div>
                    <div className="step-review-tags">
                      {step.dependencyStepIds.length > 0 ? (
                        <span className="review-tag review-tag-dependency">
                          depends on {step.dependencyStepIds.length}
                        </span>
                      ) : null}
                      {step.invalidatesEvidenceAfter ? (
                        <span className="review-tag review-tag-warning">
                          invalidates downstream evidence
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>

              <div className="step-editor-shell">
                {selectedRecordedStep ? (
                  <>
                    <div className="step-editor-header">
                      <div>
                        <p className="section-label">Selected step</p>
                        <h2 className="step-editor-title">{selectedRecordedStep.title}</h2>
                      </div>
                      <div className="step-editor-actions">
                        <button
                          className="button button-secondary"
                          disabled={selectedStepIndex <= 0}
                          onClick={() => moveRecordedStep(selectedRecordedStep.id, 'up')}
                        >
                          Move up
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={
                            selectedStepIndex === -1 ||
                            selectedStepIndex >=
                              recordingSession.present.steps.length - 1
                          }
                          onClick={() => moveRecordedStep(selectedRecordedStep.id, 'down')}
                        >
                          Move down
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={selectedRecordedStep.status === 'disabled'}
                          onClick={() => disableRecordedStepInReview(selectedRecordedStep.id)}
                        >
                          Disable
                        </button>
                        <button
                          className="button button-danger"
                          onClick={() => removeRecordedStepFromReview(selectedRecordedStep.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="step-editor-layout">
                      <div className="step-editor-panel">
                        <p className="section-label">Step overview</p>
                        <div className="step-editor-metadata">
                          <p className="status-row">
                            <span className="status-label">Kind</span>
                            <span className="status-value">{selectedRecordedStep.kind}</span>
                          </p>
                          <p className="status-row">
                            <span className="status-label">Status</span>
                            <span className="status-value">{selectedRecordedStep.status}</span>
                          </p>
                          <p className="status-row">
                            <span className="status-label">Evidence state</span>
                            <span className="status-value">
                              {selectedRecordedStep.evidenceState}
                            </span>
                          </p>
                          <p className="status-row">
                            <span className="status-label">Dependencies</span>
                            <span className="status-value">
                              {selectedRecordedStep.dependencyStepIds.length > 0
                                ? selectedRecordedStep.dependencyStepIds.join(', ')
                                : 'None'}
                            </span>
                          </p>
                        </div>
                        <div className="editor-form-grid">
                          <label className="field-label" htmlFor="step-title">
                            Step title
                          </label>
                          <input
                            id="step-title"
                            className="url-input"
                            value={selectedRecordedStep.title}
                            onChange={(event) =>
                              replaceRecordedStepInReview(selectedRecordedStep.id, {
                                ...selectedRecordedStep,
                                title: event.target.value,
                                updatedAt: new Date().toISOString(),
                              })
                            }
                          />
                        </div>
                      </div>

                      <div className="step-editor-panel">
                        <p className="section-label">Parameters</p>
                        <p className="panel-copy">
                          Edit the step details that will drive replay and export.
                        </p>
                        <div className="editor-form-grid">
                          {selectedRecordedStep.kind === 'action' ? (
                            <ActionEditor
                              inspectedLocator={
                                currentInspection?.recommendations.primary.locator ?? null
                              }
                              step={selectedRecordedStep}
                              onChange={(step) =>
                                replaceRecordedStepInReview(selectedRecordedStep.id, step)
                              }
                            />
                          ) : (
                            <AssertionEditor
                              inspectedLocator={
                                currentInspection?.recommendations.primary.locator ?? null
                              }
                              inspectedText={
                                currentInspection?.target.textContent ??
                                currentInspection?.target.accessibleName ??
                                null
                              }
                              step={selectedRecordedStep}
                              onChange={(step) =>
                                replaceRecordedStepInReview(selectedRecordedStep.id, step)
                              }
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="step-editor-footer">
                      <p className="section-label">Replay impact</p>
                      <div className="step-editor-impact-grid">
                        <div className="step-editor-impact-card">
                          <p className="status-row">
                            <span className="status-label">Last mutation</span>
                            <span className="status-value">
                              {recordingSession.lastMutation.kind}
                            </span>
                          </p>
                          <p className="panel-copy">
                            Affected steps:{' '}
                            {recordingSession.lastMutation.affectedStepIds.join(', ') || 'none'}.
                          </p>
                        </div>
                        <div className="step-editor-impact-card">
                          <p className="status-row">
                            <span className="status-label">Checkpoint invalidation</span>
                            <span className="status-value">
                              {recordingSession.lastMutation.invalidatedCheckpointIds.length}
                            </span>
                          </p>
                          <p className="panel-copy">
                            Invalidated checkpoints:{' '}
                            {recordingSession.lastMutation.invalidatedCheckpointIds.join(', ') ||
                              'none'}
                            .
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="empty-state">
                    No recorded step is selected. Choose a step from the review list
                    to edit its parameters or insert new steps around it.
                  </p>
                )}
              </div>
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Simulation rules</p>
                <p className="panel-copy">
                  Attach deterministic network rules to the current flow so the next
                  replay can run with route blocking, latency, offline-style failures,
                  forced statuses, or fixture-backed responses.
                </p>
              </div>
              <div className="recording-toolbar">
                <button className="button button-secondary" onClick={() => resetSimulationRuleDraft()}>
                  New rule
                </button>
                <button className="button button-primary" onClick={() => saveSimulationRule()}>
                  {selectedSimulationRule ? 'Save rule' : 'Add rule'}
                </button>
              </div>
            </div>

            <div className="recording-review-grid" data-testid="simulation-rules-panel">
              <div className="step-review-list">
                {simulationRules.length === 0 ? (
                  <p className="empty-state">
                    No simulation rules are attached yet. Replays currently run against
                    live network behavior only.
                  </p>
                ) : (
                  simulationRules.map((rule) => (
                    <button
                      key={rule.id}
                      className={`step-review-card${
                        rule.id === selectedSimulationRuleId ? ' step-review-card-selected' : ''
                      }`}
                      onClick={() => loadSimulationRuleDraft(rule)}
                      type="button"
                    >
                      <div className="step-review-header">
                        <span className="step-index">{rule.action.kind}</span>
                        <span className={`status-pill status-${rule.enabled ? 'running' : 'idle'}`}>
                          {rule.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                      <p className="step-title">{rule.title}</p>
                      <p className="step-summary">
                        {describeSimulationRule(rule)}
                      </p>
                      <div className="step-review-tags">
                        <span className="review-tag">{rule.appliesTo}</span>
                        <span className="review-tag">{rule.id}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="step-editor-shell">
                <div className="editor-form-grid">
                  <label className="field-label" htmlFor="simulation-title">
                    Rule title
                  </label>
                  <input
                    id="simulation-title"
                    className="url-input"
                    value={simulationTitle}
                    onChange={(event) => setSimulationTitle(event.target.value)}
                  />

                  <label className="field-label" htmlFor="simulation-applies-to">
                    Applies to
                  </label>
                  <select
                    id="simulation-applies-to"
                    className="select-input"
                    value={simulationAppliesTo}
                    onChange={(event) =>
                      setSimulationAppliesTo(event.target.value as SimulationRule['appliesTo'])
                    }
                  >
                    <option value="global">global</option>
                    <option value="scenario">scenario</option>
                  </select>

                  <label className="field-label" htmlFor="simulation-route-pattern">
                    Route pattern
                  </label>
                  <input
                    id="simulation-route-pattern"
                    className="url-input"
                    value={simulationRoutePattern}
                    onChange={(event) => setSimulationRoutePattern(event.target.value)}
                  />

                  <label className="field-label" htmlFor="simulation-domain">
                    Domain
                  </label>
                  <input
                    id="simulation-domain"
                    className="url-input"
                    value={simulationDomain}
                    onChange={(event) => setSimulationDomain(event.target.value)}
                  />

                  <label className="field-label" htmlFor="simulation-method">
                    Method
                  </label>
                  <input
                    id="simulation-method"
                    className="url-input"
                    value={simulationMethod}
                    onChange={(event) => setSimulationMethod(event.target.value.toUpperCase())}
                  />

                  <label className="field-label" htmlFor="simulation-flow-context">
                    Flow context
                  </label>
                  <input
                    id="simulation-flow-context"
                    className="url-input"
                    value={simulationFlowContext}
                    onChange={(event) => setSimulationFlowContext(event.target.value)}
                  />

                  <label className="field-label" htmlFor="simulation-action-kind">
                    Action kind
                  </label>
                  <select
                    id="simulation-action-kind"
                    className="select-input"
                    value={simulationActionKind}
                    onChange={(event) =>
                      setSimulationActionKind(
                        event.target.value as SimulationRule['action']['kind'],
                      )
                    }
                  >
                    <option value="route-block">route-block</option>
                    <option value="fixed-latency">fixed-latency</option>
                    <option value="latency-jitter">latency-jitter</option>
                    <option value="offline">offline</option>
                    <option value="forced-status">forced-status</option>
                    <option value="delayed-response">delayed-response</option>
                    <option value="response-fixture">response-fixture</option>
                  </select>

                  {simulationActionKind === 'fixed-latency' ||
                  simulationActionKind === 'latency-jitter' ||
                  simulationActionKind === 'delayed-response' ? (
                    <>
                      <label className="field-label" htmlFor="simulation-latency-value">
                        Delay or jitter (ms)
                      </label>
                      <input
                        id="simulation-latency-value"
                        className="url-input"
                        value={simulationLatencyValue}
                        onChange={(event) => setSimulationLatencyValue(event.target.value)}
                      />
                    </>
                  ) : null}

                  {simulationActionKind === 'forced-status' ||
                  simulationActionKind === 'delayed-response' ||
                  simulationActionKind === 'response-fixture' ? (
                    <>
                      <label className="field-label" htmlFor="simulation-status-value">
                        HTTP status
                      </label>
                      <input
                        id="simulation-status-value"
                        className="url-input"
                        value={simulationStatusValue}
                        onChange={(event) => setSimulationStatusValue(event.target.value)}
                      />
                    </>
                  ) : null}

                  {simulationActionKind === 'delayed-response' ||
                  simulationActionKind === 'response-fixture' ? (
                    <>
                      <label className="field-label" htmlFor="simulation-fixture-path">
                        Fixture path
                      </label>
                      <input
                        id="simulation-fixture-path"
                        className="url-input"
                        value={simulationFixturePath}
                        onChange={(event) => setSimulationFixturePath(event.target.value)}
                      />
                    </>
                  ) : null}

                  <label className="field-label" htmlFor="simulation-enabled">
                    Enabled
                  </label>
                  <label className="export-warning-toggle" htmlFor="simulation-enabled">
                    <input
                      id="simulation-enabled"
                      checked={simulationEnabled}
                      onChange={(event) => setSimulationEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Apply this rule during replay.</span>
                  </label>
                </div>

                {selectedSimulationRule ? (
                  <div className="button-row">
                    <button
                      className="button button-danger"
                      onClick={() => {
                        removeSimulationRule(selectedSimulationRule.id);
                        resetSimulationRuleDraft();
                      }}
                      type="button"
                    >
                      Remove rule
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Unified timeline</p>
                <p className="panel-copy">
                  Review user actions, navigation, requests, assertions, timeouts,
                  console issues, checkpoints, and applied rules in one canonical lane.
                </p>
              </div>
              <div className="recording-toolbar">
                <select
                  aria-label="Timeline filter"
                  className="select-input"
                  value={timelineFilter}
                  onChange={(event) =>
                    setTimelineFilter(event.target.value as 'all' | TimelineKindFilter)
                  }
                >
                  <option value="all">all</option>
                  <option value="flow">flow</option>
                  <option value="request">request</option>
                  <option value="assertion">assertion</option>
                  <option value="issue">issue</option>
                  <option value="checkpoint">checkpoint</option>
                  <option value="simulation">simulation</option>
                </select>
              </div>
            </div>
            <div className="runtime-status">
              <p className="status-row">
                <span className="status-label">Visible events</span>
                <span className="status-value">{filteredTimeline.length}</span>
              </p>
              <p className="status-row">
                <span className="status-label">Filter</span>
                <span className="status-value">{timelineFilter}</span>
              </p>
            </div>
            <div className="checkpoint-list" data-testid="timeline-panel">
              {filteredTimeline.length === 0 ? (
                <p className="empty-state">
                  No timeline events match the current filter.
                </p>
              ) : (
                filteredTimeline.map((entry) => (
                  <button
                    key={entry.id}
                    className="step-review-card"
                    onClick={() => handleTimelineEntrySelection(entry)}
                    type="button"
                  >
                    <div className="step-review-header">
                      <span className="step-index">{entry.kind}</span>
                      <span className={`status-value ${timelineEntryStatusClassName(entry)}`}>
                        {describeTimelineEntryBadge(entry)}
                      </span>
                    </div>
                    <p className="step-summary">{entry.summary}</p>
                    <div className="step-review-tags">
                      <span className="review-tag">{formatTimestamp(entry.timestamp)}</span>
                      {'stepId' in entry && entry.stepId ? (
                        <span className="review-tag">{entry.stepId}</span>
                      ) : null}
                      {entry.kind === 'request' ? (
                        <span className="review-tag">{entry.requestId}</span>
                      ) : null}
                      {entry.kind === 'simulation-rule' ? (
                        <span className="review-tag">{entry.ruleId}</span>
                      ) : null}
                      {entry.kind === 'checkpoint' ? (
                        <span className="review-tag">{entry.checkpointId}</span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Replay recovery</p>
                <p className="panel-copy">
                  Preview the recovery path for the current working copy before
                  replay. Valid checkpoints can be reused; stale ones are shown but
                  not trusted.
                </p>
              </div>
              <div className="recording-toolbar">
                <button
                  className="button button-secondary"
                  onClick={() => previewReplayFromStart()}
                >
                  Replay from start
                </button>
                <button
                  className="button button-secondary"
                  disabled={!selectedRecordedStep}
                  onClick={() => previewReplayToSelectedStep('up-to-step')}
                >
                  Replay to step
                </button>
                <button
                  className="button button-secondary"
                  disabled={!selectedRecordedStep}
                  onClick={() => previewReplayToSelectedStep('pause-on-step')}
                >
                  Pause on step
                </button>
                <button
                  className="button button-primary"
                  disabled={
                    !replayPlan ||
                    pendingAction !== null ||
                    browserRuntime.phase !== 'running'
                  }
                  onClick={() => void runReplay()}
                >
                  Run replay
                </button>
              </div>
            </div>

            <div className="recording-review-grid">
              <div className="step-review-list">
                <div className="step-editor-shell">
                  <p className="section-label">Available checkpoints</p>
                  <p className="panel-copy">
                    Reusable checkpoints can shorten replay. Stale or metadata-only
                    checkpoints remain visible so you can see why they are not safe to resume.
                  </p>
                  <div className="checkpoint-list">
                    {recordingSession.present.checkpoints.length === 0 ? (
                      <p className="empty-state">
                        No checkpoints are available yet for this working copy.
                      </p>
                    ) : (
                      recordingSession.present.checkpoints.map((checkpoint) => (
                        <button
                          key={checkpoint.id}
                          type="button"
                          className={`step-review-card replay-checkpoint-card replay-checkpoint-card-${describeCheckpointVisualState(checkpoint)}${
                            replayPlan?.checkpointId === checkpoint.id
                              ? ' step-review-card-selected'
                              : ''
                          }`}
                          onClick={() => previewReplayFromCheckpoint(checkpoint.id)}
                        >
                          <div className="step-review-header">
                            <span className="step-index">{checkpoint.kind}</span>
                            <div className="step-review-meta">
                              <span
                                className={`status-pill status-${
                                  checkpoint.status === 'valid' ? 'running' : 'error'
                                }`}
                              >
                                {checkpoint.status}
                              </span>
                              <span
                                className={`review-tag ${
                                  checkpoint.snapshot
                                    ? 'review-tag-checkpoint-ready'
                                    : 'review-tag-warning'
                                }`}
                              >
                                {checkpoint.snapshot ? 'snapshot ready' : 'metadata only'}
                              </span>
                            </div>
                          </div>
                          <p className="step-title">{checkpoint.label}</p>
                          <p className="step-summary">Bound to {checkpoint.stepId}</p>
                          <div className="step-review-signal-row">
                            <span
                              className={`step-signal-bar replay-signal-bar-${describeCheckpointVisualState(checkpoint)}`}
                            />
                            <span className="step-signal-copy">
                              {describeCheckpointResumeSummary(checkpoint)}
                            </span>
                          </div>
                          <div className="step-review-tags">
                            <span className="review-tag review-tag-dependency">
                              covers {checkpoint.dependencyStepIds.length} step(s)
                            </span>
                            {countCheckpointCaptureSurfaces(checkpoint.captures) > 0 ? (
                              <span className="review-tag">
                                captures {countCheckpointCaptureSurfaces(checkpoint.captures)}
                              </span>
                            ) : null}
                          </div>
                          {checkpoint.invalidationReasons.length > 0 ? (
                            <p className="step-summary">
                              {checkpoint.invalidationReasons.join(' ')}
                            </p>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="step-editor-shell">
                <p className="section-label">Replay plan</p>
                {replayPlan ? (
                  <div className="replay-plan-layout">
                    <div className="replay-plan-overview">
                      <div className="replay-plan-hero">
                        <div>
                          <p className="section-label">Execution summary</p>
                          <h3 className="step-editor-title replay-plan-title">
                            {describeReplayHeadline(replayPlan)}
                          </h3>
                        </div>
                        <span
                          className={`status-pill status-${
                            replayPlan.startStrategy === 'checkpoint'
                              ? 'running'
                              : 'launching'
                          }`}
                        >
                          {replayPlan.startStrategy}
                        </span>
                      </div>
                      <p className="panel-copy">{replayPlan.checkpointReason}</p>
                      <div className="replay-plan-pill-row">
                        <span className="review-tag">{replayPlan.mode}</span>
                        <span className="review-tag">
                          {replayPlan.executionStepIds.length} step(s) queued
                        </span>
                        <span
                          className={`review-tag ${
                            replayPlan.checkpointStatus === 'valid'
                              ? 'review-tag-checkpoint-ready'
                              : replayPlan.checkpointStatus === 'stale'
                                ? 'review-tag-warning'
                                : ''
                          }`}
                        >
                          checkpoint {replayPlan.checkpointStatus}
                        </span>
                      </div>
                    </div>

                    <div className="replay-plan-grid">
                      <p className="status-row">
                        <span className="status-label">Mode</span>
                        <span className="status-value">{replayPlan.mode}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Start strategy</span>
                        <span className="status-value">{replayPlan.startStrategy}</span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Checkpoint</span>
                        <span className="status-value">
                          {replayPlan.checkpointId ?? 'No checkpoint selected'}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Target step</span>
                        <span className="status-value">
                          {replayPlan.targetStepId ?? 'Full flow'}
                        </span>
                      </p>
                      <p className="status-row">
                        <span className="status-label">Checkpoint status</span>
                        <span className="status-value">{replayPlan.checkpointStatus}</span>
                      </p>
                    </div>

                    <div className="replay-plan-execution-card">
                      <p className="section-label">Execution scope</p>
                      {replayPlan.executionStepIds.length === 0 ? (
                        <p className="empty-state">
                          No step execution is required from the selected replay entry point.
                        </p>
                      ) : (
                        <div className="replay-step-list">
                          {replayPlan.executionStepIds.map((stepId, index) => (
                            <div className="replay-step-chip" key={stepId}>
                              <span className="step-index">Run {index + 1}</span>
                              <span className="status-value">{stepId}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">
                    Choose a replay mode or checkpoint to preview the recovery path.
                  </p>
                )}
              </div>
            </div>
          </article>

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Simulation activity</p>
                <p className="panel-copy">
                  Applied simulation rules are surfaced in the unified timeline so you
                  can see which rule actually won during replay.
                </p>
              </div>
            </div>
            <div className="checkpoint-list" data-testid="simulation-activity-panel">
              {appliedSimulationTimeline.length === 0 ? (
                <p className="empty-state">
                  No simulation rules have been applied in the current evidence set.
                </p>
              ) : (
                appliedSimulationTimeline.map((entry) =>
                  entry.kind === 'simulation-rule' ? (
                    <div className="step-review-card" key={entry.id}>
                      <div className="step-review-header">
                        <span className="step-index">simulation-rule</span>
                        <span className="status-value">{entry.ruleId}</span>
                      </div>
                      <p className="step-summary">{entry.summary}</p>
                      <p className="inspection-reason">{formatTimestamp(entry.timestamp)}</p>
                    </div>
                  ) : null,
                )
              )}
            </div>
          </article>

          <article className="panel browser-pane-panel">
            <p className="section-label">Embedded browser pane</p>
            <div className="browser-pane-note">
              <p className="embedded-pane-text">
                The browser stage is reserved on the right side of the workspace.
                Launching a session attaches Playwright over CDP to that embedded
                Chromium surface without covering the left-hand controls.
              </p>
            </div>
          </article>

          <article className="panel full-width-panel">
            <p className="section-label">Runtime event stream</p>
            <p className="panel-copy">
              Low-level runtime and CDP diagnostics remain available here for transport-level
              debugging. The primary workflow-oriented timeline is shown above.
            </p>
            <div className="event-stream">
              {runtimeEvents.length === 0 ? (
                <p className="empty-state">
                  No runtime events captured yet. Launch a session to inspect
                  lifecycle, browser, console, and network activity.
                </p>
              ) : (
                runtimeEvents.map((event) => (
                  <div className="event-row" key={event.id}>
                    <div className="event-meta">
                      <span className={`event-badge event-${event.level}`}>
                        {event.level}
                      </span>
                      <span className="event-category">{event.category}</span>
                      <span className="event-source">{event.source}</span>
                      <span className="event-code">{event.code}</span>
                      <span className="event-time">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <p className="event-message">{event.message}</p>
                    {event.detail ? <p className="event-detail">{event.detail}</p> : null}
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="panel full-width-panel">
            <p className="section-label">Architecture lanes</p>
            <ul className="lane-list">
              <li className="lane-item">
                `apps/desktop` owns the Electron shell, renderer, and process
                boundary.
              </li>
              <li className="lane-item">
                `packages/domain` holds product language and invariant-friendly
                shared contracts.
              </li>
              <li className="lane-item">
                `packages/runtime-browser` owns the Playwright-over-CDP session
                lifecycle and emits the runtime event feed consumed in the Electron
                main process.
              </li>
              <li className="lane-item">
                `packages/ui-state` now carries both the runtime shell state and the
                editable recording review session consumed by the renderer.
              </li>
            </ul>
          </article>
        </section>

        <aside className="browser-stage" aria-hidden="true">
          <div className="browser-stage-shell">
            <div className="browser-stage-header">
              <span className="embedded-pane-dot" />
              <span className="embedded-pane-dot" />
              <span className="embedded-pane-dot" />
            </div>
            <div className="browser-stage-copy">
              <p className="section-label">Reserved browser stage</p>
              <p className="embedded-pane-text">
                The live BrowserView is mounted into this column by the Electron main
                process and stays aligned with the shell as the window resizes.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

type TimelineKindFilter =
  | 'flow'
  | 'request'
  | 'assertion'
  | 'issue'
  | 'checkpoint'
  | 'simulation';

type AppTimelineEntry = TimelineEvent;

const RESPONSE_BODY_LIMIT_OPTIONS = [
  65_536,
  DEFAULT_RESPONSE_BODY_CAPTURE_LIMIT_BYTES,
  524_288,
  1_048_576,
];

function formatByteLimit(value: number): string {
  return `${Math.round(value / 1024)} KB`;
}

function describeCapturePolicy(policy: ProjectCapturePolicy): string {
  if (!policy.captureResponseBodies) {
    return 'Response body capture is disabled for this project.';
  }

  if (policy.responseBodyCaptureMode === 'full-with-warning') {
    return `Response bodies are captured for textual responses up to ${formatByteLimit(
      policy.responseBodySizeLimitBytes,
    )}, including endpoints that the safe default or your project-defined sensitive endpoint list would normally exclude.`;
  }

  return `Response bodies follow the safe default policy up to ${formatByteLimit(
    policy.responseBodySizeLimitBytes,
  )}, excluding built-in and project-defined sensitive endpoints.`;
}

function matchesTimelineFilter(
  entry: AppTimelineEntry,
  filter: TimelineKindFilter,
): boolean {
  switch (filter) {
    case 'flow':
      return entry.kind === 'user-action' || entry.kind === 'navigation' || entry.kind === 'retry';
    case 'request':
      return entry.kind === 'request';
    case 'assertion':
      return entry.kind === 'assertion';
    case 'issue':
      return entry.kind === 'console' || entry.kind === 'exception' || entry.kind === 'timeout';
    case 'checkpoint':
      return entry.kind === 'checkpoint';
    case 'simulation':
      return entry.kind === 'simulation-rule';
  }
}

function describeTimelineEntryBadge(entry: AppTimelineEntry): string {
  switch (entry.kind) {
    case 'assertion':
      return entry.outcome;
    case 'console':
    case 'exception':
      return entry.severity;
    case 'checkpoint':
      return entry.status;
    case 'simulation-rule':
      return 'applied';
    case 'request':
      return 'captured';
    case 'timeout':
      return 'timeout';
    case 'navigation':
      return 'navigation';
    case 'user-action':
      return 'action';
    case 'retry':
      return 'retry';
    case 'screenshot':
      return 'screenshot';
  }
}

function timelineEntryStatusClassName(entry: AppTimelineEntry): string {
  switch (entry.kind) {
    case 'assertion':
      return entry.outcome === 'passed' ? 'status-running' : 'status-error';
    case 'console':
    case 'exception':
    case 'timeout':
      return 'status-error';
    case 'checkpoint':
      return entry.status === 'created' || entry.status === 'reused'
        ? 'status-running'
        : 'status-launching';
    default:
      return 'status-idle';
  }
}

function describeRecordedStep(step: RecordedStep): string {
  if (step.kind === 'assertion') {
    switch (step.assertion.kind) {
      case 'element-visible':
      case 'element-hidden':
      case 'element-enabled':
        return `${step.assertion.kind} on ${step.assertion.selector}`;
      case 'element-contains-text':
        return `expect ${step.assertion.selector} to contain "${step.assertion.expectedText}"`;
      case 'url-matches':
        return `expect URL ${step.assertion.matchMode} ${step.assertion.expectedUrl}`;
      default:
        return step.assertion.kind;
    }
  }

  switch (step.action.type) {
    case 'navigate':
      return step.action.url;
    case 'fill':
      return `${step.action.selector} = ${
        step.action.sensitive ? '[REDACTED]' : step.action.value
      }`;
    case 'select-option':
      return `${step.action.selector} select "${step.action.value}"`;
    case 'set-checked':
      return `${step.action.selector} ${step.action.checked ? 'checked' : 'unchecked'}`;
    case 'press-key':
      return `${step.action.selector ?? 'page'} press ${[
        ...step.action.modifiers,
        step.action.key,
      ].join('+')}`;
    case 'drag-and-drop':
      return `drag ${step.action.sourceSelector} -> ${step.action.targetSelector}`;
    case 'upload-file':
      return `${step.action.selector} upload ${step.action.fileName}`;
    case 'dialog':
      return `${step.action.action} ${step.action.dialogType} dialog`;
    case 'wait-for-download':
      return 'Wait for download';
    case 'wait-for-popup':
      return 'Wait for popup';
    case 'click':
    case 'double-click':
      return `${step.action.type} ${step.action.selector}`;
    case 'reload':
      return 'Reload the current page';
  }
}

function formatRequestLabel(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.pathname || '/'}${parsedUrl.search}`;
  } catch {
    return url;
  }
}

function describeEvidenceState(
  state: RecordedStep['evidenceState'],
): string {
  switch (state) {
    case 'current':
      return 'Evidence is current for this step.';
    case 'stale':
      return 'Evidence is stale and should be replayed.';
    case 'pending-regeneration':
      return 'Replay is expected to refresh this evidence.';
  }
}

function describeCheckpointVisualState(
  checkpoint: {
    status: 'valid' | 'stale';
    snapshot?: BrowserContextSnapshot;
  },
): 'ready' | 'metadata' | 'stale' {
  if (checkpoint.status !== 'valid') {
    return 'stale';
  }

  return checkpoint.snapshot ? 'ready' : 'metadata';
}

function describeCheckpointResumeSummary(
  checkpoint: {
    status: 'valid' | 'stale';
    snapshot?: BrowserContextSnapshot;
  },
): string {
  const visualState = describeCheckpointVisualState(checkpoint);

  switch (visualState) {
    case 'ready':
      return 'Replay can resume directly from this checkpoint.';
    case 'metadata':
      return 'Checkpoint is known, but replay must restart because no snapshot is stored.';
    case 'stale':
      return 'Checkpoint is stale and should not be trusted for resume.';
  }
}

function describeReplayHeadline(replayPlan: {
  mode: string;
  startStrategy: 'start' | 'checkpoint';
  executionStepIds: string[];
}): string {
  if (replayPlan.executionStepIds.length === 0) {
    return replayPlan.startStrategy === 'checkpoint'
      ? 'Resume without additional steps'
      : 'Fresh browser context only';
  }

  return replayPlan.startStrategy === 'checkpoint'
    ? `Resume and run ${replayPlan.executionStepIds.length} step(s)`
    : `Restart and run ${replayPlan.executionStepIds.length} step(s)`;
}

function countCheckpointCaptureSurfaces(captures: {
  cookies: boolean;
  localStorage: boolean;
  sessionStorage: boolean;
}): number {
  return Object.values(captures).filter(Boolean).length;
}

function describeRuleTargetPlaceholder(kind: RedactionRule['kind']): string {
  switch (kind) {
    case 'json-path':
      return '$.token';
    case 'form-field':
      return 'accountNumber';
    case 'query-param':
      return 'sessionId';
    case 'header':
      return 'X-Customer-Token';
    case 'cookie':
      return 'session';
    case 'regex':
      return 'acct-[0-9]{4,}';
    default:
      return 'Redaction target';
  }
}

function describeCaptureOutcome(capture: RequestResponseCapture): string {
  if (capture.failure) {
    return 'failed';
  }

  if (capture.response) {
    return String(capture.response.status);
  }

  return 'pending';
}

function getCaptureStatusClassName(capture: RequestResponseCapture): string {
  if (capture.failure) {
    return 'status-error';
  }

  if (capture.response && capture.response.status >= 400) {
    return 'status-launching';
  }

  if (capture.response) {
    return 'status-running';
  }

  return 'status-idle';
}

function describeCaptureOrigin(capture: RequestResponseCapture): string {
  if (capture.origin.fromCache) {
    return 'Cache';
  }

  if (capture.origin.fromServiceWorker) {
    return 'Service worker';
  }

  return 'Network';
}

function formatDuration(durationMs: number | undefined): string {
  return typeof durationMs === 'number' ? `${durationMs} ms` : 'Unavailable';
}

function describeBodyState(body: CaptureBody | undefined): string {
  if (!body) {
    return 'Unavailable';
  }

  switch (body.state) {
    case 'full':
      return 'Captured in full';
    case 'redacted':
      return `Captured with redaction (${body.redactionRuleIds.join(', ')})`;
    case 'excluded':
      return 'Capture excluded by policy';
    case 'truncated':
      return 'Capture truncated by policy';
    case 'unavailable':
      return 'Capture unavailable';
  }
}

function renderTimingRow(label: string, value: number | undefined) {
  return (
    <p className="status-row" key={label}>
      <span className="status-label">{label}</span>
      <span className="status-value">{typeof value === 'number' ? `${value} ms` : 'n/a'}</span>
    </p>
  );
}

function buildSimulationRuleDraft(input: {
  actionKind: SimulationRule['action']['kind'];
  appliesTo: SimulationRule['appliesTo'];
  domain: string;
  enabled: boolean;
  fixturePath: string;
  flowContext: string;
  id: string;
  latencyValue: string;
  method: string;
  routePattern: string;
  statusValue: string;
  title: string;
}): SimulationRule {
  const match = {
    ...(input.routePattern.trim().length > 0 ? { routePattern: input.routePattern.trim() } : {}),
    ...(input.domain.trim().length > 0 ? { domain: input.domain.trim() } : {}),
    ...(input.method.trim().length > 0 ? { method: input.method.trim().toUpperCase() } : {}),
    ...(input.flowContext.trim().length > 0 ? { flowContext: input.flowContext.trim() } : {}),
  };
  const base = {
    schemaVersion: domainVersions.domainSchemaVersion,
    id: input.id,
    enabled: input.enabled,
    title: input.title.trim().length > 0 ? input.title.trim() : 'Untitled simulation rule',
    appliesTo: input.appliesTo,
    match,
  };

  switch (input.actionKind) {
    case 'fixed-latency':
    case 'latency-jitter':
      return {
        ...base,
        action: {
          kind: input.actionKind,
          valueMsOrKbps: Number.parseInt(input.latencyValue, 10) || 0,
        },
      };
    case 'offline':
      return {
        ...base,
        action: {
          kind: 'offline',
        },
      };
    case 'route-block':
      return {
        ...base,
        action: {
          kind: 'route-block',
        },
      };
    case 'forced-status':
      return {
        ...base,
        action: {
          kind: 'forced-status',
          status: Number.parseInt(input.statusValue, 10) || 503,
        },
      };
    case 'delayed-response':
      return {
        ...base,
        action: {
          kind: 'delayed-response',
          delayMs: Number.parseInt(input.latencyValue, 10) || 0,
          status: Number.parseInt(input.statusValue, 10) || 200,
          ...(input.fixturePath.trim().length > 0
            ? { fixturePath: input.fixturePath.trim() }
            : {}),
        },
      };
    case 'response-fixture':
      return {
        ...base,
        action: {
          kind: 'response-fixture',
          fixturePath: input.fixturePath.trim(),
          status: Number.parseInt(input.statusValue, 10) || 200,
        },
      };
    default:
      return {
        ...base,
        action: {
          kind: 'route-block',
        },
      };
  }
}

function describeSimulationRule(rule: SimulationRule): string {
  const targets = [
    rule.match.routePattern ? `route ${rule.match.routePattern}` : null,
    rule.match.domain ? `domain ${rule.match.domain}` : null,
    rule.match.method ? `method ${rule.match.method}` : null,
    rule.match.flowContext ? `flow ${rule.match.flowContext}` : null,
  ].filter((value): value is string => value !== null);

  return `${rule.action.kind} on ${targets.join(', ') || 'all requests during replay'}`;
}

function RequestBodySection(props: {
  title: string;
  headers: Record<string, string> | null;
  body: CaptureBody | undefined;
  status?: number;
  failure?: {
    code: string;
    message: string;
  };
  sensitiveEndpointPatterns: string[];
  targetUrl?: string;
  testId: string;
}) {
  const {
    title,
    headers,
    body,
    status,
    failure,
    sensitiveEndpointPatterns,
    targetUrl,
    testId,
  } = props;
  const headerEntries = headers ? Object.entries(headers) : [];
  const sensitiveEndpoint = isSensitiveEndpointUrl(targetUrl, sensitiveEndpointPatterns);

  return (
    <section className="network-detail-card" data-testid={testId}>
      <p className="section-label">{title}</p>
      {typeof status === 'number' ? (
        <p className="inspection-reason">Status: {status}</p>
      ) : null}
      {failure ? (
        <p className="inspection-reason">
          Failure: {failure.code} · {failure.message}
        </p>
      ) : null}
      <div className="runtime-status">
        <p className="status-row">
          <span className="status-label">Body state</span>
          <span className="status-value">{describeBodyState(body)}</span>
        </p>
        {body?.contentType ? (
          <p className="status-row">
            <span className="status-label">Content type</span>
            <span className="status-value">{body.contentType}</span>
          </p>
        ) : null}
        <p className="status-row">
          <span className="status-label">Header count</span>
          <span className="status-value">{headerEntries.length}</span>
        </p>
      </div>
      <div className="network-header-list">
        {headerEntries.length === 0 ? (
          <p className="empty-state">No headers were captured for this payload.</p>
        ) : (
          headerEntries.map(([key, value]) => (
            <p className="inspection-reason" key={key}>
              {key}: {value}
            </p>
          ))
        )}
      </div>
      {body ? (
        <div className="network-body-state">
          {body.state === 'full' || body.state === 'redacted' ? (
            <>
              <p className="inspection-reason">
                {body.state === 'redacted'
                  ? 'This body was captured, then masked by explicit deterministic rules.'
                  : 'This body is visible under the current mandatory redaction baseline.'}
              </p>
              <pre className="network-body-text">{body.text}</pre>
            </>
          ) : (
            <>
              <p className="inspection-reason">
                {body.reason}
              </p>
              {sensitiveEndpoint ? (
                <p className="inspection-reason">
                  This request targets a sensitive authentication or session endpoint,
                  so response-body handling remains safety-constrained even when CDP
                  cannot return payload bytes.
                </p>
              ) : null}
              <p className="inspection-reason">
                The UI distinguishes policy exclusions, truncation, and runtime
                unavailability so missing body content is not mistaken for an empty payload.
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="empty-state">
          No body payload was captured for this side of the exchange.
        </p>
      )}
    </section>
  );
}

function createToolbarActionStep(
  type: SupportedActionType,
  selectedStep: RecordedStep | null,
  inspection: InspectionMetadata | null,
): Extract<RecordedStep, { kind: 'action' }> {
  const timestamp = new Date().toISOString();
  const locator = derivePreferredLocator(selectedStep, inspection);
  const action = convertActionKind(
    {
      type: 'click',
      selector: locator,
    },
    type,
    locator,
  );

  return {
    schemaVersion: domainVersions.domainSchemaVersion,
    id: `step-action-${type}-${timestamp}`,
    title: describeActionTitle(type),
    kind: 'action',
    status: 'active',
    evidenceState: 'current',
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencyStepIds: [],
    invalidatesEvidenceAfter: true,
    action,
  };
}

function derivePreferredLocator(
  selectedStep: RecordedStep | null,
  inspection: InspectionMetadata | null,
): string {
  return (
    inspection?.recommendations.primary.locator ??
    getActionSelectableLocator(selectedStep) ??
    'page.getByRole("button", { name: "Continue" })'
  );
}

function getActionSelectableLocator(step: RecordedStep | null): string | null {
  if (!step) {
    return null;
  }

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
      case 'drag-and-drop':
        return step.action.targetSelector || step.action.sourceSelector;
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

function describeActionTitle(type: SupportedActionType): string {
  switch (type) {
    case 'navigate':
      return 'Navigate to page';
    case 'click':
      return 'Click element';
    case 'double-click':
      return 'Double click element';
    case 'fill':
      return 'Fill field';
    case 'select-option':
      return 'Select option';
    case 'set-checked':
      return 'Set checkbox or radio';
    case 'press-key':
      return 'Press key';
    case 'drag-and-drop':
      return 'Drag and drop';
    case 'upload-file':
      return 'Upload file';
    case 'dialog':
      return 'Handle dialog';
    case 'wait-for-download':
      return 'Wait for download';
    case 'wait-for-popup':
      return 'Wait for popup';
    case 'reload':
      return 'Reload current page';
  }
}

function convertActionKind(
  action: Extract<RecordedStep, { kind: 'action' }>['action'],
  nextKind: SupportedActionType,
  inspectedLocator: string | null,
): Extract<RecordedStep, { kind: 'action' }>['action'] {
  if (action.type === nextKind) {
    return action;
  }

  const resolvedSelector = (() => {
    if ('selector' in action && typeof action.selector === 'string') {
      return action.selector;
    }

    if (action.type === 'drag-and-drop') {
      return (
        action.targetSelector ||
        action.sourceSelector ||
        inspectedLocator ||
        'page.getByRole("button", { name: "Continue" })'
      );
    }

    if (action.type === 'press-key') {
      return (
        action.selector ??
        inspectedLocator ??
        'page.getByRole("button", { name: "Continue" })'
      );
    }

    return inspectedLocator ?? 'page.getByRole("button", { name: "Continue" })';
  })();

  switch (nextKind) {
    case 'navigate':
      return {
        type: 'navigate',
        url: 'https://example.test/dashboard',
      };
    case 'click':
    case 'double-click':
      return {
        type: nextKind,
        selector: resolvedSelector,
      };
    case 'fill':
      return {
        type: 'fill',
        selector: resolvedSelector,
        value: '',
        sensitive: false,
      };
    case 'select-option':
      return {
        type: 'select-option',
        selector: resolvedSelector,
        value: 'option-1',
      };
    case 'set-checked':
      return {
        type: 'set-checked',
        selector: resolvedSelector,
        checked: true,
      };
    case 'press-key':
      return {
        type: 'press-key',
        selector: resolvedSelector,
        key: 'Enter',
        modifiers: [],
      };
    case 'drag-and-drop':
      return {
        type: 'drag-and-drop',
        sourceSelector: resolvedSelector,
        targetSelector: resolvedSelector,
      };
    case 'upload-file':
      return {
        type: 'upload-file',
        selector: resolvedSelector,
        fileName: 'fixtures/upload.txt',
      };
    case 'dialog':
      return {
        type: 'dialog',
        dialogType: 'alert',
        action: 'accept',
      };
    case 'wait-for-download':
    case 'wait-for-popup':
    case 'reload':
      return {
        type: nextKind,
      };
  }
}

type SupportedActionType =
  | 'navigate'
  | 'click'
  | 'double-click'
  | 'fill'
  | 'select-option'
  | 'set-checked'
  | 'press-key'
  | 'drag-and-drop'
  | 'upload-file'
  | 'dialog'
  | 'wait-for-download'
  | 'wait-for-popup'
  | 'reload';

const SUPPORTED_ACTION_OPTIONS: Array<{
  value: SupportedActionType;
  label: string;
}> = [
  { value: 'navigate', label: 'Navigate' },
  { value: 'click', label: 'Click' },
  { value: 'double-click', label: 'Double click' },
  { value: 'fill', label: 'Fill text' },
  { value: 'select-option', label: 'Select option' },
  { value: 'set-checked', label: 'Set checked' },
  { value: 'press-key', label: 'Press key' },
  { value: 'drag-and-drop', label: 'Drag and drop' },
  { value: 'upload-file', label: 'Upload file' },
  { value: 'dialog', label: 'Dialog' },
  { value: 'wait-for-download', label: 'Wait for download' },
  { value: 'wait-for-popup', label: 'Wait for popup' },
  { value: 'reload', label: 'Reload' },
];


function ActionEditor(props: {
  inspectedLocator: string | null;
  step: Extract<RecordedStep, { kind: 'action' }>;
  onChange: (step: Extract<RecordedStep, { kind: 'action' }>) => void;
}) {
  const { inspectedLocator, step, onChange } = props;
  const updateAction = (
    nextAction: Extract<RecordedStep, { kind: 'action' }>['action'],
  ): void => {
    onChange({
      ...step,
      updatedAt: new Date().toISOString(),
      action: nextAction,
    });
  };

  return (
    <>
      <label className="field-label" htmlFor="action-kind">
        Action type
      </label>
      <select
        id="action-kind"
        className="field-input"
        value={step.action.type}
        onChange={(event) =>
          updateAction(
            convertActionKind(
              step.action,
              event.target.value as SupportedActionType,
              inspectedLocator,
            ),
          )
        }
      >
        {SUPPORTED_ACTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {renderActionFields(step.action, inspectedLocator, updateAction)}
    </>
  );
}

function renderActionFields(
  action: Extract<RecordedStep, { kind: 'action' }>['action'],
  inspectedLocator: string | null,
  updateAction: (
    nextAction: Extract<RecordedStep, { kind: 'action' }>['action'],
  ) => void,
) {
  switch (action.type) {
    case 'navigate': {
      return (
        <>
          <label className="field-label" htmlFor="step-url">
            Target URL
          </label>
          <input
            id="step-url"
            className="url-input"
            value={action.url}
            onChange={(event) =>
              updateAction({
                type: 'navigate',
                url: event.target.value,
              })
            }
          />
        </>
      );
    }
    case 'fill': {
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector}
            onChange={(event) =>
              updateAction({
                type: 'fill',
                selector: event.target.value,
                value: action.value,
                sensitive: action.sensitive,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'fill',
                    selector: inspectedLocator,
                    value: action.value,
                    sensitive: action.sensitive,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
          <label className="field-label" htmlFor="step-value">
            Text value
          </label>
          <input
            id="step-value"
            className="url-input"
            value={action.value}
            onChange={(event) =>
              updateAction({
                type: 'fill',
                selector: action.selector,
                value: event.target.value,
                sensitive: action.sensitive,
              })
            }
          />
          <label className="checkbox-field" htmlFor="step-sensitive">
            <input
              id="step-sensitive"
              type="checkbox"
              checked={action.sensitive}
              onChange={(event) =>
                updateAction({
                  type: 'fill',
                  selector: action.selector,
                  value: action.value,
                  sensitive: event.target.checked,
                })
              }
            />
            <span>Mask this value in the review lane</span>
          </label>
        </>
      );
    }
    case 'click':
    case 'double-click': {
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector}
            onChange={(event) =>
              updateAction({
                type: action.type,
                selector: event.target.value,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: action.type,
                    selector: inspectedLocator,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
        </>
      );
    }
    case 'select-option':
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector}
            onChange={(event) =>
              updateAction({
                type: 'select-option',
                selector: event.target.value,
                value: action.value,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'select-option',
                    selector: inspectedLocator,
                    value: action.value,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
          <label className="field-label" htmlFor="step-option-value">
            Option value
          </label>
          <input
            id="step-option-value"
            className="url-input"
            value={action.value}
            onChange={(event) =>
              updateAction({
                type: 'select-option',
                selector: action.selector,
                value: event.target.value,
              })
            }
          />
        </>
      );
    case 'set-checked':
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector}
            onChange={(event) =>
              updateAction({
                type: 'set-checked',
                selector: event.target.value,
                checked: action.checked,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'set-checked',
                    selector: inspectedLocator,
                    checked: action.checked,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
          <label className="checkbox-field" htmlFor="step-checked">
            <input
              id="step-checked"
              type="checkbox"
              checked={action.checked}
              onChange={(event) =>
                updateAction({
                  type: 'set-checked',
                  selector: action.selector,
                  checked: event.target.checked,
                })
              }
            />
            <span>Checked</span>
          </label>
        </>
      );
    case 'press-key':
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector (optional)
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector ?? ''}
            onChange={(event) =>
              updateAction({
                type: 'press-key',
                selector: event.target.value.trim().length > 0 ? event.target.value : undefined,
                key: action.key,
                modifiers: action.modifiers,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'press-key',
                    selector: inspectedLocator,
                    key: action.key,
                    modifiers: action.modifiers,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
          <label className="field-label" htmlFor="step-key">
            Key
          </label>
          <input
            id="step-key"
            className="url-input"
            value={action.key}
            onChange={(event) =>
              updateAction({
                type: 'press-key',
                selector: action.selector,
                key: event.target.value,
                modifiers: action.modifiers,
              })
            }
          />
          <label className="field-label" htmlFor="step-modifiers">
            Modifiers (comma-separated)
          </label>
          <input
            id="step-modifiers"
            className="url-input"
            value={action.modifiers.join(', ')}
            onChange={(event) =>
              updateAction({
                type: 'press-key',
                selector: action.selector,
                key: action.key,
                modifiers: event.target.value
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0),
              })
            }
          />
        </>
      );
    case 'drag-and-drop':
      return (
        <>
          <label className="field-label" htmlFor="step-source-selector">
            Source selector
          </label>
          <input
            id="step-source-selector"
            className="url-input"
            value={action.sourceSelector}
            onChange={(event) =>
              updateAction({
                type: 'drag-and-drop',
                sourceSelector: event.target.value,
                targetSelector: action.targetSelector,
              })
            }
          />
          <label className="field-label" htmlFor="step-target-selector">
            Target selector
          </label>
          <input
            id="step-target-selector"
            className="url-input"
            value={action.targetSelector}
            onChange={(event) =>
              updateAction({
                type: 'drag-and-drop',
                sourceSelector: action.sourceSelector,
                targetSelector: event.target.value,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'drag-and-drop',
                    sourceSelector: inspectedLocator,
                    targetSelector: action.targetSelector,
                  })
                }
              >
                Use inspected as source
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'drag-and-drop',
                    sourceSelector: action.sourceSelector,
                    targetSelector: inspectedLocator,
                  })
                }
              >
                Use inspected as target
              </button>
            </div>
          ) : null}
        </>
      );
    case 'upload-file':
      return (
        <>
          <label className="field-label" htmlFor="step-selector">
            Selector
          </label>
          <input
            id="step-selector"
            className="url-input"
            value={action.selector}
            onChange={(event) =>
              updateAction({
                type: 'upload-file',
                selector: event.target.value,
                fileName: action.fileName,
              })
            }
          />
          {inspectedLocator ? (
            <div className="button-row">
              <button
                className="button button-secondary"
                type="button"
                onClick={() =>
                  updateAction({
                    type: 'upload-file',
                    selector: inspectedLocator,
                    fileName: action.fileName,
                  })
                }
              >
                Use inspected locator
              </button>
            </div>
          ) : null}
          <label className="field-label" htmlFor="step-file-name">
            File path
          </label>
          <input
            id="step-file-name"
            className="url-input"
            value={action.fileName}
            onChange={(event) =>
              updateAction({
                type: 'upload-file',
                selector: action.selector,
                fileName: event.target.value,
              })
            }
          />
        </>
      );
    case 'dialog':
      return (
        <>
          <label className="field-label" htmlFor="step-dialog-type">
            Dialog type
          </label>
          <select
            id="step-dialog-type"
            className="field-input"
            value={action.dialogType}
            onChange={(event) =>
              updateAction({
                type: 'dialog',
                dialogType: event.target.value as
                  | 'alert'
                  | 'confirm'
                  | 'prompt'
                  | 'beforeunload',
                action: action.action,
                promptText: action.promptText,
              })
            }
          >
            <option value="alert">Alert</option>
            <option value="confirm">Confirm</option>
            <option value="prompt">Prompt</option>
            <option value="beforeunload">Before unload</option>
          </select>
          <label className="field-label" htmlFor="step-dialog-action">
            Dialog action
          </label>
          <select
            id="step-dialog-action"
            className="field-input"
            value={action.action}
            onChange={(event) =>
              updateAction({
                type: 'dialog',
                dialogType: action.dialogType,
                action: event.target.value as 'accept' | 'dismiss',
                promptText: action.promptText,
              })
            }
          >
            <option value="accept">Accept</option>
            <option value="dismiss">Dismiss</option>
          </select>
          <label className="field-label" htmlFor="step-dialog-prompt">
            Prompt text (optional)
          </label>
          <input
            id="step-dialog-prompt"
            className="url-input"
            value={action.promptText ?? ''}
            onChange={(event) =>
              updateAction({
                type: 'dialog',
                dialogType: action.dialogType,
                action: action.action,
                promptText: event.target.value.trim().length > 0 ? event.target.value : undefined,
              })
            }
          />
        </>
      );
    case 'wait-for-download':
    case 'wait-for-popup':
    case 'reload':
      return (
        <p className="empty-state">
          This action type has no additional parameters.
        </p>
      );
    default:
      return (
        <p className="empty-state">
          This action type has no editable parameters in the current Phase 4 slice.
        </p>
      );
  }
}

type SupportedAssertionKind =
  | 'element-visible'
  | 'element-hidden'
  | 'element-enabled'
  | 'element-contains-text'
  | 'url-matches';

const SUPPORTED_ASSERTION_OPTIONS: Array<{
  value: SupportedAssertionKind;
  label: string;
}> = [
  { value: 'element-visible', label: 'Element visible' },
  { value: 'element-hidden', label: 'Element hidden' },
  { value: 'element-enabled', label: 'Element enabled' },
  { value: 'element-contains-text', label: 'Element contains text' },
  { value: 'url-matches', label: 'URL matches' },
];

function convertAssertionKind(
  assertion: Extract<RecordedStep, { kind: 'assertion' }>['assertion'],
  nextKind: SupportedAssertionKind,
  inspectedLocator: string | null,
  inspectedText: string | null,
): Extract<RecordedStep, { kind: 'assertion' }>['assertion'] {
  if (assertion.kind === nextKind) {
    return assertion;
  }

  const selector =
    'selector' in assertion
      ? assertion.selector
      : inspectedLocator ?? 'page.getByRole("heading", { name: "Dashboard" })';

  switch (nextKind) {
    case 'element-visible':
    case 'element-hidden':
    case 'element-enabled':
      return {
        schemaVersion: assertion.schemaVersion,
        kind: nextKind,
        selector,
      };
    case 'element-contains-text':
      return {
        schemaVersion: assertion.schemaVersion,
        kind: 'element-contains-text',
        selector,
        expectedText:
          assertion.kind === 'element-contains-text'
            ? assertion.expectedText
            : inspectedText ?? 'Expected text',
      };
    case 'url-matches':
      return {
        schemaVersion: assertion.schemaVersion,
        kind: 'url-matches',
        expectedUrl:
          assertion.kind === 'url-matches'
            ? assertion.expectedUrl
            : 'https://example.test/dashboard',
        matchMode: assertion.kind === 'url-matches' ? assertion.matchMode : 'exact',
      };
  }
}

function createInspectionAssertionStep(
  inspection: InspectionMetadata,
  kind: SupportedAssertionKind,
): Extract<RecordedStep, { kind: 'assertion' }> {
  const timestamp = new Date().toISOString();
  const locator = inspection.recommendations.primary.locator;
  const visibleText =
    inspection.target.textContent ?? inspection.target.accessibleName ?? 'Expected text';

  return {
    schemaVersion: domainVersions.domainSchemaVersion,
    id: `step-inspection-${kind}-${timestamp}`,
    title: describeInspectionAssertionTitle(kind, inspection),
    kind: 'assertion',
    status: 'active',
    evidenceState: 'current',
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencyStepIds: [],
    invalidatesEvidenceAfter: true,
    assertion: convertAssertionKind(
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        kind: 'element-visible',
        selector: locator,
      },
      kind,
      locator,
      visibleText,
    ),
  };
}

function createInspectionClickStep(
  inspection: InspectionMetadata,
): Extract<RecordedStep, { kind: 'action' }> {
  const timestamp = new Date().toISOString();
  const targetName =
    inspection.target.accessibleName ??
    inspection.target.labelText ??
    inspection.target.textContent ??
    inspection.target.tagName.toLowerCase();

  return {
    schemaVersion: domainVersions.domainSchemaVersion,
    id: `step-inspection-click-${timestamp}`,
    title: `Click ${targetName}`,
    kind: 'action',
    status: 'active',
    evidenceState: 'current',
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencyStepIds: [],
    invalidatesEvidenceAfter: true,
    action: {
      type: 'click',
      selector: inspection.recommendations.primary.locator,
    },
  };
}

function describeInspectionAssertionTitle(
  kind: SupportedAssertionKind,
  inspection: InspectionMetadata,
): string {
  const targetName =
    inspection.target.accessibleName ??
    inspection.target.labelText ??
    inspection.target.textContent ??
    inspection.target.tagName.toLowerCase();

  switch (kind) {
    case 'element-visible':
      return `Assert ${targetName} visible`;
    case 'element-hidden':
      return `Assert ${targetName} hidden`;
    case 'element-enabled':
      return `Assert ${targetName} enabled`;
    case 'element-contains-text':
      return `Assert ${targetName} text`;
    case 'url-matches':
      return 'Assert current URL';
  }
}

function AssertionEditor(props: {
  inspectedLocator: string | null;
  inspectedText: string | null;
  step: Extract<RecordedStep, { kind: 'assertion' }>;
  onChange: (step: Extract<RecordedStep, { kind: 'assertion' }>) => void;
}) {
  const { inspectedLocator, inspectedText, step, onChange } = props;
  const assertion = step.assertion;

  const updateAssertion = (
    nextAssertion: Extract<RecordedStep, { kind: 'assertion' }>['assertion'],
  ): void => {
    onChange({
      ...step,
      updatedAt: new Date().toISOString(),
      assertion: nextAssertion,
    });
  };

  const selectorAssertion =
    assertion.kind === 'element-visible' ||
    assertion.kind === 'element-hidden' ||
    assertion.kind === 'element-enabled' ||
    assertion.kind === 'element-contains-text'
      ? assertion
      : null;

  const canUseInspectedLocator = inspectedLocator !== null && selectorAssertion !== null;
  const canUseInspectedText =
    inspectedText !== null && assertion.kind === 'element-contains-text';

  return (
    <>
      <label className="field-label" htmlFor="assertion-kind">
        Assertion type
      </label>
      <select
        id="assertion-kind"
        className="field-input"
        value={assertion.kind}
        onChange={(event) =>
          updateAssertion(
            convertAssertionKind(
              assertion,
              event.target.value as SupportedAssertionKind,
              inspectedLocator,
              inspectedText,
            ),
          )
        }
      >
        {SUPPORTED_ASSERTION_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {canUseInspectedLocator ? (
        <div className="button-row">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              if (!selectorAssertion) {
                return;
              }

              updateAssertion({
                ...selectorAssertion,
                selector: inspectedLocator,
              });
            }}
          >
            Use inspected locator
          </button>
          {canUseInspectedText ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                if (assertion.kind !== 'element-contains-text' || inspectedText === null) {
                  return;
                }

                updateAssertion({
                  ...assertion,
                  expectedText: inspectedText,
                });
              }}
            >
              Use inspected text
            </button>
          ) : null}
        </div>
      ) : null}
      {renderAssertionFields(assertion, updateAssertion)}
    </>
  );
}

function renderAssertionFields(
  assertion: Extract<RecordedStep, { kind: 'assertion' }>['assertion'],
  updateAssertion: (
    nextAssertion: Extract<RecordedStep, { kind: 'assertion' }>['assertion'],
  ) => void,
) {
  switch (assertion.kind) {
    case 'element-visible':
    case 'element-hidden':
    case 'element-enabled': {
      return (
        <>
          <label className="field-label" htmlFor="assertion-selector">
            Selector
          </label>
          <input
            id="assertion-selector"
            className="url-input"
            value={assertion.selector}
            onChange={(event) =>
              updateAssertion({
                schemaVersion: assertion.schemaVersion,
                kind: assertion.kind,
                selector: event.target.value,
              })
            }
          />
        </>
      );
    }
    case 'element-contains-text': {
      return (
        <>
          <label className="field-label" htmlFor="assertion-selector">
            Selector
          </label>
          <input
            id="assertion-selector"
            className="url-input"
            value={assertion.selector}
            onChange={(event) =>
              updateAssertion({
                schemaVersion: assertion.schemaVersion,
                kind: 'element-contains-text',
                selector: event.target.value,
                expectedText: assertion.expectedText,
              })
            }
          />
          <label className="field-label" htmlFor="assertion-text">
            Expected text
          </label>
          <input
            id="assertion-text"
            className="url-input"
            value={assertion.expectedText}
            onChange={(event) =>
              updateAssertion({
                schemaVersion: assertion.schemaVersion,
                kind: 'element-contains-text',
                selector: assertion.selector,
                expectedText: event.target.value,
              })
            }
          />
        </>
      );
    }
    case 'url-matches': {
      return (
        <>
          <label className="field-label" htmlFor="assertion-url">
            Expected URL
          </label>
          <input
            id="assertion-url"
            className="url-input"
            value={assertion.expectedUrl}
            onChange={(event) =>
              updateAssertion({
                schemaVersion: assertion.schemaVersion,
                kind: 'url-matches',
                expectedUrl: event.target.value,
                matchMode: assertion.matchMode,
              })
            }
          />
          <label className="field-label" htmlFor="assertion-url-mode">
            Match mode
          </label>
          <select
            id="assertion-url-mode"
            className="field-input"
            value={assertion.matchMode}
            onChange={(event) =>
              updateAssertion({
                schemaVersion: assertion.schemaVersion,
                kind: 'url-matches',
                expectedUrl: assertion.expectedUrl,
                matchMode: event.target.value as 'exact' | 'glob' | 'regex',
              })
            }
          >
            <option value="exact">Exact</option>
            <option value="glob">Glob</option>
            <option value="regex">Regex</option>
          </select>
        </>
      );
    }
    default:
      return (
        <p className="empty-state">
          This assertion type has no editable parameters in the current Phase 4
          slice.
        </p>
      );
  }
}
