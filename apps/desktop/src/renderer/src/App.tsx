import { useEffect, useState } from 'react';
import { productSummary } from '@browser-blackbox/domain';
import { useWorkspaceStore } from '@browser-blackbox/ui-state';

export function App() {
  const url = useWorkspaceStore((state) => state.targetUrl);
  const browserRuntime = useWorkspaceStore((state) => state.browserRuntime);
  const setUrl = useWorkspaceStore((state) => state.setTargetUrl);
  const setBrowserRuntime = useWorkspaceStore((state) => state.setBrowserRuntime);
  const [pendingAction, setPendingAction] = useState<'launch' | 'stop' | null>(null);

  useEffect(() => {
    void window.desktopShell.getBrowserRuntimeState().then(setBrowserRuntime).catch((error) => {
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
  }, [setBrowserRuntime]);

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
                The renderer now talks to a managed main-process browser runtime through a
                strict preload API, and the shell now routes Playwright plus CDP control
                into the embedded browser pane inside the workspace.
              </p>
            </section>
          </div>
        </header>

        <section className="content-grid">
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
              {browserRuntime.lastError ? (
                <p className="runtime-error">{browserRuntime.lastError}</p>
              ) : null}
            </div>
          </article>

          <article className="panel browser-pane-panel">
            <p className="section-label">Embedded browser pane</p>
            <div className="embedded-pane-placeholder">
              <div className="embedded-pane-header">
                <span className="embedded-pane-dot" />
                <span className="embedded-pane-dot" />
                <span className="embedded-pane-dot" />
              </div>
              <div className="embedded-pane-copy">
                <h2 className="embedded-pane-title">Main-process browser surface</h2>
                <p className="embedded-pane-text">
                  The right side of the workspace is the managed browser runtime target.
                  Launching a session now attaches Playwright over CDP to that same embedded
                  Chromium surface instead of steering a separate browser session.
                </p>
                <ul className="lane-list">
                  <li className="lane-item">
                    The embedded pane is hosted by Electron in the main process, not by React.
                  </li>
                  <li className="lane-item">
                    Runtime session ownership stays unified to the embedded browser surface,
                    so the workspace and runtime do not drift into different browser targets.
                  </li>
                  <li className="lane-item">
                    The next runtime slices can build recorder, inspection, and network capture
                    on top of a Playwright-first control plane with deeper CDP instrumentation.
                  </li>
                </ul>
              </div>
            </div>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel full-width-panel">
            <p className="section-label">Architecture lanes</p>
            <ul className="lane-list">
              <li className="lane-item">
                `apps/desktop` owns the Electron shell, renderer, and process boundary.
              </li>
              <li className="lane-item">
                `packages/domain` holds product language and invariant-friendly shared
                contracts.
              </li>
              <li className="lane-item">
                `packages/runtime-browser` now owns the Playwright-over-CDP session lifecycle
                in the Electron main process.
              </li>
              <li className="lane-item">
                `packages/ui-state` is the initial renderer state surface using Zustand.
              </li>
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
