import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeState,
} from '@browser-blackbox/runtime-browser';

export type DesktopShellApi = {
  version: string;
  getBrowserRuntimeState: () => Promise<BrowserRuntimeState>;
  launchBrowserSession: (
    request: BrowserLaunchRequest,
  ) => Promise<BrowserRuntimeCommandResult>;
  stopBrowserSession: () => Promise<BrowserRuntimeCommandResult>;
};

declare global {
  interface Window {
    desktopShell: DesktopShellApi;
  }
}

export {};
