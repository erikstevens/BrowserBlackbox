import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { BrowserSessionManager } from '@browser-blackbox/runtime-browser';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeState,
} from '@browser-blackbox/runtime-browser';

const isDev = !app.isPackaged;
const browserSessionManager = new BrowserSessionManager();

function createWindow(): void {
  const window = new BrowserWindow({
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

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
    window.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  void window.loadFile(join(__dirname, '../renderer/index.html'));
}

function registerIpcHandlers(): void {
  ipcMain.handle('browser-runtime:get-state', async (): Promise<BrowserRuntimeState> => {
    return browserSessionManager.getState();
  });

  ipcMain.handle(
    'browser-runtime:launch',
    async (_event, request: BrowserLaunchRequest): Promise<BrowserRuntimeCommandResult> => {
      return browserSessionManager.launch(request);
    },
  );

  ipcMain.handle('browser-runtime:stop', async (): Promise<BrowserRuntimeCommandResult> => {
    return browserSessionManager.stop();
  });
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
