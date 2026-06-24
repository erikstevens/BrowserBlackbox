import { productSummary } from '@browser-blackbox/domain';
import { useWorkspaceStore } from '@browser-blackbox/ui-state';

export function App() {
  const url = useWorkspaceStore((state) => state.targetUrl);
  const setUrl = useWorkspaceStore((state) => state.setTargetUrl);

  return (
    <main className="app-shell">
      <div className="app-frame">
        <header className="hero-panel">
          <p className="eyebrow">Phase 0 scaffold</p>
          <div className="hero-grid">
            <div className="hero-copy">
              <h1 className="hero-title">QA Browser Shell</h1>
              <p className="hero-summary">{productSummary}</p>
            </div>
            <section className="hero-card">
              <p className="section-label">Workspace baseline</p>
              <p className="hero-card-copy">
                Electron shell, React renderer, shared package boundaries, and quality
                tooling are in place before browser runtime work begins.
              </p>
            </section>
          </div>
        </header>

        <section className="content-grid">
          <article className="panel">
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
              <button className="button button-primary">
                Launch managed Chromium
              </button>
              <button className="button button-secondary">
                Open saved run
              </button>
            </div>
          </article>

          <article className="panel">
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
                `packages/ui-state` is the initial renderer state surface using Zustand.
              </li>
              <li className="lane-item">
                CI validates typecheck, lint, and unit tests before runtime-heavy slices.
              </li>
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
