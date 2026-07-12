import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type FixtureServer = {
  close: () => Promise<void>;
  origin: string;
};

const REPO_ROOT = resolve(__dirname, '../..');
const ELECTRON_ENTRY = resolve(REPO_ROOT, 'apps/desktop/out/main/index.js');
const ELECTRON_EXECUTABLE_PATH = resolve(REPO_ROOT, 'node_modules/electron/dist/electron.exe');
const HAS_BUILT_DESKTOP_ENTRY = existsSync(ELECTRON_ENTRY);
const HAS_ELECTRON_EXECUTABLE = existsSync(ELECTRON_EXECUTABLE_PATH);

test.describe('desktop acceptance', () => {
  test.skip(
    !HAS_BUILT_DESKTOP_ENTRY || !HAS_ELECTRON_EXECUTABLE,
    'The built desktop entry or Electron binary is not available in this environment, so desktop acceptance tests cannot launch.',
  );

  let fixtureServer: FixtureServer;
  let electronApp: ElectronApplication;
  let window: Page;

  test.beforeEach(async () => {
    fixtureServer = await createFixtureServer();
    electronApp = await electron.launch({
      args: [ELECTRON_ENTRY],
      cwd: REPO_ROOT,
      executablePath: ELECTRON_EXECUTABLE_PATH,
    });
    window = await waitForShellWindow(electronApp);
    await window.waitForLoadState('domcontentloaded');
    await expect(window.locator('#target-url')).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    await fixtureServer.close();
  });

  test('launches the managed embedded session and streams diagnostics', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();

    await expect(statusRowPill(window, 'Phase')).toContainText('running');
    await expect(statusRowPill(window, 'Health')).toContainText('healthy');
    await expect(window.getByText('Attached', { exact: true }).first()).toBeVisible();
    await expect(statusRowValue(window, 'Target')).toContainText(`${fixtureServer.origin}/`);
    await expect(statusRowValue(window, 'Page')).toContainText(`${fixtureServer.origin}/`);

    await expect(window.locator('.event-stream')).toContainText(
      `Launching managed browser session for ${fixtureServer.origin}/.`,
    );
    await expect(window.locator('.event-stream')).toContainText(
      `GET ${fixtureServer.origin}/api/health`,
    );
    await expect(window.locator('.event-stream')).toContainText('fixture console ready');

    await expect
      .poll(async () => {
        return electronApp.evaluate(({ BrowserWindow }) => {
          const browserWindow = BrowserWindow.getAllWindows()[0];
          return browserWindow?.getBrowserView()?.webContents.getURL() ?? null;
        });
      })
      .toBe(`${fixtureServer.origin}/`);
  });

  test('stops the managed session and returns the runtime surface to idle', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    await window.getByRole('button', { name: 'Stop session' }).click();

    await expect(statusRowPill(window, 'Phase')).toContainText('idle');
    await expect(statusRowPill(window, 'Health')).toContainText('idle');
    await expect(window.locator('.event-stream')).toContainText('Managed browser session stopped.');

    await expect
      .poll(async () => {
        return electronApp.evaluate(({ BrowserWindow }) => {
          const browserWindow = BrowserWindow.getAllWindows()[0];
          return browserWindow?.getBrowserView()?.webContents.getURL() ?? null;
        });
      })
      .toContain('data:text/html');
  });

  test('runs replay from the review lane against the live managed session', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();

    await expect(statusRowPill(window, 'Phase')).toContainText('running');
    await expect(window.getByTestId('recorded-step-list')).toContainText(
      `Navigate to ${fixtureServer.origin}/`,
    );

    await window.getByRole('button', { name: 'Replay from start' }).click();
    await window.getByRole('button', { name: 'Run replay' }).click();

    await expect(window.locator('.event-stream')).toContainText(
      'Replay started in from-start mode.',
    );
    await expect(window.locator('.event-stream')).toContainText(
      'Replay completed 1 step(s).',
    );
  });

  test('authors a simulation rule and applies it on the next replay', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();

    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    const simulationPanel = window.getByTestId('simulation-rules-panel');
    await simulationPanel.locator('#simulation-title').fill('Block home route');
    await simulationPanel
      .locator('#simulation-route-pattern')
      .fill(`${fixtureServer.origin}/`);
    await simulationPanel.locator('#simulation-domain').fill('');
    await simulationPanel.locator('#simulation-method').fill('GET');
    await simulationPanel.locator('#simulation-flow-context').fill('');
    await simulationPanel.locator('#simulation-action-kind').selectOption('route-block');
    await window.getByRole('button', { name: 'Add rule' }).click();

    await expect(simulationPanel).toContainText('Block home route');

    await window.getByRole('button', { name: 'Replay from start' }).click();
    await window.getByRole('button', { name: 'Run replay' }).click();

    await expect(window.locator('.event-stream')).toContainText(
      'Applied simulation rule Block home route',
    );
    await expect(window.locator('.event-stream')).toContainText('Replay execution failed.');
    await expect(window.getByTestId('simulation-activity-panel')).toContainText(
      'Applied simulation rule Block home route',
    );
    await expect(window.getByTestId('timeline-panel')).toContainText(
      'Applied simulation rule Block home route',
    );
  });

  test('runs persistent inspect mode with hover overlay and selected metadata', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');
    await window.getByRole('button', { name: 'Enter inspect mode' }).click();
    await expect(window.getByRole('button', { name: 'Exit inspect mode' })).toBeVisible();

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (() => {
          const target = document.querySelector('[data-testid="login-submit"]');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Inspection target was not found in the fixture page.');
          }
          target.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
        })();
      `);
    });

    await expect
      .poll(async () => {
        return electronApp.evaluate(async ({ BrowserWindow }) => {
          const browserWindow = BrowserWindow.getAllWindows()[0];
          const view = browserWindow?.getBrowserView();
          return (
            (await view?.webContents.executeJavaScript(`
              (() => {
                const overlay = document.getElementById('__browser_blackbox_inspector_overlay__');
                const label = overlay?.querySelector('[data-bb-label="true"]');
                return overlay instanceof HTMLElement
                  ? {
                      display: overlay.style.display,
                      text: label instanceof HTMLElement ? label.textContent : '',
                    }
                  : null;
              })();
            `)) ?? null
          );
        });
      })
      .toMatchObject({
        display: 'block',
      });

    await expect(window.getByTestId('inspection-panel')).toContainText(
      'page.getByTestId("login-submit")',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText('Sign in');
    await expect(window.locator('.event-stream')).toContainText('Inspection mode enabled.');
  });

  test('scores dynamic selectors as risky and surfaces reasoning', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');
    await window.getByRole('button', { name: 'Enter inspect mode' }).click();

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (async () => {
          const target = document.getElementById('btn__12345678');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Dynamic inspection target was not found.');
          }
          target.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 24,
          }));
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 24,
            clientY: 24,
          }));
        })();
      `);
    });

    await expect(window.getByTestId('inspection-panel')).toContainText(
      'page.getByRole("button", { name: "Order 42 at 12:34" })',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText('risky');
    await expect(window.getByTestId('inspection-panel')).toContainText(
      'Visible or accessible text appears dynamic.',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText(
      'ID looks auto-generated or unstable.',
    );
  });

  test('uses a stable parent anchor for repeated container targets', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');
    await window.getByRole('button', { name: 'Enter inspect mode' }).click();

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (() => {
          const target = document.querySelector('[data-testid="order-card-2"] button');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Repeated container target was not found.');
          }
          target.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
        })();
      `);
    });

    await expect(window.getByTestId('inspection-panel')).toContainText(
      'page.getByTestId("order-card-2").getByRole("button", { name: "Edit" })',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText(
      'Stable parent anchor',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText(
      'page.getByTestId("order-card-2")',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText(
      'Repeated child target is scoped to the nearest stable parent container.',
    );
  });

  test('shows related requests for an inspected target when correlation is available', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (() => {
          const target = document.querySelector('[data-testid="login-submit"]');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Login submit target was not found.');
          }
          target.click();
        })();
      `);
    });

    await expect(window.locator('.event-stream')).toContainText(
      `POST ${fixtureServer.origin}/api/login`,
    );

    await window.getByRole('button', { name: 'Enter inspect mode' }).click();

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (() => {
          const target = document.querySelector('[data-testid="login-submit"]');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Inspection target was not found in the fixture page.');
          }
          target.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
          target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: 20,
            clientY: 20,
          }));
        })();
      `);
    });

    await expect(window.getByTestId('inspection-panel')).toContainText(
      'Related requests',
    );
    await expect(window.getByTestId('inspection-panel')).toContainText(
      `${fixtureServer.origin}/api/login`,
    );
  });

  test('shows request detail bodies, timing phases, and policy explanations', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    const networkPanel = window.getByTestId('network-capture-panel');

    await expect(networkPanel).toContainText(`${fixtureServer.origin}/api/health`);
    await networkPanel.getByRole('button', { name: /\/api\/health/ }).click();

    const requestDetailView = window.getByTestId('request-detail-view');
    await expect(requestDetailView).toContainText(`${fixtureServer.origin}/api/health`);
    await expect(window.getByTestId('response-body-section')).toContainText('Captured in full');
    await expect(window.getByTestId('response-body-section')).toContainText('{"ok":true}');
    await expect(window.getByTestId('request-timing-panel')).toContainText('Request');
    await expect(window.getByTestId('request-timing-panel')).toContainText('Response');

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (() => {
          const target = document.querySelector('[data-testid="login-submit"]');
          if (!(target instanceof HTMLElement)) {
            throw new Error('Login submit target was not found.');
          }
          target.click();
        })();
      `);
    });

    await expect(window.locator('.event-stream')).toContainText(
      `POST ${fixtureServer.origin}/api/login`,
    );
    await expect(networkPanel).toContainText(`${fixtureServer.origin}/api/login`);
    await networkPanel.getByRole('button', { name: /\/api\/login/ }).click();

    await expect(requestDetailView).toContainText(`${fixtureServer.origin}/api/login`);
    await expect(window.getByTestId('request-body-section')).toContainText('qa@example.test');
    await expect(window.getByTestId('response-body-section')).toContainText(
      'Capture unavailable',
    );
    await expect(window.getByTestId('response-body-section')).toContainText(
      'sensitive authentication or session endpoint',
    );
    await expect(requestDetailView).toContainText(
      'Guaranteed secret redaction is always active',
    );
  });

  test('applies user-defined redaction rules to newly captured request evidence', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    const rulesPanel = window.getByTestId('redaction-rules-panel');
    await window.locator('#redaction-kind').selectOption('json-path');
    await window.locator('#redaction-scope').selectOption('both');
    await window.locator('#redaction-target').fill('$.profile.email');
    await window.getByRole('button', { name: 'Add redaction rule' }).click();

    await expect(rulesPanel).toContainText('$.profile.email');

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        fetch('/api/customer?accountId=abc123', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profile: {
              email: 'qa@example.test',
            },
          }),
        });
      `);
    });

    const networkPanel = window.getByTestId('network-capture-panel');
    await expect(networkPanel).toContainText(`${fixtureServer.origin}/api/customer?accountId=abc123`);
    await networkPanel.getByRole('button', { name: /\/api\/customer/ }).click();

    await expect(window.getByTestId('request-detail-view')).toContainText(
      `${fixtureServer.origin}/api/customer?accountId=abc123`,
    );
    await expect(window.getByTestId('request-body-section')).toContainText('[REDACTED]');
    await expect(window.getByTestId('request-body-section')).not.toContainText('qa@example.test');
    await expect(window.getByTestId('response-body-section')).toContainText('Capture unavailable');
    await expect(window.getByTestId('response-body-section')).not.toContainText('qa@example.test');
  });

  test('exports a safe artifact bundle and requires explicit action for visible-body override', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    await expect(window.getByTestId('ui-export-preview')).toContainText(
      `import { test, expect } from '@playwright/test';`,
    );
    await expect(window.getByTestId('ui-export-preview')).toContainText(
      `await page.goto("${fixtureServer.origin}/");`,
    );

    const simulationPanel = window.getByTestId('simulation-rules-panel');
    await simulationPanel.locator('#simulation-title').fill('Block profile route');
    await simulationPanel
      .locator('#simulation-route-pattern')
      .fill('**/api/profile');
    await simulationPanel.locator('#simulation-domain').fill('');
    await simulationPanel.locator('#simulation-method').fill('POST');
    await simulationPanel.locator('#simulation-flow-context').fill('');
    await simulationPanel.locator('#simulation-action-kind').selectOption('route-block');
    await window.getByRole('button', { name: 'Add rule' }).click();

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        fetch('/api/profile', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'qa@example.test',
          }),
        });
      `);
    });

    await expect(window.locator('.event-stream')).toContainText(
      `POST ${fixtureServer.origin}/api/profile`,
    );

    const exportPanel = window.getByTestId('artifact-export-panel');
    await expect(exportPanel).toContainText('Some captured full bodies still look sensitive');
    await expect(window.getByTestId('ui-export-preview')).toContainText(
      `import { installSimulationRules } from './simulation-rules';`,
    );
    await expect(window.getByTestId('simulation-export-preview')).toContainText(
      `await page.route("**/api/profile", async (route) => {`,
    );
    await expect(window.getByTestId('simulation-export-preview')).toContainText(
      `await route.abort('blockedbyclient');`,
    );
    await expect(window.getByTestId('api-export-preview')).toContainText(
      `const baseURL = process.env.BASE_URL ?? "${fixtureServer.origin}";`,
    );
    await expect(window.getByTestId('api-export-preview')).toContainText(
      'await request.post(`${baseURL}/api/profile`, {',
    );
    await expect(window.getByTestId('api-fixture-preview')).toContainText(
      '"urlTemplate": "/api/profile"',
    );
    await expect(window.getByTestId('api-collection-preview')).toContainText(
      '"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"',
    );
    await expect(window.getByTestId('api-collection-preview')).toContainText(
      '"url": "{{baseUrl}}/api/profile"',
    );

    await window.getByRole('button', { name: 'Export safe artifact bundle' }).click();
    const exportResult = window.getByTestId('artifact-export-result');
    await expect(exportResult).toContainText('safe-redacted');
    await expect(exportResult).toContainText('browser-blackbox-export-');

    await window
      .getByLabel('I understand this export may contain visible personal, credential, or session-like payload data.')
      .check();
    await window.getByRole('button', { name: 'Export with visible bodies' }).click();

    await expect(exportResult).toContainText('unsafe-unredacted');

    await window.getByRole('button', { name: 'Reopen artifact bundle' }).click();
    const reopenResult = window.getByTestId('artifact-reopen-result');
    await expect(reopenResult).toContainText('reopened-artifact');
    await expect(reopenResult).toContainText('1.0.0');
    await expect(reopenResult).toContainText('No optional artifacts were missing');
    await expect(window.getByTestId('ui-export-preview')).toContainText(
      `await page.goto("${fixtureServer.origin}/");`,
    );
  });

  test('shows retry metadata when a repeated request succeeds after a prior failure', async () => {
    await window.locator('#target-url').fill(`${fixtureServer.origin}/`);
    await window.getByRole('button', { name: 'Launch managed Chromium' }).click();
    await expect(statusRowPill(window, 'Phase')).toContainText('running');

    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      const view = browserWindow?.getBrowserView();
      await view?.webContents.executeJavaScript(`
        (async () => {
          try {
            await fetch('/api/retry');
          } catch {}
          await fetch('/api/retry');
        })();
      `);
    });

    await expect(window.locator('.event-stream')).toContainText(
      `GET ${fixtureServer.origin}/api/retry`,
    );
    const timelinePanel = window.getByTestId('timeline-panel');
    await expect(timelinePanel).toContainText(`GET ${fixtureServer.origin}/api/retry`);
    await window.getByLabel('Timeline filter').selectOption('request');
    await timelinePanel.getByRole('button', { name: /GET .*\/api\/retry/i }).last().click();

    const networkPanel = window.getByTestId('network-capture-panel');
    await expect(networkPanel).toContainText(`${fixtureServer.origin}/api/retry`);
    await networkPanel.getByRole('button', { name: /\/api\/retry/ }).last().click();

    await expect(window.getByTestId('request-detail-view')).toContainText(
      `${fixtureServer.origin}/api/retry`,
    );
    await expect(window.getByTestId('request-detail-view')).toContainText('Retry count');
    await expect(window.getByTestId('request-detail-view')).toContainText('1');
  });
});

async function createFixtureServer(): Promise<FixtureServer> {
  let retryAttemptCount = 0;
  const server = createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.url === '/api/login' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, token: 'opaque-login-token' }));
      return;
    }

    if (request.url?.startsWith('/api/customer') && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          profile: {
            email: 'qa@example.test',
          },
        }),
      );
      return;
    }

    if (request.url === '/api/profile' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          ok: true,
          profile: {
            email: 'qa@example.test',
          },
        }),
      );
      return;
    }

    if (request.url === '/api/retry') {
      retryAttemptCount += 1;
      if (retryAttemptCount === 1) {
        request.socket.destroy();
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, attempt: retryAttemptCount }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Fixture Site</title>
        </head>
        <body>
          <main>
            <h1>Fixture Site</h1>
            <p id="fixture-status">booting</p>
            <label for="fixture-email">Email</label>
            <input id="fixture-email" name="email" type="email" placeholder="qa@example.test" />
            <button data-testid="login-submit" type="button">Sign in</button>
            <button id="btn__12345678" type="button">Order 42 at 12:34</button>
            <section data-testid="order-card-1" aria-label="Order card 1">
              <h2>Order 1</h2>
              <button type="button">Edit</button>
            </section>
            <section data-testid="order-card-2" aria-label="Order card 2">
              <h2>Order 2</h2>
              <button type="button">Edit</button>
            </section>
          </main>
          <script>
            console.log('fixture console ready');
            fetch('/api/health')
              .then((response) => response.json())
              .then(() => {
                document.getElementById('fixture-status').textContent = 'healthy';
              })
              .catch((error) => {
                console.error('fixture fetch failed', error);
              });
            document.querySelector('[data-testid="login-submit"]').addEventListener('click', () => {
              fetch('/api/login', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  user: 'qa@example.test',
                }),
              }).catch((error) => {
                console.error('fixture login failed', error);
              });
            });
          </script>
        </body>
      </html>`);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Fixture server failed to bind to a local port.');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function waitForShellWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    for (const page of electronApp.windows()) {
      if ((await page.title()) === 'QA Browser Shell') {
        return page;
      }
    }

    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) {
      break;
    }

    try {
      const page = await electronApp.waitForEvent('window', {
        timeout: Math.min(2_000, remaining),
        predicate: async (candidate) => {
          return (await candidate.title()) === 'QA Browser Shell';
        },
      });
      return page;
    } catch {
      // Continue polling until the deadline expires.
    }
  }

  const discovered = await Promise.all(
    electronApp.windows().map(async (page) => ({
      title: await page.title(),
      url: page.url(),
    })),
  );

  throw new Error(
    `Unable to resolve the QA Browser Shell window. Found: ${JSON.stringify(discovered)}`,
  );
}

function statusRowValue(window: Page, label: string) {
  return window
    .locator('.status-row')
    .filter({ has: window.locator('.status-label', { hasText: label }) })
    .locator('.status-value');
}

function statusRowPill(window: Page, label: string) {
  return window
    .locator('.status-row')
    .filter({ has: window.locator('.status-label', { hasText: label }) })
    .locator('.status-pill');
}
