import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopShellApi } from './types';

const desktopShellApi: DesktopShellApi = {
  version: '0.1.0',
  getBrowserRuntimeState: () => ipcRenderer.invoke('browser-runtime:get-state'),
  getBrowserRuntimeDiagnostics: () => ipcRenderer.invoke('browser-runtime:get-diagnostics'),
  getInspectionMode: () => ipcRenderer.invoke('browser-runtime:get-inspection-mode'),
  launchBrowserSession: (request) => ipcRenderer.invoke('browser-runtime:launch', request),
  runReplay: (request) => ipcRenderer.invoke('browser-runtime:replay', request),
  setInspectionMode: (enabled) => ipcRenderer.invoke('browser-runtime:set-inspection-mode', enabled),
  setRedactionRules: (rules) => ipcRenderer.invoke('browser-runtime:set-redaction-rules', rules),
  stopBrowserSession: () => ipcRenderer.invoke('browser-runtime:stop'),
  loadWorkingCopySnapshot: () => ipcRenderer.invoke('workspace:load-working-copy'),
  saveWorkingCopySnapshot: (snapshot) =>
    ipcRenderer.invoke('workspace:save-working-copy', snapshot),
  assessArtifactExport: (snapshot) =>
    ipcRenderer.invoke('workspace:assess-artifact-export', snapshot),
  reopenArtifactBundle: (rootDirectory) =>
    ipcRenderer.invoke('workspace:reopen-artifact-bundle', rootDirectory),
  exportArtifactBundle: (request) =>
    ipcRenderer.invoke('workspace:export-artifact-bundle', request),
  onBrowserRuntimeEvent: (listener) => {
    const handleRuntimeEvent = (_event: Electron.IpcRendererEvent, update: Parameters<typeof listener>[0]) => {
      listener(update);
    };
    const handleDiagnosticsSync = (
      _event: Electron.IpcRendererEvent,
      diagnostics: Awaited<ReturnType<DesktopShellApi['getBrowserRuntimeDiagnostics']>>,
    ) => {
      for (const event of [...diagnostics.recentEvents].reverse()) {
        listener({
          state: diagnostics.state,
          health: diagnostics.health,
          event,
        });
      }
    };

    ipcRenderer.on('browser-runtime:event', handleRuntimeEvent);
    ipcRenderer.on('browser-runtime:diagnostics-sync', handleDiagnosticsSync);
    ipcRenderer.send('browser-runtime:subscribe');

    return () => {
      ipcRenderer.removeListener('browser-runtime:event', handleRuntimeEvent);
      ipcRenderer.removeListener('browser-runtime:diagnostics-sync', handleDiagnosticsSync);
      ipcRenderer.send('browser-runtime:unsubscribe');
    };
  },
};

contextBridge.exposeInMainWorld('desktopShell', desktopShellApi);
