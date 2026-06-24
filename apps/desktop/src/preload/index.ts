import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('desktopShell', {
  version: '0.1.0',
});
