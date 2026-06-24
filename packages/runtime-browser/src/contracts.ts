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
  playwrightAttached: boolean;
  cdpAttached: boolean;
  lastError: string | null;
};

export type BrowserRuntimeCommandResult = {
  state: BrowserRuntimeState;
};

export type ManagedBrowserSurface = {
  getCdpEndpoint: () => string;
  getURL: () => string;
};
