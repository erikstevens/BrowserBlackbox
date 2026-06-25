import { useEffect, useState } from 'react';
import { productSummary, type RecordedStep } from '@browser-blackbox/domain';
import {
  getRecordingUndoAvailability,
  getSelectedRecordedStep,
  useWorkspaceStore,
} from '@browser-blackbox/ui-state';

export function App() {
  const url = useWorkspaceStore((state) => state.targetUrl);
  const browserRuntime = useWorkspaceStore((state) => state.browserRuntime);
  const runtimeHealth = useWorkspaceStore((state) => state.runtimeHealth);
  const runtimeEvents = useWorkspaceStore((state) => state.runtimeEvents);
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
  const [pendingAction, setPendingAction] = useState<'launch' | 'stop' | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const selectedRecordedStep = getSelectedRecordedStep(recordingSession);
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
    if (!persistenceReady) {
      return;
    }

    void window.desktopShell.saveWorkingCopySnapshot(exportWorkingCopySnapshot());
  }, [browserRuntime.sessionId, exportWorkingCopySnapshot, persistenceReady, recordingSession, url]);

  async function launchManagedChromium(): Promise<void> {
    setPendingAction('launch');

    try {
      const result = await window.desktopShell.launchBrowserSession({ targetUrl: url });
      beginRuntimeCapture(result.state.targetUrl ?? url, result.state.sessionId);
      setBrowserRuntime(result.state);
    } catch (error) {
      setBrowserRuntime({
        ...browserRuntime,
        phase: 'error',
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
        phase: 'error',
        playwrightAttached: browserRuntime.playwrightAttached,
        cdpAttached: browserRuntime.cdpAttached,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingAction(null);
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
                  disabled={!replayPlan}
                  onClick={() => prepareReplayExecution()}
                >
                  Mark pending replay
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
