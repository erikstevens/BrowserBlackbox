import type { StoredRunSnapshot } from '@browser-blackbox/persistence/src/contracts';
import type { RedactionRule } from '@browser-blackbox/domain';
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
  getInspectionMode: () => Promise<boolean>;
  launchBrowserSession: (
    request: BrowserLaunchRequest,
  ) => Promise<BrowserRuntimeCommandResult>;
  runReplay: (request: BrowserReplayRequest) => Promise<BrowserReplayCommandResult>;
  setInspectionMode: (enabled: boolean) => Promise<boolean>;
  setRedactionRules: (rules: RedactionRule[]) => Promise<void>;
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
