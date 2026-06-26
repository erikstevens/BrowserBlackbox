import { app, BrowserView, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { domainVersions, parseInspectionMetadata } from '@browser-blackbox/domain';
import { FileBackedSqliteStore } from '@browser-blackbox/persistence/src/file-store';
import type { StoredRunSnapshot } from '@browser-blackbox/persistence/src/contracts';
import { createSqliteEngine } from '@browser-blackbox/persistence/src/sqlite';
import { BrowserSessionManager } from '@browser-blackbox/runtime-browser';
import type {
  BrowserRuntimeDiagnostics,
  BrowserRuntimeEvent,
  BrowserRuntimeHealth,
  BrowserRuntimeUpdate,
  BrowserLaunchRequest,
  BrowserReplayRequest,
  BrowserReplayCommandResult,
  BrowserRuntimeCommandResult,
  ManagedBrowserSurface,
  BrowserRuntimeState,
} from '@browser-blackbox/runtime-browser';

const isDev = !app.isPackaged;
const browserSessionManager = new BrowserSessionManager();
const REMOTE_DEBUGGING_HOST = '127.0.0.1';
const APP_FRAME_PADDING = 24;
const LEFT_RAIL_WIDTH = 384;
const LAYOUT_GAP = 24;
const EMBEDDED_PANE_TITLE = 'Browser Blackbox Embedded Surface';
const MAX_RUNTIME_EVENTS = 80;

let mainWindow: BrowserWindow | null = null;
let workspaceBrowserView: BrowserView | null = null;
let remoteDebuggingPort = 0;
let runtimeEvents: BrowserRuntimeEvent[] = [];
let lastCapturedRuntimeEventId: string | null = null;
let runtimeHealth: BrowserRuntimeHealth = {
  status: 'idle',
  lastEventAt: null,
  lastError: null,
  recentEventCount: 0,
  subscriberCount: 0,
};
let workingCopyStorePromise: Promise<FileBackedSqliteStore> | null = null;

app.commandLine.appendSwitch('remote-debugging-address', REMOTE_DEBUGGING_HOST);
browserSessionManager.subscribe((event) => {
  publishRuntimeEvent(event);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f1720',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  attachWorkspaceBrowserView(mainWindow);
  mainWindow.on('resize', () => {
    updateWorkspaceBrowserViewBounds();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    workspaceBrowserView = null;
    browserSessionManager.unregisterSurface();
    runtimeHealth = deriveRuntimeHealth(browserSessionManager.getState(), runtimeEvents, 0);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

function registerIpcHandlers(): void {
  ipcMain.handle('browser-runtime:get-state', async (): Promise<BrowserRuntimeState> => {
    return browserSessionManager.getState();
  });

  ipcMain.handle('browser-runtime:get-diagnostics', async (): Promise<BrowserRuntimeDiagnostics> => {
    return getRuntimeDiagnostics();
  });

  ipcMain.handle(
    'browser-runtime:launch',
    async (_event, request: BrowserLaunchRequest): Promise<BrowserRuntimeCommandResult> => {
      lastCapturedRuntimeEventId = null;
      return browserSessionManager.launch(request);
    },
  );

  ipcMain.handle(
    'browser-runtime:replay',
    async (_event, request: BrowserReplayRequest): Promise<BrowserReplayCommandResult> => {
      return browserSessionManager.executeReplay(request);
    },
  );

  ipcMain.handle('browser-runtime:stop', async (): Promise<BrowserRuntimeCommandResult> => {
    const result = await browserSessionManager.stop();
    lastCapturedRuntimeEventId = null;
    await clearWorkspaceBrowserPane().catch((error) => {
      publishRuntimeEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        category: 'browser',
        code: 'browser.placeholder.load_failed',
        level: 'warn',
        message: 'Failed to restore the idle embedded browser pane.',
        source: 'electron_shell',
        detail: error instanceof Error ? error.message : String(error),
      });
    });
    return result;
  });

  ipcMain.handle(
    'workspace:load-working-copy',
    async (): Promise<StoredRunSnapshot | null> => {
      const store = await getWorkingCopyStore();
      return store.loadSnapshot('workspace-working-copy');
    },
  );

  ipcMain.handle(
    'workspace:save-working-copy',
    async (_event, snapshot: StoredRunSnapshot): Promise<void> => {
      const store = await getWorkingCopyStore();
      await store.saveSnapshot(snapshot);
    },
  );

  ipcMain.on('browser-runtime:subscribe', (event) => {
    runtimeHealth = deriveRuntimeHealth(
      browserSessionManager.getState(),
      runtimeEvents,
      runtimeHealth.subscriberCount + 1,
    );
    event.sender.send('browser-runtime:diagnostics-sync', getRuntimeDiagnostics());
  });

  ipcMain.on('browser-runtime:unsubscribe', () => {
    runtimeHealth = deriveRuntimeHealth(
      browserSessionManager.getState(),
      runtimeEvents,
      Math.max(0, runtimeHealth.subscriberCount - 1),
    );
  });
}

function attachWorkspaceBrowserView(window: BrowserWindow): void {
  workspaceBrowserView = new BrowserView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  browserSessionManager.registerSurface(createEmbeddedSurfaceAdapter(workspaceBrowserView));
  window.setBrowserView(workspaceBrowserView);
  workspaceBrowserView.setBackgroundColor('#101922');
  registerWorkspaceBrowserListeners(workspaceBrowserView);
  updateWorkspaceBrowserViewBounds();
  void clearWorkspaceBrowserPane().catch((error) => {
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      code: 'browser.placeholder.load_failed',
      level: 'warn',
      message: 'Failed to load the idle embedded browser pane.',
      source: 'electron_shell',
      detail: error instanceof Error ? error.message : String(error),
    });
  });
}

function updateWorkspaceBrowserViewBounds(): void {
  if (mainWindow === null || workspaceBrowserView === null) {
    return;
  }

  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const x = APP_FRAME_PADDING + LEFT_RAIL_WIDTH + LAYOUT_GAP;
  const y = APP_FRAME_PADDING;
  const width = Math.max(
    420,
    windowWidth - LEFT_RAIL_WIDTH - LAYOUT_GAP - APP_FRAME_PADDING * 2,
  );
  const height = Math.max(420, windowHeight - APP_FRAME_PADDING * 2);

  workspaceBrowserView.setBounds({ x, y, width, height });
  workspaceBrowserView.setAutoResize({ width: true, height: true });
}

function createEmbeddedSurfaceAdapter(view: BrowserView): ManagedBrowserSurface {
  return {
    getCdpEndpoint: () => `http://${REMOTE_DEBUGGING_HOST}:${remoteDebuggingPort}`,
    getURL: () => view.webContents.getURL(),
  };
}

async function clearWorkspaceBrowserPane(): Promise<void> {
  if (workspaceBrowserView === null) {
    return;
  }

  const html = `
    <html>
      <head>
        <title>${EMBEDDED_PANE_TITLE}</title>
      </head>
      <body style="margin:0;font-family:IBM Plex Sans,system-ui,sans-serif;background:#101922;color:#f4f1ea;display:grid;place-items:center;height:100vh;">
        <div style="max-width:420px;padding:24px;text-align:center;line-height:1.6;">
          <p style="margin:0 0 8px;color:#9eb0c2;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;">Embedded Pane</p>
          <h2 style="margin:0 0 12px;font-size:28px;">No active browser session</h2>
          <p style="margin:0;color:#9eb0c2;">Launch a managed session from the left-hand controls to load the current target inside the workspace pane.</p>
        </div>
      </body>
    </html>
  `;

  await workspaceBrowserView.webContents.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}

function registerWorkspaceBrowserListeners(view: BrowserView): void {
  view.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (message.startsWith('__BB_CAPTURE__')) {
      try {
        const payload = JSON.parse(message.slice('__BB_CAPTURE__'.length)) as {
          payload?: Record<string, unknown>;
          timestamp?: string;
        };
        if (payload.payload) {
          publishRecordedStepCapture({
            capturedAt: payload.timestamp ?? new Date().toISOString(),
            payload: payload.payload,
          });
        }
      } catch (error) {
        publishRuntimeEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          category: 'console',
          code: 'recording.capture.parse_failed',
          level: 'warn',
          message: 'Failed to parse embedded capture payload.',
          source: 'electron_shell',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (message.startsWith('__BB_INSPECT__')) {
      try {
        const payload = JSON.parse(message.slice('__BB_INSPECT__'.length)) as {
          inspection?: unknown;
          timestamp?: string;
        };
        if (payload.inspection) {
          publishRuntimeEvent({
            id: randomUUID(),
            timestamp: payload.timestamp ?? new Date().toISOString(),
            category: 'browser',
            code: 'inspection.target.selected',
            level: 'info',
            message: 'Selected element for inspection.',
            source: 'electron_shell',
            data: {
              inspection: parseInspectionMetadata(payload.inspection),
            },
          });
        }
      } catch (error) {
        publishRuntimeEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          category: 'console',
          code: 'inspection.capture.parse_failed',
          level: 'warn',
          message: 'Failed to parse embedded inspection payload.',
          source: 'electron_shell',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const severity = level >= 2 ? 'error' : level === 1 ? 'warn' : 'info';
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'console',
      code: 'console.message',
      level: severity,
      message,
      source: 'electron_shell',
      detail: `${sourceId}:${line}`,
      data: {
        line,
        sourceId,
      },
    });
  });

  view.webContents.on('did-finish-load', () => {
    const currentUrl = view.webContents.getURL();
    if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
      return;
    }

    void view.webContents.executeJavaScript(buildEmbeddedCaptureScript()).catch((error) => {
      publishRuntimeEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        category: 'console',
        code: 'recording.capture.inject_failed',
        level: 'warn',
        message: 'Failed to inject embedded capture listeners.',
        source: 'electron_shell',
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  });

  view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      code: 'browser.navigation.started',
      level: 'info',
      message: `Navigation started for ${url}.`,
      source: 'electron_shell',
      detail: isInPlace ? 'In-place navigation' : 'Full navigation',
      data: {
        isInPlace,
        isMainFrame,
        url,
      },
    });
  });

  view.webContents.on('did-navigate', (_event, url) => {
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      code: 'browser.navigation.committed',
      level: 'info',
      message: `Navigation committed for ${url}.`,
      source: 'electron_shell',
      data: {
        url,
      },
    });
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return;
    }
    publishRecordedStepCapture({
      capturedAt: new Date().toISOString(),
      payload: {
        kind: 'navigate',
        title: `Navigate to ${url}`,
        url,
      },
    });
  });

  view.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }

      publishRuntimeEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        category: 'browser',
        code: 'browser.navigation.failed',
        level: 'error',
        message: `Navigation failed for ${validatedURL}.`,
        source: 'electron_shell',
        detail: `${errorCode}: ${errorDescription}`,
        data: {
          errorCode,
          errorDescription,
          validatedURL,
        },
      });
    },
  );

  view.webContents.on('render-process-gone', (_event, details) => {
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      code: 'browser.render_process.exited',
      level: 'error',
      message: 'Embedded browser render process exited unexpectedly.',
      source: 'electron_shell',
      detail: `${details.reason}${details.exitCode ? ` (${details.exitCode})` : ''}`,
      data: {
        exitCode: details.exitCode,
        reason: details.reason,
      },
    });
  });
}

function publishRuntimeEvent(event: BrowserRuntimeEvent): void {
  runtimeEvents = [event, ...runtimeEvents].slice(0, MAX_RUNTIME_EVENTS);
  runtimeHealth = deriveRuntimeHealth(
    browserSessionManager.getState(),
    runtimeEvents,
    runtimeHealth.subscriberCount,
  );

  if (mainWindow === null) {
    return;
  }

  const update: BrowserRuntimeUpdate = {
    state: browserSessionManager.getState(),
    health: runtimeHealth,
    event,
  };
  mainWindow.webContents.send('browser-runtime:event', update);
}

function publishRecordedStepCapture(input: {
  capturedAt: string;
  payload: Record<string, unknown>;
}): void {
  const eventId = randomUUID();
  publishRuntimeEvent({
    id: eventId,
    timestamp: input.capturedAt,
    category: 'replay',
    code: 'recording.step.captured',
    level: 'info',
    message:
      typeof input.payload.title === 'string'
        ? input.payload.title
        : 'Captured recorded step.',
    source: 'electron_shell',
    data: {
      capturedAt: input.capturedAt,
      capture: {
        ...input.payload,
        previousCaptureEventId: lastCapturedRuntimeEventId,
      },
    },
  });
  lastCapturedRuntimeEventId = eventId;
}

function getRuntimeDiagnostics(): BrowserRuntimeDiagnostics {
  return {
    state: browserSessionManager.getState(),
    health: runtimeHealth,
    recentEvents: runtimeEvents,
  };
}

function deriveRuntimeHealth(
  state: BrowserRuntimeState,
  events: BrowserRuntimeEvent[],
  subscriberCount: number,
): BrowserRuntimeHealth {
  let status: BrowserRuntimeHealth['status'] = 'idle';

  if (state.phase === 'idle') {
    status = 'idle';
  } else if (state.phase === 'error' || state.lastError !== null) {
    status = 'error';
  } else if (state.phase === 'running' && state.playwrightAttached && state.cdpAttached) {
    status = 'healthy';
  } else if (state.phase === 'launching' || state.phase === 'stopping') {
    status = 'degraded';
  }

  return {
    status,
    lastEventAt: events[0]?.timestamp ?? null,
    lastError:
      state.phase === 'idle'
        ? null
        : state.lastError ?? events.find((event) => event.level === 'error')?.message ?? null,
    recentEventCount: events.length,
    subscriberCount,
  };
}

bootstrapRemoteDebugging().then((port) => {
  remoteDebuggingPort = port;
  app.commandLine.appendSwitch('remote-debugging-port', String(port));
  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void browserSessionManager.stop();
});

async function bootstrapRemoteDebugging(): Promise<number> {
  const port = await allocateFreePort();
  publishRuntimeEvent({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    category: 'lifecycle',
    code: 'runtime.cdp.port_allocated',
    level: 'info',
    message: `Allocated local CDP port ${port}.`,
    source: 'electron_shell',
    data: {
      host: REMOTE_DEBUGGING_HOST,
      port,
    },
  });
  return port;
}

async function allocateFreePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, REMOTE_DEBUGGING_HOST, () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate a localhost port for the Electron CDP endpoint.');
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return address.port;
}

async function getWorkingCopyStore(): Promise<FileBackedSqliteStore> {
  if (workingCopyStorePromise !== null) {
    return workingCopyStorePromise;
  }

  workingCopyStorePromise = (async () => {
    const sql = await createSqliteEngine();
    const store = new FileBackedSqliteStore(
      sql,
      join(app.getPath('userData'), 'workspace', 'working-copy.sqlite'),
    );
    await store.open();
    return store;
  })();

  return workingCopyStorePromise;
}

function buildEmbeddedCaptureScript(): string {
  return `
    (() => {
      if (window.__browserBlackboxCaptureInstalled) {
        return;
      }
      window.__browserBlackboxCaptureInstalled = true;
      const emit = (payload) => {
        console.log('__BB_CAPTURE__' + JSON.stringify({
          timestamp: new Date().toISOString(),
          payload,
        }));
      };
      const emitInspection = (inspection) => {
        console.log('__BB_INSPECT__' + JSON.stringify({
          timestamp: new Date().toISOString(),
          inspection,
        }));
      };
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const escapeDouble = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
      const escapeSingle = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
      const selectorSchemaVersion = '${domainVersions.domainSchemaVersion}';
      const resolveLabel = (element) => {
        if ('labels' in element && element.labels && element.labels.length > 0) {
          return normalizeText(element.labels[0]?.textContent ?? '');
        }
        const id = element.getAttribute('id');
        if (!id) return '';
        const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        return label ? normalizeText(label.textContent ?? '') : '';
      };
      const resolveName = (element) => {
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return normalizeText(ariaLabel);
        const label = resolveLabel(element);
        if (label) return label;
        if ('value' in element && typeof element.value === 'string' && element.value.trim().length > 0) {
          return normalizeText(element.value);
        }
        return normalizeText(element.textContent ?? '') || normalizeText(element.getAttribute('name') ?? element.tagName.toLowerCase());
      };
      const resolveRole = (element) => {
        if (element.getAttribute('role')) return element.getAttribute('role');
        if (element.tagName === 'BUTTON') return 'button';
        if (element.tagName === 'A') return 'link';
        if (element.tagName === 'SELECT') return 'combobox';
        if (element.tagName === 'TEXTAREA') return 'textbox';
        if (element.tagName === 'INPUT') {
          const type = (element.getAttribute('type') || 'text').toLowerCase();
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          return 'textbox';
        }
        return '';
      };
      const resolveInteractiveType = (element) => {
        if (element instanceof HTMLButtonElement) return 'button';
        if (element instanceof HTMLAnchorElement) return 'link';
        if (element instanceof HTMLSelectElement) return 'select';
        if (element instanceof HTMLTextAreaElement) return 'textarea';
        if (element instanceof HTMLInputElement) {
          if (element.type === 'checkbox') return 'checkbox';
          if (element.type === 'radio') return 'radio';
          return 'input';
        }
        return 'other';
      };
      const collectAttributes = (element) => {
        return Array.from(element.attributes).reduce((record, attribute) => {
          record[attribute.name] = attribute.value;
          return record;
        }, {});
      };
      const readCenterPoint = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const isEnabled = (element) => {
        if ('disabled' in element && typeof element.disabled === 'boolean') {
          return !element.disabled;
        }
        return element.getAttribute('aria-disabled') !== 'true';
      };
      const isObscured = (element) => {
        const point = readCenterPoint(element);
        const topElement = document.elementFromPoint(point.x, point.y);
        return !!topElement && topElement !== element && !element.contains(topElement);
      };
      const buildCandidate = (locator, strategy, uniqueness, stabilityScore, reasoning, fallback) => {
        const stability =
          stabilityScore >= 90 ? 'excellent' :
          stabilityScore >= 75 ? 'good' :
          stabilityScore >= 55 ? 'risky' :
          'fragile';
        return {
          schemaVersion: selectorSchemaVersion,
          locator,
          strategy,
          uniqueness,
          stability,
          stabilityScore,
          reasoning,
          fallback,
        };
      };
      const countElements = (predicate) => {
        let total = 0;
        const elements = document.querySelectorAll('*');
        for (const entry of elements) {
          if (entry instanceof HTMLElement && predicate(entry)) {
            total += 1;
          }
        }
        return total;
      };
      const buildLocatorCandidates = (element) => {
        const candidates = [];
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
        if (testId) {
          const isDataTestId = element.getAttribute('data-testid') === testId;
          const attributeName = isDataTestId ? 'data-testid' : 'data-test';
          const uniqueness = countElements((entry) => entry.getAttribute(attributeName) === testId) === 1 ? 'unique' : 'multiple';
          candidates.push(buildCandidate(
            'page.getByTestId("' + escapeDouble(testId) + '")',
            'test-id',
            uniqueness,
            uniqueness === 'unique' ? 99 : 92,
            ['Stable explicit test contract attribute.'],
            false,
          ));
        }
        const role = resolveRole(element);
        const accessibleName = resolveName(element);
        if (role && accessibleName) {
          const uniqueness = countElements((entry) => resolveRole(entry) === role && resolveName(entry) === accessibleName) === 1 ? 'unique' : 'multiple';
          candidates.push(buildCandidate(
            'page.getByRole("' + escapeDouble(role) + '", { name: "' + escapeDouble(accessibleName) + '" })',
            'role-name',
            uniqueness,
            uniqueness === 'unique' ? 95 : 82,
            ['Accessible role and name align with user-visible semantics.'],
            candidates.length > 0,
          ));
        }
        const label = resolveLabel(element);
        if (label) {
          const uniqueness = countElements((entry) => (entry instanceof HTMLInputElement || entry instanceof HTMLTextAreaElement || entry instanceof HTMLSelectElement) && resolveLabel(entry) === label) === 1 ? 'unique' : 'multiple';
          candidates.push(buildCandidate(
            'page.getByLabel("' + escapeDouble(label) + '")',
            'label',
            uniqueness,
            uniqueness === 'unique' ? 90 : 78,
            ['Associated form label is present and readable.'],
            candidates.length > 0,
          ));
        }
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          candidates.push(buildCandidate(
            'page.getByPlaceholder("' + escapeDouble(placeholder) + '")',
            'semantic-attribute',
            'unknown',
            72,
            ['Placeholder text is available but can drift more than test IDs or labels.'],
            candidates.length > 0,
          ));
        }
        const title = element.getAttribute('title');
        if (title) {
          candidates.push(buildCandidate(
            'page.getByTitle("' + escapeDouble(title) + '")',
            'semantic-attribute',
            'unknown',
            68,
            ['Title attribute is available but may be less stable than explicit test contracts.'],
            candidates.length > 0,
          ));
        }
        const text = normalizeText(element.textContent ?? '');
        if (text && text.length <= 80) {
          const uniqueness = countElements((entry) => normalizeText(entry.textContent ?? '') === text) === 1 ? 'unique' : 'multiple';
          candidates.push(buildCandidate(
            'page.getByText("' + escapeDouble(text) + '")',
            'text',
            uniqueness,
            /\\d|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}:\\d{2}/.test(text) ? 52 : uniqueness === 'unique' ? 70 : 60,
            [/\\d|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}:\\d{2}/.test(text) ? 'Visible text appears dynamic.' : 'Visible text can be used when semantic selectors are unavailable.'],
            candidates.length > 0,
          ));
        }
        if (element.id) {
          const uniqueness = document.querySelectorAll('#' + CSS.escape(element.id)).length === 1 ? 'unique' : 'multiple';
          const looksGenerated = /\\d{4,}|[a-f0-9]{8,}|_|__|-\\d+$/.test(element.id);
          candidates.push(buildCandidate(
            'page.locator("#' + escapeDouble(element.id) + '")',
            'css',
            uniqueness,
            looksGenerated ? 48 : uniqueness === 'unique' ? 64 : 54,
            [looksGenerated ? 'ID looks generated or unstable.' : 'CSS ID fallback is available.'],
            candidates.length > 0,
          ));
        } else if ('name' in element && typeof element.name === 'string' && element.name) {
          candidates.push(buildCandidate(
            'page.locator("' + element.tagName.toLowerCase() + '[name=\\\\\\"' + escapeDouble(element.name) + '\\\\"]")',
            'css',
            'unknown',
            58,
            ['Name attribute provides a structural CSS fallback.'],
            candidates.length > 0,
          ));
        }
        return candidates.slice(0, 4);
      };
      const selectPrimaryAndFallbacks = (candidates) => {
        if (candidates.length === 0) {
          const fallback = buildCandidate(
            'page.locator("' + 'body' + '")',
            'css',
            'unknown',
            10,
            ['No stable selector candidate was found for this target yet.'],
            false,
          );
          return {
            primary: fallback,
            fallbacks: [],
          };
        }
        const [primary, ...fallbacks] = candidates;
        return {
          primary: {
            ...primary,
            fallback: false,
          },
          fallbacks: fallbacks.slice(0, 3).map((candidate) => ({
            ...candidate,
            fallback: true,
          })),
        };
      };
      const publishInspection = (element) => {
        if (!(element instanceof HTMLElement)) return;
        const recommendations = selectPrimaryAndFallbacks(buildLocatorCandidates(element));
        const rootNode = element.getRootNode();
        const labelText = resolveLabel(element);
        emitInspection({
          schemaVersion: selectorSchemaVersion,
          target: {
            tagName: element.tagName.toLowerCase(),
            textContent: normalizeText(element.textContent ?? ''),
            attributes: collectAttributes(element),
            role: resolveRole(element) || undefined,
            accessibleName: resolveName(element) || undefined,
            labelText: labelText || undefined,
            interactiveType: resolveInteractiveType(element),
          },
          recommendations,
          context: {
            testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || undefined,
            iframeDepth: window.top === window ? 0 : 1,
            iframeSource: window.frameElement instanceof HTMLIFrameElement ? window.frameElement.src || undefined : undefined,
            inShadowDom: rootNode instanceof ShadowRoot,
            visible: isVisible(element),
            enabled: isEnabled(element),
            obscured: isObscured(element),
          },
          relatedRequestIds: [],
        });
      };
      const updateInspectionOutline = (element) => {
        const existing = document.querySelector('[data-browser-blackbox-selected="true"]');
        if (existing instanceof HTMLElement) {
          existing.style.outline = '';
          existing.style.outlineOffset = '';
          existing.removeAttribute('data-browser-blackbox-selected');
        }
        if (!(element instanceof HTMLElement)) return;
        element.setAttribute('data-browser-blackbox-selected', 'true');
        element.style.outline = '2px solid rgba(231, 111, 81, 0.9)';
        element.style.outlineOffset = '2px';
      };
      const selectorFor = (element) => {
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
        if (testId) return 'page.getByTestId("' + escapeDouble(testId) + '")';
        const label = resolveLabel(element);
        if (label) return 'page.getByLabel("' + escapeDouble(label) + '")';
        const role = resolveRole(element);
        const name = resolveName(element);
        if (role && name) return 'page.getByRole("' + escapeDouble(role) + '", { name: "' + escapeDouble(name) + '" })';
        if (element.id) return 'page.locator("#' + escapeDouble(String(element.id)) + '")';
        if ('name' in element && typeof element.name === 'string' && element.name) {
          return 'page.locator("' + element.tagName.toLowerCase() + '[name=\\\"' + escapeDouble(element.name) + '\\\"]")';
        }
        return '';
      };
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const element = target.closest('button, a, [role="button"], [data-testid], [data-test], input[type="button"], input[type="submit"]');
        if (!(element instanceof HTMLElement)) return;
        const selector = selectorFor(element);
        if (!selector) return;
        emit({
          kind: 'click',
          title: 'Click ' + (resolveName(element) || element.tagName.toLowerCase()),
          selector,
        });
      }, true);
      document.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) return;
        const selector = selectorFor(target);
        if (!selector) return;
        if (target instanceof HTMLSelectElement) {
          emit({ kind: 'select-option', title: 'Select ' + resolveName(target), selector, value: target.value });
          return;
        }
        if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
          emit({ kind: 'set-checked', title: (target.checked ? 'Enable ' : 'Disable ') + resolveName(target), selector, checked: target.checked });
          return;
        }
        const sensitive = target instanceof HTMLInputElement && target.type === 'password';
        emit({
          kind: 'fill',
          title: 'Fill ' + resolveName(target),
          selector,
          value: sensitive ? '[REDACTED]' : target.value,
          sensitive,
        });
      }, true);
      document.addEventListener('click', (event) => {
        if (!event.altKey || !event.shiftKey) {
          return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        event.preventDefault();
        event.stopPropagation();
        updateInspectionOutline(target);
        publishInspection(target);
      }, true);
    })();
  `;
}
