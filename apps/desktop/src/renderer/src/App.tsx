import { useEffect, useState } from 'react';
import {
  productSummary,
  type CaptureBody,
  type RecordedStep,
  type RedactionRule,
  type RequestResponseCapture,
} from '@browser-blackbox/domain';
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
  const captures = useWorkspaceStore((state) => state.captures);
  const redactionRules = useWorkspaceStore((state) => state.redactionRules);
  const timeline = useWorkspaceStore((state) => state.timeline);
  const diagnosis = useWorkspaceStore((state) => state.diagnosis);
  const recordingSession = useWorkspaceStore((state) => state.recordingSession);
  const replayPlan = useWorkspaceStore((state) => state.replayPlan);
  const setUrl = useWorkspaceStore((state) => state.setTargetUrl);
  const setBrowserRuntime = useWorkspaceStore((state) => state.setBrowserRuntime);
  const setRuntimeDiagnostics = useWorkspaceStore((state) => state.setRuntimeDiagnostics);
  const pushRuntimeUpdate = useWorkspaceStore((state) => state.pushRuntimeUpdate);
  const selectRecordedStep = useWorkspaceStore((state) => state.selectRecordedStep);
  const replaceRecordedStepInReview = useWorkspaceStore(
    (state) => state.replaceRecordedStepInReview,
  );
  const insertStepAfterSelection = useWorkspaceStore((state) => state.insertStepAfterSelection);
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
  const selectedStepIndex = selectedRecordedStep
    ? recordingSession.present.steps.findIndex((step) => step.id === selectedRecordedStep.id)
    : -1;

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
  }, [browserRuntime.sessionId, exportWorkingCopySnapshot, persistenceReady, recordingSession, url]);

  useEffect(() => {
    void window.desktopShell.setRedactionRules(redactionRules);
  }, [redactionRules]);

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
        redactionRules: useWorkspaceStore.getState().redactionRules,
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

  async function toggleInspectionMode(): Promise<void> {
    const nextEnabled = await window.desktopShell.setInspectionMode(!inspectionModeEnabled);
    setInspectionModeEnabled(nextEnabled);
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

          <article className="panel full-width-panel">
            <div className="panel-header">
              <div>
                <p className="section-label">Request detail</p>
                <p className="panel-copy">
                  Inspect captured browser requests with canonical body-state explanations,
                  timing phases, and the current safe-by-default redaction baseline.
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
                        <span className="status-label">Duration</span>
                        <span className="status-value">
                          {formatDuration(selectedCapture.durationMs)}
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
                        testId="request-body-section"
                      />
                      <RequestBodySection
                        title="Response payload"
                        headers={selectedCapture.response?.headers ?? null}
                        body={selectedCapture.response?.body}
                        status={selectedCapture.response?.status}
                        failure={selectedCapture.failure}
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
                <button
                  className="button button-secondary"
                  onClick={() => insertStepAfterSelection('reload')}
                >
                  Insert reload
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => insertStepAfterSelection('url-assertion')}
                >
                  Insert URL assertion
                </button>
              </div>
            </div>

            <div className="recording-review-grid">
              <div className="step-review-list" data-testid="recorded-step-list">
                {recordingSession.present.steps.map((step, index) => (
                  <button
                    key={step.id}
                    className={`step-review-card${
                      step.id === recordingSession.selectedStepId
                        ? ' step-review-card-selected'
                        : ''
                    }`}
                    onClick={() => selectRecordedStep(step.id)}
                    type="button"
                  >
                    <div className="step-review-header">
                      <span className="step-index">Step {index + 1}</span>
                      <span className={`status-pill status-${step.evidenceState}`}>
                        {step.evidenceState}
                      </span>
                    </div>
                    <p className="step-title">{step.title}</p>
                    <p className="step-summary">{describeRecordedStep(step)}</p>
                    <div className="step-review-tags">
                      <span className="review-tag">{step.kind}</span>
                      <span className="review-tag">{step.status}</span>
                      {step.dependencyStepIds.length > 0 ? (
                        <span className="review-tag">
                          depends on {step.dependencyStepIds.length}
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

                      {selectedRecordedStep.kind === 'action' ? (
                        <ActionEditor
                          step={selectedRecordedStep}
                          onChange={(step) =>
                            replaceRecordedStepInReview(selectedRecordedStep.id, step)
                          }
                        />
                      ) : (
                        <AssertionEditor
                          step={selectedRecordedStep}
                          onChange={(step) =>
                            replaceRecordedStepInReview(selectedRecordedStep.id, step)
                          }
                        />
                      )}
                    </div>

                    <div className="step-editor-footer">
                      <p className="panel-copy">
                        Last mutation: {recordingSession.lastMutation.kind}. Affected
                        steps: {recordingSession.lastMutation.affectedStepIds.join(', ') || 'none'}.
                      </p>
                      <p className="panel-copy">
                        Invalidated checkpoints:{' '}
                        {recordingSession.lastMutation.invalidatedCheckpointIds.join(', ') ||
                          'none'}
                        .
                      </p>
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
                          className={`step-review-card${
                            replayPlan?.checkpointId === checkpoint.id
                              ? ' step-review-card-selected'
                              : ''
                          }`}
                          onClick={() => previewReplayFromCheckpoint(checkpoint.id)}
                        >
                          <div className="step-review-header">
                            <span className="step-index">{checkpoint.kind}</span>
                            <span className={`status-pill status-${checkpoint.status === 'valid' ? 'running' : 'error'}`}>
                              {checkpoint.status}
                            </span>
                          </div>
                          <p className="step-title">{checkpoint.label}</p>
                          <p className="step-summary">
                            Step: {checkpoint.stepId}
                          </p>
                          <p className="step-summary">
                            Snapshot: {checkpoint.snapshot ? 'ready' : 'metadata only'}
                          </p>
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
                    <p className="panel-copy">{replayPlan.checkpointReason}</p>
                    <div className="step-review-tags">
                      {replayPlan.executionStepIds.map((stepId) => (
                        <span className="review-tag" key={stepId}>
                          {stepId}
                        </span>
                      ))}
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
    case 'click':
    case 'double-click':
      return `${step.action.type} ${step.action.selector}`;
    case 'reload':
      return 'Reload the current page';
    default:
      return step.action.type;
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

function RequestBodySection(props: {
  title: string;
  headers: Record<string, string> | null;
  body: CaptureBody | undefined;
  status?: number;
  failure?: {
    code: string;
    message: string;
  };
  targetUrl?: string;
  testId: string;
}) {
  const { title, headers, body, status, failure, targetUrl, testId } = props;
  const headerEntries = headers ? Object.entries(headers) : [];
  const sensitiveEndpoint = isSensitiveEndpoint(targetUrl);

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


function ActionEditor(props: {
  step: Extract<RecordedStep, { kind: 'action' }>;
  onChange: (step: Extract<RecordedStep, { kind: 'action' }>) => void;
}) {
  const { step, onChange } = props;

  switch (step.action.type) {
    case 'navigate': {
      return (
        <>
          <label className="field-label" htmlFor="step-url">
            Target URL
          </label>
          <input
            id="step-url"
            className="url-input"
            value={step.action.url}
            onChange={(event) =>
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                action: {
                  type: 'navigate',
                  url: event.target.value,
                },
              })
            }
          />
        </>
      );
    }
    case 'fill': {
      const action = step.action;
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                action: {
                  type: 'fill',
                  selector: event.target.value,
                  value: action.value,
                  sensitive: action.sensitive,
                },
              })
            }
          />
          <label className="field-label" htmlFor="step-value">
            Text value
          </label>
          <input
            id="step-value"
            className="url-input"
            value={action.value}
            onChange={(event) =>
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                action: {
                  type: 'fill',
                  selector: action.selector,
                  value: event.target.value,
                  sensitive: action.sensitive,
                },
              })
            }
          />
        </>
      );
    }
    case 'click':
    case 'double-click': {
      const action = step.action;
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                action: {
                  type: action.type,
                  selector: event.target.value,
                },
              })
            }
          />
        </>
      );
    }
    default:
      return (
        <p className="empty-state">
          This action type has no editable parameters in the current Phase 4 slice.
        </p>
      );
  }
}

function isSensitiveEndpoint(targetUrl: string | undefined): boolean {
  if (!targetUrl) {
    return false;
  }

  return /\/(auth|login|oauth|password|session|token)(?:[/?#]|$)/i.test(targetUrl);
}

function AssertionEditor(props: {
  step: Extract<RecordedStep, { kind: 'assertion' }>;
  onChange: (step: Extract<RecordedStep, { kind: 'assertion' }>) => void;
}) {
  const { step, onChange } = props;

  switch (step.assertion.kind) {
    case 'element-visible':
    case 'element-hidden':
    case 'element-enabled': {
      const assertion = step.assertion;
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                assertion: {
                  schemaVersion: assertion.schemaVersion,
                  kind: assertion.kind,
                  selector: event.target.value,
                },
              })
            }
          />
        </>
      );
    }
    case 'element-contains-text': {
      const assertion = step.assertion;
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                assertion: {
                  schemaVersion: assertion.schemaVersion,
                  kind: 'element-contains-text',
                  selector: event.target.value,
                  expectedText: assertion.expectedText,
                },
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                assertion: {
                  schemaVersion: assertion.schemaVersion,
                  kind: 'element-contains-text',
                  selector: assertion.selector,
                  expectedText: event.target.value,
                },
              })
            }
          />
        </>
      );
    }
    case 'url-matches': {
      const assertion = step.assertion;
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
              onChange({
                ...step,
                updatedAt: new Date().toISOString(),
                assertion: {
                  schemaVersion: assertion.schemaVersion,
                  kind: 'url-matches',
                  expectedUrl: event.target.value,
                  matchMode: assertion.matchMode,
                },
              })
            }
          />
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
