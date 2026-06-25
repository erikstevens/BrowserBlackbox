import type { StoredRunSnapshot } from '@browser-blackbox/persistence/src/contracts';
import type {
  BrowserRuntimeDiagnostics,
  BrowserLaunchRequest,
  BrowserReplayCommandResult,
  BrowserReplayRequest,
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
  runReplay: (request: BrowserReplayRequest) => Promise<BrowserReplayCommandResult>;
  stopBrowserSession: () => Promise<BrowserRuntimeCommandResult>;
  loadWorkingCopySnapshot: () => Promise<StoredRunSnapshot | null>;
  saveWorkingCopySnapshot: (snapshot: StoredRunSnapshot) => Promise<void>;
  onBrowserRuntimeEvent: (listener: (update: BrowserRuntimeUpdate) => void) => () => void;
};

declare global {
  interface Window {
    desktopShell: DesktopShellApi;
  }
}

export {};
