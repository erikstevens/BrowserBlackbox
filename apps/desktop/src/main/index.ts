import { app, BrowserView, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { BrowserSessionManager } from '@browser-blackbox/runtime-browser';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeState,
} from '@browser-blackbox/runtime-browser';

const isDev = !app.isPackaged;
const browserSessionManager = new BrowserSessionManager();
const SIDEBAR_WIDTH = 460;
const WINDOW_PADDING = 20;
const WINDOW_TOP_OFFSET = 110;

let mainWindow: BrowserWindow | null = null;
let workspaceBrowserView: BrowserView | null = null;

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

  ipcMain.handle(
    'browser-runtime:launch',
    async (_event, request: BrowserLaunchRequest): Promise<BrowserRuntimeCommandResult> => {
      const result = await browserSessionManager.launch(request);
      await loadWorkspaceBrowserPane(request.targetUrl);
      return result;
    },
  );

  ipcMain.handle('browser-runtime:stop', async (): Promise<BrowserRuntimeCommandResult> => {
    const result = await browserSessionManager.stop();
    await clearWorkspaceBrowserPane();
    return result;
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

  window.setBrowserView(workspaceBrowserView);
  workspaceBrowserView.setBackgroundColor('#101922');
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

async function loadWorkspaceBrowserPane(targetUrl: string): Promise<void> {
  if (workspaceBrowserView === null) {
    return;
  }

  await workspaceBrowserView.webContents.loadURL(targetUrl);
}

async function clearWorkspaceBrowserPane(): Promise<void> {
  if (workspaceBrowserView === null) {
    return;
  }

  const html = `
    <html>
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
