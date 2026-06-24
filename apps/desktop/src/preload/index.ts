import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopShellApi } from './types';

const desktopShellApi: DesktopShellApi = {
  version: '0.1.0',
  getBrowserRuntimeState: () => ipcRenderer.invoke('browser-runtime:get-state'),
  launchBrowserSession: (request) => ipcRenderer.invoke('browser-runtime:launch', request),
  stopBrowserSession: () => ipcRenderer.invoke('browser-runtime:stop'),
};

contextBridge.exposeInMainWorld('desktopShell', desktopShellApi);
