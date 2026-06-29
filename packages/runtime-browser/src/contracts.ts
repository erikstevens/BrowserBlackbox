import type {
  BrowserContextSnapshot,
  Checkpoint,
  RecordedStep,
  RedactionRule,
} from '@browser-blackbox/domain';

export type BrowserRuntimePhase =
  | 'idle'
  | 'launching'
  | 'running'
  | 'stopping'
  | 'error';

export type BrowserLaunchRequest = {
  targetUrl: string;
  redactionRules?: RedactionRule[];
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

export type BrowserReplayMode =
  | 'from-start'
  | 'up-to-step'
  | 'from-checkpoint'
  | 'pause-on-step';

export type BrowserReplayPlan = {
  mode: BrowserReplayMode;
  targetStepId: string | null;
  checkpointId: string | null;
  startStrategy: 'start' | 'checkpoint';
  executionStepIds: string[];
};

export type BrowserReplayRequest = {
  targetUrl?: string | null;
  steps: RecordedStep[];
  checkpoints: Checkpoint[];
  plan: BrowserReplayPlan;
  redactionRules?: RedactionRule[];
};

export type BrowserReplayCommandResult = BrowserRuntimeCommandResult & {
  completedStepIds: string[];
  pausedAtStepId: string | null;
  restoredCheckpointId: string | null;
  capturedCheckpoints: Array<{
    checkpointId: string;
    snapshot: BrowserContextSnapshot;
  }>;
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
