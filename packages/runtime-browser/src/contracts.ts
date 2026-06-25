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

export type BrowserRuntimeEventCategory =
  | 'lifecycle'
  | 'browser'
  | 'console'
  | 'network'
  | 'replay';

export type BrowserRuntimeEventLevel = 'info' | 'warn' | 'error';

export type BrowserRuntimeEventSource = 'runtime_manager' | 'electron_shell' | 'cdp';

export type BrowserRuntimeEvent = {
  id: string;
  timestamp: string;
  category: BrowserRuntimeEventCategory;
  code: string;
  level: BrowserRuntimeEventLevel;
  message: string;
  source: BrowserRuntimeEventSource;
  detail?: string;
  data?: Record<string, unknown>;
};

export type BrowserRuntimeHealthStatus = 'idle' | 'healthy' | 'degraded' | 'error';

export type BrowserRuntimeHealth = {
  status: BrowserRuntimeHealthStatus;
  lastEventAt: string | null;
  lastError: string | null;
  recentEventCount: number;
  subscriberCount: number;
};

export type BrowserRuntimeDiagnostics = {
  state: BrowserRuntimeState;
  health: BrowserRuntimeHealth;
  recentEvents: BrowserRuntimeEvent[];
};

export type BrowserRuntimeUpdate = {
  state: BrowserRuntimeState;
  health: BrowserRuntimeHealth;
  event: BrowserRuntimeEvent;
};

export type ManagedBrowserSurface = {
  getCdpEndpoint: () => string;
  getURL: () => string;
};
