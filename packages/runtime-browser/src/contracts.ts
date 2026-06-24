export type BrowserRuntimePhase =
  | 'idle'
  | 'launching'
  | 'running'
  | 'stopping'
  | 'error';

export type BrowserLaunchRequest = {
  targetUrl: string;
};

export type BrowserRuntimeState = {
  phase: BrowserRuntimePhase;
  targetUrl: string | null;
  pageUrl: string | null;
  sessionId: string | null;
  cdpAttached: boolean;
  lastError: string | null;
};

export type BrowserRuntimeCommandResult = {
  state: BrowserRuntimeState;
};

export type ManagedBrowserSurface = {
  attachDebugger: (protocolVersion: string) => void;
  detachDebugger: () => void;
  getURL: () => string;
  isDebuggerAttached: () => boolean;
  loadURL: (targetUrl: string) => Promise<void>;
  sendDebuggerCommand: (method: string, params?: Record<string, unknown>) => Promise<void>;
};
