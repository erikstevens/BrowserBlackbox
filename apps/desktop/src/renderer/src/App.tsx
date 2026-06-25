import { useEffect, useState } from 'react';
import { productSummary } from '@browser-blackbox/domain';
import { useWorkspaceStore } from '@browser-blackbox/ui-state';

export function App() {
  const url = useWorkspaceStore((state) => state.targetUrl);
  const browserRuntime = useWorkspaceStore((state) => state.browserRuntime);
  const runtimeHealth = useWorkspaceStore((state) => state.runtimeHealth);
  const runtimeEvents = useWorkspaceStore((state) => state.runtimeEvents);
  const setUrl = useWorkspaceStore((state) => state.setTargetUrl);
  const setBrowserRuntime = useWorkspaceStore((state) => state.setBrowserRuntime);
  const setRuntimeDiagnostics = useWorkspaceStore((state) => state.setRuntimeDiagnostics);
  const pushRuntimeUpdate = useWorkspaceStore((state) => state.pushRuntimeUpdate);
  const [pendingAction, setPendingAction] = useState<'launch' | 'stop' | null>(null);

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

  async function launchManagedChromium(): Promise<void> {
    setPendingAction('launch');

    try {
      const result = await window.desktopShell.launchBrowserSession({ targetUrl: url });
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
            <p className="eyebrow">Phase 3 runtime core</p>
            <div className="hero-grid">
              <div className="hero-copy">
                <h1 className="hero-title">QA Browser Shell</h1>
                <p className="hero-summary">{productSummary}</p>
              </div>
              <section className="hero-card">
                <p className="section-label">Workspace baseline</p>
                <p className="hero-card-copy">
                  The renderer now talks to a managed main-process browser runtime
                  through a strict preload API, and this slice adds a live runtime
                  event stream plus visible health reporting on top of the embedded
                  Playwright-plus-CDP surface.
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
                `packages/runtime-browser` now owns the Playwright-over-CDP session
                lifecycle and emits the runtime event feed consumed in the Electron
                main process.
              </li>
              <li className="lane-item">
                `packages/ui-state` is the initial renderer state surface using
                Zustand.
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
