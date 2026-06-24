import { app, BrowserView, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserSessionManager } from '@browser-blackbox/runtime-browser';
import type {
  BrowserRuntimeDiagnostics,
  BrowserRuntimeEvent,
  BrowserRuntimeHealth,
  BrowserRuntimeUpdate,
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  ManagedBrowserSurface,
  BrowserRuntimeState,
} from '@browser-blackbox/runtime-browser';

const isDev = !app.isPackaged;
const browserSessionManager = new BrowserSessionManager();
const REMOTE_DEBUGGING_HOST = '127.0.0.1';
const REMOTE_DEBUGGING_PORT = 9333;
const SIDEBAR_WIDTH = 460;
const WINDOW_PADDING = 20;
const WINDOW_TOP_OFFSET = 110;
const EMBEDDED_PANE_TITLE = 'Browser Blackbox Embedded Surface';
const MAX_RUNTIME_EVENTS = 80;

let mainWindow: BrowserWindow | null = null;
let workspaceBrowserView: BrowserView | null = null;
let runtimeEvents: BrowserRuntimeEvent[] = [];
let runtimeHealth: BrowserRuntimeHealth = {
  status: 'idle',
  lastEventAt: null,
  lastError: null,
  recentEventCount: 0,
  subscriberCount: 0,
};

app.commandLine.appendSwitch('remote-debugging-address', REMOTE_DEBUGGING_HOST);
app.commandLine.appendSwitch('remote-debugging-port', String(REMOTE_DEBUGGING_PORT));
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
      return browserSessionManager.launch(request);
    },
  );

  ipcMain.handle('browser-runtime:stop', async (): Promise<BrowserRuntimeCommandResult> => {
    const result = await browserSessionManager.stop();
    await clearWorkspaceBrowserPane();
    return result;
  });

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
  void clearWorkspaceBrowserPane();
}

function updateWorkspaceBrowserViewBounds(): void {
  if (mainWindow === null || workspaceBrowserView === null) {
    return;
  }

  const [windowWidth, windowHeight] = mainWindow.getContentSize();
  const x = SIDEBAR_WIDTH;
  const y = WINDOW_TOP_OFFSET;
  const width = Math.max(360, windowWidth - SIDEBAR_WIDTH - WINDOW_PADDING);
  const height = Math.max(320, windowHeight - WINDOW_TOP_OFFSET - WINDOW_PADDING);

  workspaceBrowserView.setBounds({ x, y, width, height });
  workspaceBrowserView.setAutoResize({ width: true, height: true });
}

function createEmbeddedSurfaceAdapter(view: BrowserView): ManagedBrowserSurface {
  return {
    getCdpEndpoint: () => `http://${REMOTE_DEBUGGING_HOST}:${REMOTE_DEBUGGING_PORT}`,
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
    const severity = level >= 2 ? 'error' : level === 1 ? 'warn' : 'info';
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'console',
      level: severity,
      message,
      detail: `${sourceId}:${line}`,
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
      level: 'info',
      message: `Navigation started for ${url}.`,
      detail: isInPlace ? 'In-place navigation' : 'Full navigation',
    });
  });

  view.webContents.on('did-navigate', (_event, url) => {
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      level: 'info',
      message: `Navigation committed for ${url}.`,
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
        level: 'error',
        message: `Navigation failed for ${validatedURL}.`,
        detail: `${errorCode}: ${errorDescription}`,
      });
    },
  );

  view.webContents.on('render-process-gone', (_event, details) => {
    publishRuntimeEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: 'browser',
      level: 'error',
      message: 'Embedded browser render process exited unexpectedly.',
      detail: `${details.reason}${details.exitCode ? ` (${details.exitCode})` : ''}`,
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

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
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
