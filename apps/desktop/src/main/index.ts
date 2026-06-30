import { app, BrowserView, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { domainVersions, parseInspectionMetadata, parseRedactionRule } from '@browser-blackbox/domain';
import {
  generateApiRequestFixture,
  generatePlaywrightApiTest,
  generatePlaywrightUiTest,
} from '@browser-blackbox/export';
import { FileBackedSqliteStore } from '@browser-blackbox/persistence/src/file-store';
import type {
  ArtifactBundleExportResult,
  ArtifactExportMode,
  ArtifactExportSafetyAssessment,
  StoredRunSnapshot,
} from '@browser-blackbox/persistence/src/contracts';
import {
  assessArtifactExportSafety,
  prepareSnapshotForArtifactExport,
  writeArtifactBundle,
} from '@browser-blackbox/persistence';
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
let inspectionModeEnabled = false;
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

  ipcMain.handle('browser-runtime:get-inspection-mode', async (): Promise<boolean> => {
    return inspectionModeEnabled;
  });

  ipcMain.handle('browser-runtime:get-diagnostics', async (): Promise<BrowserRuntimeDiagnostics> => {
    return getRuntimeDiagnostics();
  });

  ipcMain.handle(
    'browser-runtime:launch',
    async (_event, request: BrowserLaunchRequest): Promise<BrowserRuntimeCommandResult> => {
      lastCapturedRuntimeEventId = null;
      inspectionModeEnabled = false;
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
    inspectionModeEnabled = false;
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
    'browser-runtime:set-inspection-mode',
    async (_event, enabled: boolean): Promise<boolean> => {
      inspectionModeEnabled = enabled;
      await applyInspectionModeToEmbeddedPane(enabled);
      publishRuntimeEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        category: 'browser',
        code: 'inspection.mode.changed',
        level: 'info',
        message: enabled ? 'Inspection mode enabled.' : 'Inspection mode disabled.',
        source: 'electron_shell',
        data: {
          enabled,
        },
      });
      return inspectionModeEnabled;
    },
  );

  ipcMain.handle(
    'browser-runtime:set-redaction-rules',
    async (_event, rules: unknown[]): Promise<void> => {
      browserSessionManager.setRedactionRules(rules.map((rule) => parseRedactionRule(rule)));
    },
  );

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

  ipcMain.handle(
    'workspace:assess-artifact-export',
    async (_event, snapshot: StoredRunSnapshot): Promise<ArtifactExportSafetyAssessment> => {
      return assessArtifactExportSafety(snapshot);
    },
  );

  ipcMain.handle(
    'workspace:export-artifact-bundle',
    async (
      _event,
      request: {
        snapshot: StoredRunSnapshot;
        mode: ArtifactExportMode;
      },
    ): Promise<ArtifactBundleExportResult> => {
      const exportDirectory = await mkdtemp(
        join(app.getPath('temp'), 'browser-blackbox-export-'),
      );
      const prepared = prepareSnapshotForArtifactExport(request.snapshot, request.mode);
      const exportSnapshot = createExportArtifactSnapshot(prepared.snapshot);

      await writeArtifactBundle({
        rootDirectory: exportDirectory,
        snapshot: exportSnapshot,
        artifactContents: createExportArtifactContents(exportSnapshot, prepared.assessment, request.mode),
      });

      return {
        assessment: prepared.assessment,
        mode: request.mode,
        rootDirectory: exportDirectory,
      };
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

    if (message.startsWith('__BB_INSPECT_MODE__')) {
      try {
        const payload = JSON.parse(message.slice('__BB_INSPECT_MODE__'.length)) as {
          enabled?: boolean;
          timestamp?: string;
        };
        if (typeof payload.enabled === 'boolean') {
          inspectionModeEnabled = payload.enabled;
          publishRuntimeEvent({
            id: randomUUID(),
            timestamp: payload.timestamp ?? new Date().toISOString(),
            category: 'browser',
            code: 'inspection.mode.changed',
            level: 'info',
            message: payload.enabled
              ? 'Inspection mode enabled.'
              : 'Inspection mode disabled.',
            source: 'electron_shell',
            data: {
              enabled: payload.enabled,
            },
          });
        }
      } catch (error) {
        publishRuntimeEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          category: 'console',
          code: 'inspection.mode.parse_failed',
          level: 'warn',
          message: 'Failed to parse embedded inspection mode payload.',
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

    void view.webContents
      .executeJavaScript(buildEmbeddedCaptureScript(inspectionModeEnabled))
      .catch((error) => {
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

function createExportArtifactSnapshot(snapshot: StoredRunSnapshot): StoredRunSnapshot {
  const generatedUiTest = generatePlaywrightUiTest({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
  });
  const generatedApiTest = generatePlaywrightApiTest({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
    captures: snapshot.captures,
  });
  const generatedApiFixture = generateApiRequestFixture({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
    captures: snapshot.captures,
  });

  return {
    ...snapshot,
    manifest: {
      ...snapshot.manifest,
      artifacts: [
        {
          path: generatedUiTest.fileName,
          kind: 'generated-test',
          required: false,
          present: true,
        },
        {
          path: generatedApiTest.fileName,
          kind: 'generated-test',
          required: false,
          present: true,
        },
        {
          path: generatedApiFixture.fileName,
          kind: 'fixture',
          required: false,
          present: true,
        },
        {
          path: 'workspace/replay-metadata.json',
          kind: 'replay-metadata',
          required: false,
          present: true,
        },
        {
          path: 'logs/timeline.json',
          kind: 'timeline',
          required: false,
          present: true,
        },
        {
          path: 'network/api-capture.json',
          kind: 'api-capture',
          required: false,
          present: true,
        },
        {
          path: 'reports/export-safety.json',
          kind: 'report',
          required: false,
          present: true,
        },
        {
          path: 'reports/summary.md',
          kind: 'report',
          required: false,
          present: true,
        },
      ],
    },
  };
}

function createExportArtifactContents(
  snapshot: StoredRunSnapshot,
  assessment: ArtifactExportSafetyAssessment,
  mode: ArtifactExportMode,
): Record<string, string> {
  const generatedUiTest = generatePlaywrightUiTest({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
  });
  const generatedApiTest = generatePlaywrightApiTest({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
    captures: snapshot.captures,
  });
  const generatedApiFixture = generateApiRequestFixture({
    flowTitle: snapshot.steps[0]?.title ? `${snapshot.steps[0].title} flow` : undefined,
    steps: snapshot.steps,
    captures: snapshot.captures,
  });

  return {
    [generatedUiTest.fileName]: generatedUiTest.code,
    [generatedApiTest.fileName]: generatedApiTest.code,
    [generatedApiFixture.fileName]: generatedApiFixture.code,
    'workspace/replay-metadata.json': `${JSON.stringify(
      {
        runId: snapshot.session.runId,
        targetUrl: snapshot.session.targetUrl,
        exportedAt: new Date().toISOString(),
        redactionPolicyVersion: snapshot.manifest.redactionPolicyVersion,
        generatedUiTestWarnings: generatedUiTest.warnings,
        generatedApiTestWarnings: generatedApiTest.warnings,
        generatedApiFixtureWarnings: generatedApiFixture.warnings,
      },
      null,
      2,
    )}\n`,
    'logs/timeline.json': `${JSON.stringify({ timeline: snapshot.timeline }, null, 2)}\n`,
    'network/api-capture.json': `${JSON.stringify({ captures: snapshot.captures }, null, 2)}\n`,
    'reports/export-safety.json': `${JSON.stringify(
      {
        mode,
        warningCount: assessment.warningCount,
        findings: assessment.findings,
      },
      null,
      2,
    )}\n`,
    'reports/summary.md': createExportSummaryReport(snapshot, assessment, mode),
  };
}

function createExportSummaryReport(
  snapshot: StoredRunSnapshot,
  assessment: ArtifactExportSafetyAssessment,
  mode: ArtifactExportMode,
): string {
  return [
    '# QA Browser Shell Export Summary',
    '',
    `- Run ID: ${snapshot.session.runId}`,
    `- Target URL: ${snapshot.session.targetUrl}`,
    `- Export mode: ${mode}`,
    `- Warning count: ${assessment.warningCount}`,
    '',
    assessment.warningCount === 0
      ? 'No export-safety warnings were detected.'
      : 'Visible-body export warnings were detected and recorded in `reports/export-safety.json`.',
    '',
  ].join('\n');
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

async function applyInspectionModeToEmbeddedPane(enabled: boolean): Promise<void> {
  if (workspaceBrowserView === null) {
    return;
  }

  const currentUrl = workspaceBrowserView.webContents.getURL();
  if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
    return;
  }

  await workspaceBrowserView.webContents.executeJavaScript(buildInspectionModeScript(enabled));
}

function buildInspectionModeScript(enabled: boolean): string {
  return `
    (() => {
      window.__browserBlackboxSetInspectMode?.(${enabled ? 'true' : 'false'}, { silent: true });
    })();
  `;
}

function buildEmbeddedCaptureScript(initialInspectionModeEnabled: boolean): string {
  return `
    (() => {
      if (window.__browserBlackboxCaptureInstalled) {
        window.__browserBlackboxSetInspectMode?.(${initialInspectionModeEnabled ? 'true' : 'false'});
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
      const emitInspectionMode = (enabled) => {
        console.log('__BB_INSPECT_MODE__' + JSON.stringify({
          timestamp: new Date().toISOString(),
          enabled,
        }));
      };
      const overlayId = '__browser_blackbox_inspector_overlay__';
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const escapeDouble = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
      const selectorSchemaVersion = '${domainVersions.domainSchemaVersion}';
      const strategyPriority = {
        'test-id': 0,
        'role-name': 1,
        label: 2,
        'semantic-attribute': 3,
        text: 4,
        css: 5,
        xpath: 6,
      };
      const instrumentedDocuments = new WeakSet();
      const observedDocuments = new WeakSet();
      const instrumentedFrames = new WeakSet();
      let inspectionModeEnabled = false;
      let selectedElement = null;
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
      const resolveFrameContext = (targetWindow) => {
        let depth = 0;
        let currentWindow = targetWindow;
        let iframeSource;
        while (currentWindow && currentWindow !== currentWindow.top) {
          depth += 1;
          const frameElement = currentWindow.frameElement;
          if (!iframeSource && frameElement instanceof HTMLIFrameElement) {
            iframeSource =
              frameElement.getAttribute('src') ||
              frameElement.getAttribute('title') ||
              frameElement.getAttribute('name') ||
              'same-origin iframe';
          }
          try {
            currentWindow = currentWindow.parent;
          } catch {
            break;
          }
        }
        return {
          iframeDepth: depth,
          iframeSource,
        };
      };
      const looksDynamicText = (value) => {
        const normalized = normalizeText(value);
        return /(?:\\b\\d+\\b|\\d{1,2}:\\d{2}(?::\\d{2})?|\\d{4}-\\d{2}-\\d{2}|today|yesterday|seconds?|minutes?|hours?|items?|rows?|orders?)/i.test(normalized);
      };
      const looksGeneratedToken = (value) => {
        const normalized = String(value ?? '');
        return /(?:[a-f0-9]{8,}|__|[_-]\\d{3,}|css-[a-z0-9]+|chakra-|Mui|ember|react-select|svelte-|astro-|vue-)/i.test(normalized);
      };
      const computeDomDepth = (element) => {
        let depth = 0;
        let current = element.parentElement;
        while (current) {
          depth += 1;
          current = current.parentElement;
        }
        return depth;
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
      const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));
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
      const createRankedCandidate = (element, input) => {
        let score = input.baseScore;
        const reasons = [...input.reasons];
        const domDepth = computeDomDepth(element);
        const frameContext = resolveFrameContext(element.ownerDocument.defaultView);
        const className = typeof element.className === 'string' ? element.className : '';
        if (input.uniqueness === 'multiple') {
          score -= 8;
          reasons.push('Candidate is not unique in the current DOM.');
        }
        if (input.dynamicText) {
          score -=
            input.strategy === 'role-name'
              ? 24
              : input.strategy === 'text'
                ? 20
                : 16;
          reasons.push('Visible or accessible text appears dynamic.');
        }
        if (domDepth >= 8 && input.strategy !== 'test-id' && input.strategy !== 'role-name') {
          score -= Math.min(12, domDepth - 7);
          reasons.push('Deep DOM nesting increases selector fragility.');
        }
        if (className && looksGeneratedToken(className) && input.strategy === 'css') {
          score -= 10;
          reasons.push('Classes look generated or framework-scoped.');
        }
        if (element.id && looksGeneratedToken(element.id) && input.strategy === 'css') {
          score -= 14;
          reasons.push('ID looks auto-generated or unstable.');
        }
        if (element.getRootNode() instanceof ShadowRoot) {
          score -= 8;
          reasons.push('Target sits inside Shadow DOM.');
        }
        if (frameContext.iframeDepth > 0) {
          score -= Math.min(14, frameContext.iframeDepth * 6);
          reasons.push('Target is inside an iframe.');
        }
        return buildCandidate(
          input.locator,
          input.strategy,
          input.uniqueness,
          clampScore(score),
          Array.from(new Set(reasons)),
          input.fallback,
        );
      };
      const extractLocatorMethodCall = (locator) => {
        const pagePrefix = 'page.';
        if (!locator.startsWith(pagePrefix)) {
          return null;
        }
        return locator.slice(pagePrefix.length);
      };
      const buildLocatorCandidates = (element) => {
        const candidates = [];
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
        if (testId) {
          const isDataTestId = element.getAttribute('data-testid') === testId;
          const attributeName = isDataTestId ? 'data-testid' : 'data-test';
          const uniqueness = countElements((entry) => entry.getAttribute(attributeName) === testId) === 1 ? 'unique' : 'multiple';
          candidates.push(createRankedCandidate(element, {
            locator: 'page.getByTestId("' + escapeDouble(testId) + '")',
            strategy: 'test-id',
            uniqueness,
            baseScore: uniqueness === 'unique' ? 99 : 92,
            reasons: ['Stable explicit test contract attribute.'],
            dynamicText: false,
            fallback: false,
          }));
        }
        const role = resolveRole(element);
        const accessibleName = resolveName(element);
        if (role && accessibleName) {
          const uniqueness = countElements((entry) => resolveRole(entry) === role && resolveName(entry) === accessibleName) === 1 ? 'unique' : 'multiple';
          candidates.push(createRankedCandidate(element, {
            locator:
              'page.getByRole("' +
              escapeDouble(role) +
              '", { name: "' +
              escapeDouble(accessibleName) +
              '" })',
            strategy: 'role-name',
            uniqueness,
            baseScore: uniqueness === 'unique' ? 95 : 82,
            reasons: ['Accessible role and name align with user-visible semantics.'],
            dynamicText: looksDynamicText(accessibleName),
            fallback: candidates.length > 0,
          }));
        }
        const label = resolveLabel(element);
        if (label) {
          const uniqueness = countElements((entry) => (entry instanceof HTMLInputElement || entry instanceof HTMLTextAreaElement || entry instanceof HTMLSelectElement) && resolveLabel(entry) === label) === 1 ? 'unique' : 'multiple';
          candidates.push(createRankedCandidate(element, {
            locator: 'page.getByLabel("' + escapeDouble(label) + '")',
            strategy: 'label',
            uniqueness,
            baseScore: uniqueness === 'unique' ? 90 : 78,
            reasons: ['Associated form label is present and readable.'],
            dynamicText: looksDynamicText(label),
            fallback: candidates.length > 0,
          }));
        }
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) {
          candidates.push(createRankedCandidate(element, {
            locator: 'page.getByPlaceholder("' + escapeDouble(placeholder) + '")',
            strategy: 'semantic-attribute',
            uniqueness: 'unknown',
            baseScore: 72,
            reasons: ['Placeholder text is available but can drift more than test IDs or labels.'],
            dynamicText: looksDynamicText(placeholder),
            fallback: candidates.length > 0,
          }));
        }
        const title = element.getAttribute('title');
        if (title) {
          candidates.push(createRankedCandidate(element, {
            locator: 'page.getByTitle("' + escapeDouble(title) + '")',
            strategy: 'semantic-attribute',
            uniqueness: 'unknown',
            baseScore: 68,
            reasons: ['Title attribute is available but may be less stable than explicit test contracts.'],
            dynamicText: looksDynamicText(title),
            fallback: candidates.length > 0,
          }));
        }
        const text = normalizeText(element.textContent ?? '');
        if (text && text.length <= 80) {
          const uniqueness = countElements((entry) => normalizeText(entry.textContent ?? '') === text) === 1 ? 'unique' : 'multiple';
          candidates.push(createRankedCandidate(element, {
            locator: 'page.getByText("' + escapeDouble(text) + '")',
            strategy: 'text',
            uniqueness,
            baseScore: uniqueness === 'unique' ? 70 : 60,
            reasons: ['Visible text can be used when semantic selectors are unavailable.'],
            dynamicText: looksDynamicText(text),
            fallback: candidates.length > 0,
          }));
        }
        if (element.id) {
          const uniqueness = document.querySelectorAll('#' + CSS.escape(element.id)).length === 1 ? 'unique' : 'multiple';
          candidates.push(createRankedCandidate(element, {
            locator: 'page.locator("#' + escapeDouble(element.id) + '")',
            strategy: 'css',
            uniqueness,
            baseScore: uniqueness === 'unique' ? 64 : 54,
            reasons: ['CSS ID fallback is available.'],
            dynamicText: false,
            fallback: candidates.length > 0,
          }));
        } else if ('name' in element && typeof element.name === 'string' && element.name) {
          candidates.push(createRankedCandidate(element, {
            locator:
              'page.locator("' +
              element.tagName.toLowerCase() +
              '[name=\\\\\\"' +
              escapeDouble(element.name) +
              '\\\\"]")',
            strategy: 'css',
            uniqueness: 'unknown',
            baseScore: 58,
            reasons: ['Name attribute provides a structural CSS fallback.'],
            dynamicText: looksDynamicText(element.name),
            fallback: candidates.length > 0,
          }));
        }
        const uniqueCandidates = [];
        const seen = new Set();
        for (const candidate of candidates) {
          if (seen.has(candidate.locator)) {
            continue;
          }
          seen.add(candidate.locator);
          uniqueCandidates.push(candidate);
        }
        return uniqueCandidates
          .sort((left, right) => {
            return (
              strategyPriority[left.strategy] - strategyPriority[right.strategy] ||
              right.stabilityScore - left.stabilityScore ||
              left.locator.localeCompare(right.locator)
            );
          })
          .slice(0, 4);
      };
      const buildStableParentRecommendation = (element) => {
        let current = element.parentElement;
        while (current) {
          const currentRole = resolveRole(current);
          const currentName = resolveName(current);
          const parentCandidates = buildLocatorCandidates(current).filter(
            (candidate) =>
              candidate.uniqueness === 'unique' &&
              candidate.stabilityScore >= 72 &&
              candidate.strategy !== 'text',
          );
          const preferred = parentCandidates[0];
          if (
            preferred &&
            (
              current.hasAttribute('data-testid') ||
              current.hasAttribute('data-test') ||
              ['article', 'section', 'form', 'li', 'tr', 'fieldset', 'dialog'].includes(
                current.tagName.toLowerCase(),
              ) ||
              (currentRole && currentName)
            )
          ) {
            return {
              locator: preferred.locator,
              strategy: preferred.strategy,
              reasoning: [
                'Nearest parent container is unique enough to anchor a chained locator.',
                ...preferred.reasoning,
              ],
            };
          }
          current = current.parentElement;
        }
        return undefined;
      };
      const buildChainedCandidate = (stableParent, childCandidate) => {
        const childMethodCall = extractLocatorMethodCall(childCandidate.locator);
        if (!stableParent || !childMethodCall || childCandidate.uniqueness === 'unique') {
          return undefined;
        }
        const baseScore = Math.min(
          97,
          Math.max(childCandidate.stabilityScore + 18, stableParent.strategy === 'test-id' ? 94 : 88),
        );
        return buildCandidate(
          stableParent.locator + '.' + childMethodCall,
          childCandidate.strategy,
          'unique',
          baseScore,
          [
            'Repeated child target is scoped to the nearest stable parent container.',
            ...stableParent.reasoning,
            ...childCandidate.reasoning,
          ],
          false,
        );
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
      const ensureOverlay = (targetDocument = document) => {
        let overlay = targetDocument.getElementById(overlayId);
        if (overlay instanceof HTMLDivElement) {
          return overlay;
        }
        overlay = targetDocument.createElement('div');
        overlay.id = overlayId;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483647';
        overlay.style.display = 'none';
        overlay.innerHTML = [
          '<div data-bb-box="true" style="position:fixed;border:2px solid rgba(231,111,81,0.95);background:rgba(231,111,81,0.08);box-shadow:0 0 0 1px rgba(15,23,32,0.85);"></div>',
          '<div data-bb-label="true" style="position:fixed;max-width:420px;padding:8px 12px;border-radius:12px;background:rgba(15,23,32,0.96);color:#f4f1ea;font:12px/1.45 IBM Plex Sans,system-ui,sans-serif;letter-spacing:0.04em;box-shadow:0 12px 32px rgba(0,0,0,0.28);"></div>',
        ].join('');
        targetDocument.documentElement.appendChild(overlay);
        return overlay;
      };
      const hideOverlay = (targetDocument = document) => {
        const overlay = ensureOverlay(targetDocument);
        overlay.style.display = 'none';
      };
      const hideOverlaysRecursively = (targetDocument = document) => {
        hideOverlay(targetDocument);
        for (const frame of targetDocument.querySelectorAll('iframe')) {
          try {
            if (frame.contentDocument) {
              hideOverlaysRecursively(frame.contentDocument);
            }
          } catch {
            // Cross-origin frame access is intentionally ignored.
          }
        }
      };
      const renderOverlay = (element, inspection, modeLabel) => {
        const targetDocument = element.ownerDocument;
        const overlay = ensureOverlay(targetDocument);
        const box = overlay.querySelector('[data-bb-box="true"]');
        const label = overlay.querySelector('[data-bb-label="true"]');
        if (!(box instanceof HTMLDivElement) || !(label instanceof HTMLDivElement)) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const targetWindow = targetDocument.defaultView || window;
        overlay.style.display = 'block';
        box.style.left = rect.left + 'px';
        box.style.top = rect.top + 'px';
        box.style.width = Math.max(rect.width, 0) + 'px';
        box.style.height = Math.max(rect.height, 0) + 'px';
        label.textContent = [
          modeLabel,
          inspection.recommendations.primary.locator,
          inspection.recommendations.primary.stability + ' ' + inspection.recommendations.primary.stabilityScore + '/100',
        ].join(' · ');
        const labelTop = rect.top > 52 ? rect.top - 42 : rect.bottom + 10;
        const labelLeft = Math.min(rect.left, Math.max(12, targetWindow.innerWidth - 432));
        label.style.left = labelLeft + 'px';
        label.style.top = Math.max(12, labelTop) + 'px';
      };
      const publishInspection = (element) => {
        if (!(element instanceof HTMLElement)) return;
        const stableParent = buildStableParentRecommendation(element);
        const baseCandidates = buildLocatorCandidates(element);
        const chainedCandidates = stableParent
          ? baseCandidates
              .map((candidate) => buildChainedCandidate(stableParent, candidate))
              .filter((candidate) => candidate !== undefined)
          : [];
        const recommendations = selectPrimaryAndFallbacks(
          [...chainedCandidates, ...baseCandidates].sort((left, right) => {
            return (
              strategyPriority[left.strategy] - strategyPriority[right.strategy] ||
              right.stabilityScore - left.stabilityScore ||
              left.locator.localeCompare(right.locator)
            );
          }),
        );
        const rootNode = element.getRootNode();
        const labelText = resolveLabel(element);
        const frameContext = resolveFrameContext(element.ownerDocument.defaultView);
        const inspection = {
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
          stableParent,
          context: {
            testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || undefined,
            iframeDepth: frameContext.iframeDepth,
            iframeSource: frameContext.iframeSource,
            inShadowDom: rootNode instanceof ShadowRoot,
            visible: isVisible(element),
            enabled: isEnabled(element),
            obscured: isObscured(element),
          },
          relatedRequestIds: [],
        };
        renderOverlay(element, inspection, selectedElement === element ? 'Selected' : 'Inspecting');
        emitInspection(inspection);
      };
      const isInspectableTarget = (target) => {
        return target instanceof HTMLElement && target.id !== overlayId && !target.closest('#' + overlayId);
      };
      const handleInspectHover = (event) => {
        if (!inspectionModeEnabled) {
          return;
        }
        const target = event.target;
        if (!isInspectableTarget(target)) return;
        publishInspection(target);
      };
      const handleInspectClick = (event) => {
        if (!inspectionModeEnabled) {
          return;
        }
        const target = event.target;
        if (!isInspectableTarget(target)) return;
        event.preventDefault();
        event.stopPropagation();
        selectedElement = target;
        publishInspection(target);
      };
      const handleInspectKeydown = (event) => {
        if (event.key === 'Escape' && inspectionModeEnabled) {
          window.__browserBlackboxSetInspectMode?.(false);
        }
      };
      const observeFrameAttachments = (targetDocument) => {
        if (observedDocuments.has(targetDocument)) {
          return;
        }
        observedDocuments.add(targetDocument);
        const observer = new MutationObserver(() => {
          instrumentSameOriginFrames(targetDocument);
        });
        observer.observe(targetDocument.documentElement || targetDocument.body, {
          childList: true,
          subtree: true,
        });
      };
      const attachInspectionDocument = (targetDocument) => {
        if (instrumentedDocuments.has(targetDocument)) {
          return;
        }
        instrumentedDocuments.add(targetDocument);
        targetDocument.addEventListener('mousemove', handleInspectHover, true);
        targetDocument.addEventListener('click', handleInspectClick, true);
        targetDocument.addEventListener('keydown', handleInspectKeydown, true);
        instrumentSameOriginFrames(targetDocument);
        observeFrameAttachments(targetDocument);
      };
      const instrumentSameOriginFrames = (targetDocument) => {
        for (const frame of targetDocument.querySelectorAll('iframe')) {
          if (instrumentedFrames.has(frame)) {
            continue;
          }
          instrumentedFrames.add(frame);
          const attachFrame = () => {
            try {
              if (frame.contentDocument) {
                attachInspectionDocument(frame.contentDocument);
              }
            } catch {
              // Cross-origin frame access is intentionally ignored.
            }
          };
          frame.addEventListener('load', attachFrame);
          attachFrame();
        }
      };
      window.__browserBlackboxSetInspectMode = (enabled, options = {}) => {
        inspectionModeEnabled = enabled;
        selectedElement = enabled ? selectedElement : null;
        document.body.style.cursor = enabled ? 'crosshair' : '';
        if (!enabled) {
          hideOverlaysRecursively(document);
        }
        if (options.silent !== true) {
          emitInspectionMode(enabled);
        }
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
      attachInspectionDocument(document);
      window.__browserBlackboxSetInspectMode?.(${initialInspectionModeEnabled ? 'true' : 'false'});
    })();
  `;
}
