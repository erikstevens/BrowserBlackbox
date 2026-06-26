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
    await expect(window.locator('.status-health-healthy')).toContainText('healthy');
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

    await expect(window.locator('.status-idle')).toContainText('idle');
    await expect(window.locator('.status-health-idle')).toContainText('idle');
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
});

async function createFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
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
