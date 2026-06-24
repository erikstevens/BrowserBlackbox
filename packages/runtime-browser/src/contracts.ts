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
  lastError: string | null;
};

export type BrowserRuntimeCommandResult = {
  state: BrowserRuntimeState;
};
