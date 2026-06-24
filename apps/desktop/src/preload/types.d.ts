import type {
  BrowserRuntimeDiagnostics,
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeState,
  BrowserRuntimeUpdate,
} from '@browser-blackbox/runtime-browser';

export type DesktopShellApi = {
  version: string;
  getBrowserRuntimeState: () => Promise<BrowserRuntimeState>;
  getBrowserRuntimeDiagnostics: () => Promise<BrowserRuntimeDiagnostics>;
  launchBrowserSession: (
    request: BrowserLaunchRequest,
  ) => Promise<BrowserRuntimeCommandResult>;
  stopBrowserSession: () => Promise<BrowserRuntimeCommandResult>;
  onBrowserRuntimeEvent: (listener: (update: BrowserRuntimeUpdate) => void) => () => void;
};

declare global {
  interface Window {
    desktopShell: DesktopShellApi;
  }
}

export {};
