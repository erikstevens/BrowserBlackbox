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

    await expect(window.locator('.status-running')).toContainText('running');
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
    await expect(window.locator('.status-running')).toContainText('running');

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

    await expect(window.locator('.status-running')).toContainText('running');
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
