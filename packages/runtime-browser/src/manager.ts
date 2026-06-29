import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type {
  Assertion,
  BrowserContextSnapshot,
  Checkpoint,
  RecordedStep,
  RedactionRule,
} from '@browser-blackbox/domain';
import { chromium } from 'playwright';
import type {
  BrowserLaunchRequest,
  BrowserReplayCommandResult,
  BrowserReplayRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeEvent,
  BrowserRuntimeEventCategory,
  BrowserRuntimeEventLevel,
  BrowserRuntimeEventSource,
  ManagedBrowserSurface,
  BrowserRuntimeState,
} from './contracts';

type ConnectedCdpSession = {
  detach: () => Promise<void>;
  on: (
    event: 'event',
    listener: (data: { method: string; params?: Record<string, unknown> }) => void,
  ) => void;
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
};

type ConnectedDialog = {
  accept: (promptText?: string) => Promise<void>;
  dismiss: () => Promise<void>;
};

type ConnectedLocator = {
  click: () => Promise<void>;
  dblclick: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  selectOption: (value: string) => Promise<void>;
  setChecked: (checked: boolean) => Promise<void>;
  press: (key: string) => Promise<void>;
  waitFor: (options: { state: 'visible' | 'hidden'; timeout?: number }) => Promise<void>;
  isEnabled: () => Promise<boolean>;
  textContent: () => Promise<string | null>;
  setInputFiles?: (files: string | string[]) => Promise<void>;
};

type ConnectedPage = {
  context: () => {
    newCDPSession: (page: ConnectedPage) => Promise<ConnectedCdpSession>;
    cookies: () => Promise<BrowserContextSnapshot['cookies']>;
    addCookies: (cookies: BrowserContextSnapshot['cookies']) => Promise<void>;
    clearCookies: () => Promise<void>;
  };
  goto: (targetUrl: string) => Promise<unknown>;
  reload: () => Promise<unknown>;
  dragAndDrop: (source: string, target: string) => Promise<void>;
  waitForEvent: (
    event: 'dialog' | 'download' | 'popup',
    options?: { timeout?: number },
  ) => Promise<unknown>;
  keyboard: {
    press: (key: string) => Promise<void>;
  };
  url: () => string;
  evaluate: (pageFunction: (arg?: unknown) => unknown, arg?: unknown) => Promise<unknown>;
  [key: string]: unknown;
};

type ConnectedBrowser = {
  close: () => Promise<void>;
  contexts: () => Array<{
    pages: () => ConnectedPage[];
  }>;
};

type PlaywrightConnector = {
  connect: (endpointUrl: string) => Promise<ConnectedBrowser>;
};

type ActionReplayStep = Extract<RecordedStep, { kind: 'action' }>;
type AssertionReplayStep = Extract<RecordedStep, { kind: 'assertion' }>;

const DEFAULT_STATE: BrowserRuntimeState = {
  phase: 'idle',
  targetUrl: null,
  pageUrl: null,
  sessionId: null,
  playwrightAttached: false,
  cdpAttached: false,
  lastError: null,
};

export class BrowserSessionManager {
  private browser: ConnectedBrowser | null = null;
  private cdpSession: ConnectedCdpSession | null = null;
  private page: ConnectedPage | null = null;
  private listeners = new Set<(event: BrowserRuntimeEvent) => void>();
  private requestMap = new Map<
    string,
    {
      protocol: 'http' | 'websocket';
      requestBody?: CaptureBodyPayload;
      requestContentType?: string;
      method: string;
      startedAtMs: number;
      requestHeaders: Record<string, string>;
      url: string;
      retryCount: number;
      blocked: boolean;
      fromCache?: boolean;
      responseBody?: CaptureBodyPayload;
      responseContentType?: string;
      responseHeaders?: Record<string, string>;
      responseStatus?: number;
      responseProtocol?: string;
      timings?: {
        dnsMs?: number;
        connectMs?: number;
        tlsMs?: number;
        requestMs?: number;
        responseMs?: number;
      };
      correlationIds?: string[];
      fromServiceWorker?: boolean;
      durationMs?: number;
    }
  >();
  private failedAttemptCounts = new Map<string, number>();
  private surface: ManagedBrowserSurface | null = null;
  private state: BrowserRuntimeState = DEFAULT_STATE;
  private activeRedactionRules: RedactionRule[] = [];

  constructor(private readonly connector: PlaywrightConnector = defaultConnector) {}

  getState(): BrowserRuntimeState {
    return { ...this.state };
  }

  subscribe(listener: (event: BrowserRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  registerSurface(surface: ManagedBrowserSurface): void {
    this.surface = surface;
  }

  unregisterSurface(): void {
    this.surface = null;
    this.state = { ...DEFAULT_STATE };
  }

  setRedactionRules(rules: RedactionRule[]): void {
    this.activeRedactionRules = [...rules];
  }

  async launch(request: BrowserLaunchRequest): Promise<BrowserRuntimeCommandResult> {
    const targetUrl = request.targetUrl.trim();

    if (targetUrl.length === 0) {
      throw new Error('Target URL is required.');
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error('Target URL must be a valid absolute URL.');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Target URL must use http or https.');
    }

    if (this.surface === null) {
      throw new Error('Embedded browser surface is not attached.');
    }

    await this.stop();
    this.activeRedactionRules = [...(request.redactionRules ?? [])];
    this.state = {
      phase: 'launching',
      targetUrl: parsedUrl.toString(),
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    };
    this.requestMap.clear();
    this.failedAttemptCounts.clear();
    this.emitEvent(
      'lifecycle',
      'runtime.launch.started',
      'info',
      `Launching managed browser session for ${parsedUrl.toString()}.`,
      'runtime_manager',
      {
        targetUrl: parsedUrl.toString(),
      },
    );

    try {
      const browser = await this.connector.connect(this.surface.getCdpEndpoint());
      this.emitEvent(
        'lifecycle',
        'runtime.playwright.attached',
        'info',
        'Playwright attached to the embedded Chromium target.',
        'runtime_manager',
      );

      const page = await this.resolveEmbeddedPage(browser, this.surface.getURL());
      const cdpSession = await page.context().newCDPSession(page);
      cdpSession.on('event', ({ method, params }) => {
        this.handleCdpEvent(method, params);
      });

      await cdpSession.send('Page.enable');
      await cdpSession.send('Network.enable');
      this.emitEvent(
        'lifecycle',
        'runtime.cdp.enabled',
        'info',
        'CDP page and network domains enabled.',
        'runtime_manager',
      );

      await page.goto(parsedUrl.toString());

      this.browser = browser;
      this.cdpSession = cdpSession;
      this.page = page;

      this.state = {
        phase: 'running',
        targetUrl: parsedUrl.toString(),
        pageUrl: page.url(),
        sessionId: randomUUID(),
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      };
      this.emitEvent(
        'browser',
        'browser.navigation.completed',
        'info',
        `Navigation completed for ${page.url()}.`,
        'runtime_manager',
        {
          url: page.url(),
        },
      );

      return { state: this.getState() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = {
        phase: 'error',
        targetUrl: parsedUrl.toString(),
        pageUrl: null,
        sessionId: null,
        playwrightAttached: this.browser !== null,
        cdpAttached: this.cdpSession !== null,
        lastError: message,
      };
      this.emitEvent(
        'lifecycle',
        'runtime.launch.failed',
        'error',
        'Managed browser session launch failed.',
        'runtime_manager',
        undefined,
        message,
      );
      await this.disposeConnection();
      throw new Error(message);
    }
  }

  async stop(): Promise<BrowserRuntimeCommandResult> {
    if (this.state.phase === 'idle') {
      return { state: this.getState() };
    }

    this.state = {
      ...this.state,
      phase: 'stopping',
      playwrightAttached: this.browser !== null,
      cdpAttached: this.cdpSession !== null,
      lastError: null,
    };
    this.emitEvent(
      'lifecycle',
      'runtime.stop.started',
      'info',
      'Stopping managed browser session.',
      'runtime_manager',
    );

    await this.disposeConnection();
    this.state = { ...DEFAULT_STATE };
    this.requestMap.clear();
    this.failedAttemptCounts.clear();
    this.emitEvent(
      'lifecycle',
      'runtime.stop.completed',
      'info',
      'Managed browser session stopped.',
      'runtime_manager',
    );
    return { state: this.getState() };
  }

  async executeReplay(
    request: BrowserReplayRequest,
  ): Promise<BrowserReplayCommandResult> {
    this.activeRedactionRules = [...(request.redactionRules ?? this.activeRedactionRules)];
    if (this.state.phase !== 'running' || this.page === null) {
      throw new Error('A managed browser session must be running before replay can execute.');
    }

    const selectedCheckpoint = request.plan.checkpointId
      ? request.checkpoints.find((checkpoint) => checkpoint.id === request.plan.checkpointId) ?? null
      : null;
    const checkpointRestorable = selectedCheckpoint
      ? isRestorableCheckpoint(selectedCheckpoint)
      : false;
    const shouldRestoreCheckpoint =
      request.plan.startStrategy === 'checkpoint' && selectedCheckpoint !== null;

    if (request.plan.mode === 'from-checkpoint' && shouldRestoreCheckpoint && !checkpointRestorable) {
      throw new Error(
        `Checkpoint ${selectedCheckpoint.label} cannot be restored because no compatible snapshot is available.`,
      );
    }

    if (shouldRestoreCheckpoint && checkpointRestorable) {
      await this.restoreCheckpoint(selectedCheckpoint);
    }

    const stepsToExecute = this.resolveReplaySteps(
      request.steps,
      request.plan,
      shouldRestoreCheckpoint && checkpointRestorable,
    );
    const completedStepIds: string[] = [];
    const capturedCheckpoints: BrowserReplayCommandResult['capturedCheckpoints'] = [];
    this.emitEvent(
      'replay',
      'replay.execution.started',
      'info',
      `Replay started in ${request.plan.mode} mode.`,
      'runtime_manager',
      {
        mode: request.plan.mode,
        targetStepId: request.plan.targetStepId,
      },
    );

    try {
      for (const step of stepsToExecute) {
        if (step.status === 'disabled') {
          this.emitEvent(
            'replay',
            'replay.step.skipped',
            'info',
            `Skipped disabled step ${step.title}.`,
            'runtime_manager',
            { stepId: step.id },
          );
          continue;
        }

        try {
          await this.executeStep(step);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.emitEvent(
            'replay',
            step.kind === 'assertion' ? 'replay.assertion.failed' : 'replay.step.failed',
            'error',
            `Replay failed at ${step.title}.`,
            'runtime_manager',
            {
              ...(step.kind === 'action'
                ? { actionType: step.action.type }
                : { assertionKind: step.assertion.kind }),
              stepId: step.id,
              stepKind: step.kind,
            },
            detail,
          );
          throw error;
        }
        completedStepIds.push(step.id);
        this.state = {
          ...this.state,
          pageUrl: this.page.url(),
          lastError: null,
        };
        if (step.kind === 'assertion') {
          this.emitEvent(
            'replay',
            'replay.assertion.passed',
            'info',
            `Assertion passed for ${step.title}.`,
            'runtime_manager',
            {
              assertionKind: step.assertion.kind,
              stepId: step.id,
            },
          );
        }
        this.emitEvent(
          'replay',
          'replay.step.completed',
          'info',
          `Replay executed ${step.title}.`,
          'runtime_manager',
          {
            stepId: step.id,
            stepKind: step.kind,
          },
        );

        const checkpoint = request.checkpoints.find(
          (entry) => entry.status === 'valid' && entry.stepId === step.id,
        );
        if (checkpoint) {
          const snapshot = await this.captureCheckpointSnapshot();
          capturedCheckpoints.push({
            checkpointId: checkpoint.id,
            snapshot,
          });
          this.emitEvent(
            'replay',
            'replay.checkpoint.captured',
            'info',
            `Captured checkpoint snapshot for ${checkpoint.label}.`,
            'runtime_manager',
            {
              checkpointId: checkpoint.id,
              stepId: step.id,
            },
          );
        }
      }

      const pausedAtStepId =
        request.plan.mode === 'pause-on-step' ? request.plan.targetStepId : null;
      if (pausedAtStepId) {
        this.emitEvent(
          'replay',
          'replay.execution.paused',
          'info',
          `Replay paused after step ${pausedAtStepId}.`,
          'runtime_manager',
          {
            stepId: pausedAtStepId,
          },
        );
      }

      this.emitEvent(
        'replay',
        'replay.execution.completed',
        'info',
        `Replay completed ${completedStepIds.length} step(s).`,
        'runtime_manager',
        {
          completedStepIds,
          pausedAtStepId,
        },
      );

      return {
        state: this.getState(),
        completedStepIds,
        pausedAtStepId,
        restoredCheckpointId:
          shouldRestoreCheckpoint && checkpointRestorable ? selectedCheckpoint?.id ?? null : null,
        capturedCheckpoints,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state = {
        ...this.state,
        phase: 'running',
        pageUrl: this.page.url(),
        lastError: message,
      };
      this.emitEvent(
        'replay',
        'replay.execution.failed',
        'error',
        'Replay execution failed.',
        'runtime_manager',
        {
          completedStepIds,
        },
        message,
      );
      throw new Error(message);
    }
  }

  private async disposeConnection(): Promise<void> {
    if (this.cdpSession !== null) {
      await this.cdpSession.detach();
    }

    if (this.browser !== null) {
      await this.browser.close();
    }

    this.cdpSession = null;
    this.browser = null;
    this.page = null;
  }

  private async resolveEmbeddedPage(
    browser: ConnectedBrowser,
    expectedUrl: string,
  ): Promise<ConnectedPage> {
    const timeoutAt = Date.now() + 5_000;

    while (Date.now() < timeoutAt) {
      const pages = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => page.url().length > 0);
      const matchingPage = pages.find((page) => page.url() === expectedUrl);

      if (matchingPage) {
        return matchingPage;
      }

      if (pages.length === 1) {
        return pages[0];
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const discoveredPages = browser
      .contexts()
      .flatMap((context) => context.pages())
      .map((page) => page.url())
      .filter((url) => url.length > 0);

    throw new Error(
      `Unable to resolve the embedded browser target for Playwright attachment. Found pages: ${
        discoveredPages.length > 0 ? discoveredPages.join(', ') : 'none'
      }`,
    );
  }

  private handleCdpEvent(method: string, params?: Record<string, unknown>): void {
    if (method === 'Network.requestWillBeSent') {
      const request = asRecord(params?.request);
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const requestMethod = typeof request?.method === 'string' ? request.method : 'UNKNOWN';
      const requestUrl = typeof request?.url === 'string' ? request.url : 'unknown URL';
      const requestHeaders = redactSensitiveHeaders(
        normalizeHeaderRecord(request?.headers),
        this.activeRedactionRules,
        'request',
      );
      const requestContentType = requestHeaders['content-type'];
      const requestBody = captureRequestBody(
        request,
        requestContentType,
        this.activeRedactionRules,
      );
      const redactedRequestUrl = redactUrlByRules(requestUrl, this.activeRedactionRules);
      const retryCount = this.failedAttemptCounts.get(
        buildAttemptKey(requestMethod, redactedRequestUrl, 'http'),
      ) ?? 0;
      if (requestId !== null) {
        this.requestMap.set(requestId, {
          protocol: 'http',
          startedAtMs: Date.now(),
          method: requestMethod,
          requestBody,
          requestContentType,
          requestHeaders,
          url: redactedRequestUrl,
          retryCount,
          blocked: false,
        });
      }
      this.emitEvent(
        'network',
        'network.request.started',
        'info',
        `${requestMethod} ${redactedRequestUrl}`,
        'cdp',
        {
          headers: requestHeaders,
          body: requestBody,
          method: requestMethod,
          protocol: 'http',
          requestId,
          retryCount,
          url: redactedRequestUrl,
        },
      );
      return;
    }

    if (method === 'Network.requestServedFromCache') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      if (requestId !== null) {
        const current = this.requestMap.get(requestId);
        if (current) {
          this.requestMap.set(requestId, {
            ...current,
            fromCache: true,
          });
        }
      }
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const response = asRecord(params?.response);
      const requestRecord = requestId !== null ? this.requestMap.get(requestId) : undefined;
      const status = typeof response?.status === 'number' ? response.status : 'unknown';
      const responseUrl = typeof response?.url === 'string' ? response.url : 'unknown URL';
      const responseHeaders = redactSensitiveHeaders(
        normalizeHeaderRecord(response?.headers),
        this.activeRedactionRules,
        'response',
      );
      const timings = normalizeNetworkTimings(response?.timing);
      const correlationIds = collectCorrelationIds(
        requestRecord?.requestHeaders ?? {},
        responseHeaders,
      );
      const durationMs =
        timings?.responseMs !== undefined
          ? totalDurationMs(timings)
          : requestRecord
            ? Math.max(0, Date.now() - requestRecord.startedAtMs)
            : undefined;
      if (requestId !== null && requestRecord) {
        this.requestMap.set(requestId, {
          ...requestRecord,
          correlationIds,
          durationMs,
          fromServiceWorker: response?.fromServiceWorker === true,
          responseContentType: responseHeaders['content-type'],
          responseHeaders,
          responseProtocol:
            typeof response?.protocol === 'string' ? response.protocol : undefined,
          responseStatus: typeof response?.status === 'number' ? response.status : undefined,
          timings,
          url: redactUrlByRules(responseUrl, this.activeRedactionRules),
        });
      }
      if (requestRecord) {
        this.failedAttemptCounts.delete(
          buildAttemptKey(requestRecord.method, requestRecord.url, requestRecord.protocol),
        );
      }
      const redactedResponseUrl = redactUrlByRules(responseUrl, this.activeRedactionRules);
      this.emitEvent(
        'network',
        'network.response.received',
        'info',
        `Response ${status} from ${redactedResponseUrl}`,
        'cdp',
        {
          correlationIds,
          durationMs,
          fromCache:
            requestRecord?.fromCache === true ||
            response?.fromDiskCache === true ||
            response?.fromPrefetchCache === true,
          fromServiceWorker: response?.fromServiceWorker === true,
          headers: responseHeaders,
          method: requestRecord?.method ?? null,
          protocol:
            requestRecord?.protocol ?? (typeof response?.protocol === 'string' ? response.protocol : null),
          requestId,
          retryCount: requestRecord?.retryCount ?? 0,
          status,
          timings,
          url: redactedResponseUrl,
          blocked: requestRecord?.blocked ?? false,
        },
      );
      if (requestId !== null) {
        void this.emitResponseBodyEvent(requestId, redactedResponseUrl);
      }
      return;
    }

    if (method === 'Network.loadingFailed') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const requestRecord = requestId !== null ? this.requestMap.get(requestId) : undefined;
      const failedUrl = requestRecord?.url ?? 'request';
      const errorText = typeof params?.errorText === 'string' ? params.errorText : 'unknown failure';
      const blockedReason =
        typeof params?.blockedReason === 'string' ? params.blockedReason : null;
      if (requestRecord) {
        const attemptKey = buildAttemptKey(
          requestRecord.method,
          requestRecord.url,
          requestRecord.protocol,
        );
        this.failedAttemptCounts.set(attemptKey, requestRecord.retryCount + 1);
        this.requestMap.set(requestId!, {
          ...requestRecord,
          blocked: blockedReason !== null,
        });
      }
      this.emitEvent(
        'network',
        'network.request.failed',
        'error',
        `Network loading failed for ${failedUrl}.`,
        'cdp',
        {
          blocked: blockedReason !== null,
          blockedReason,
          errorText,
          headers: requestRecord?.requestHeaders ?? {},
          method: requestRecord?.method ?? null,
          protocol: requestRecord?.protocol ?? 'http',
          requestId,
          retryCount: requestRecord?.retryCount ?? 0,
          url: failedUrl,
        },
        blockedReason ? `${blockedReason}: ${errorText}` : errorText,
      );
      return;
    }

    if (method === 'Network.webSocketCreated') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const url = typeof params?.url === 'string' ? params.url : 'unknown URL';
      const redactedUrl = redactUrlByRules(url, this.activeRedactionRules);
      const retryCount =
        this.failedAttemptCounts.get(buildAttemptKey('GET', redactedUrl, 'websocket')) ?? 0;

      if (requestId !== null) {
        this.requestMap.set(requestId, {
          protocol: 'websocket',
          startedAtMs: Date.now(),
          method: 'GET',
          requestBody: unavailableBody('WebSocket frames are not represented as a single request body.'),
          requestHeaders: {},
          url: redactedUrl,
          retryCount,
          blocked: false,
        });
      }

      this.emitEvent(
        'network',
        'network.request.started',
        'info',
        `WebSocket ${redactedUrl}`,
        'cdp',
        {
          body: unavailableBody('WebSocket frames are not represented as a single request body.'),
          headers: {},
          method: 'GET',
          protocol: 'websocket',
          requestId,
          retryCount,
          url: redactedUrl,
        },
      );
      return;
    }

    if (method === 'Network.webSocketWillSendHandshakeRequest') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const request = asRecord(params?.request);
      if (!requestId) {
        return;
      }

      const existing = this.requestMap.get(requestId);
      if (!existing) {
        return;
      }

      const requestHeaders = redactSensitiveHeaders(
        normalizeHeaderRecord(request?.headers),
        this.activeRedactionRules,
        'request',
      );
      this.requestMap.set(requestId, {
        ...existing,
        requestHeaders,
      });
      return;
    }

    if (method === 'Network.webSocketHandshakeResponseReceived') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const response = asRecord(params?.response);
      if (!requestId) {
        return;
      }

      const existing = this.requestMap.get(requestId);
      if (!existing) {
        return;
      }

      const responseHeaders = redactSensitiveHeaders(
        normalizeHeaderRecord(response?.headers),
        this.activeRedactionRules,
        'response',
      );
      const correlationIds = collectCorrelationIds(existing.requestHeaders, responseHeaders);
      const status = typeof response?.status === 'number' ? response.status : 101;
      this.requestMap.set(requestId, {
        ...existing,
        correlationIds,
        responseHeaders,
        responseStatus: status,
        responseProtocol: 'websocket',
        responseBody: unavailableBody(
          'WebSocket frames are not represented as a single response body.',
        ),
      });
      this.failedAttemptCounts.delete(buildAttemptKey(existing.method, existing.url, existing.protocol));
      this.emitEvent(
        'network',
        'network.response.received',
        'info',
        `WebSocket handshake ${status} from ${existing.url}`,
        'cdp',
        {
          blocked: existing.blocked,
          correlationIds,
          durationMs: Math.max(0, Date.now() - existing.startedAtMs),
          fromCache: false,
          fromServiceWorker: false,
          headers: responseHeaders,
          method: existing.method,
          protocol: 'websocket',
          requestId,
          retryCount: existing.retryCount,
          status,
          timings: null,
          url: existing.url,
          responseBody: unavailableBody(
            'WebSocket frames are not represented as a single response body.',
          ),
        },
      );
      return;
    }

    if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const response = asRecord(params?.response);
      const payloadData =
        typeof response?.payloadData === 'string' ? response.payloadData : null;
      this.emitEvent(
        'network',
        method === 'Network.webSocketFrameSent'
          ? 'network.websocket.frame.sent'
          : 'network.websocket.frame.received',
        'info',
        method === 'Network.webSocketFrameSent'
          ? 'Captured WebSocket frame sent event.'
          : 'Captured WebSocket frame received event.',
        'cdp',
        {
          opcode: typeof response?.opcode === 'number' ? response.opcode : null,
          payloadPreview: payloadData ? payloadData.slice(0, 120) : null,
          requestId,
        },
      );
      return;
    }

    if (method === 'Network.webSocketFrameError') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const errorMessage =
        typeof params?.errorMessage === 'string' ? params.errorMessage : 'WebSocket frame error';
      const existing = requestId ? this.requestMap.get(requestId) : undefined;
      if (existing) {
        this.failedAttemptCounts.set(
          buildAttemptKey(existing.method, existing.url, existing.protocol),
          existing.retryCount + 1,
        );
      }
      this.emitEvent(
        'network',
        'network.request.failed',
        'error',
        `WebSocket failed for ${existing?.url ?? 'request'}.`,
        'cdp',
        {
          blocked: false,
          errorText: errorMessage,
          headers: existing?.requestHeaders ?? {},
          method: existing?.method ?? 'GET',
          protocol: 'websocket',
          requestId,
          retryCount: existing?.retryCount ?? 0,
          url: existing?.url ?? 'unknown URL',
        },
        errorMessage,
      );
      return;
    }

    if (method === 'Network.webSocketClosed') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      if (!requestId) {
        return;
      }

      const existing = this.requestMap.get(requestId);
      if (!existing) {
        return;
      }

      const durationMs = Math.max(0, Date.now() - existing.startedAtMs);
      this.requestMap.set(requestId, {
        ...existing,
        durationMs,
      });
      return;
    }

    if (method === 'Page.frameNavigated') {
      const frame = asRecord(params?.frame);
      const frameUrl = typeof frame?.url === 'string' ? frame.url : null;
      const parentFrameId = typeof frame?.parentId === 'string' ? frame.parentId : null;
      if (frameUrl !== null) {
        this.emitEvent(
          'browser',
          'browser.frame.navigated',
          'info',
          `Frame navigated to ${frameUrl}.`,
          'cdp',
          {
            isMainFrame: parentFrameId === null,
            parentFrameId,
            url: frameUrl,
          },
        );
      }
    }
  }

  private emitEvent(
    category: BrowserRuntimeEventCategory,
    code: string,
    level: BrowserRuntimeEventLevel,
    message: string,
    source: BrowserRuntimeEventSource,
    data?: Record<string, unknown>,
    detail?: string,
  ): void {
    const event: BrowserRuntimeEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      code,
      level,
      message,
      source,
      ...(data ? { data } : {}),
      ...(detail ? { detail } : {}),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private resolveReplaySteps(
    steps: RecordedStep[],
    plan: BrowserReplayRequest['plan'],
    checkpointRestored: boolean,
  ): RecordedStep[] {
    if (
      plan.startStrategy === 'checkpoint' &&
      plan.mode !== 'from-checkpoint' &&
      !checkpointRestored &&
      plan.targetStepId !== null
    ) {
      this.emitEvent(
        'replay',
        'replay.checkpoint.fallback',
        'warn',
        'Checkpoint snapshot is unavailable. Falling back to replay from start.',
        'runtime_manager',
        {
          checkpointId: plan.checkpointId,
          targetStepId: plan.targetStepId,
        },
      );

      const targetIndex = steps.findIndex((step) => step.id === plan.targetStepId);
      if (targetIndex === -1) {
        throw new Error(`Replay target step ${plan.targetStepId} does not exist.`);
      }

      return steps.slice(0, targetIndex + 1);
    }

    const executionStepIds = new Set(plan.executionStepIds);
    return steps.filter((step) => executionStepIds.has(step.id));
  }

  private async executeStep(step: RecordedStep): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    if (step.kind === 'action') {
      await this.executeActionStep(step);
      return;
    }

    await this.executeAssertionStep(step);
  }

  private async executeActionStep(step: ActionReplayStep): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    switch (step.action.type) {
      case 'navigate':
        await this.page.goto(step.action.url);
        return;
      case 'click':
        await this.resolveLocator(step.action.selector).click();
        return;
      case 'double-click':
        await this.resolveLocator(step.action.selector).dblclick();
        return;
      case 'fill':
        await this.resolveLocator(step.action.selector).fill(step.action.value);
        return;
      case 'select-option':
        await this.resolveLocator(step.action.selector).selectOption(step.action.value);
        return;
      case 'set-checked':
        await this.resolveLocator(step.action.selector).setChecked(step.action.checked);
        return;
      case 'press-key':
        await this.executePressKey(step.action);
        return;
      case 'drag-and-drop':
        await this.page.dragAndDrop(step.action.sourceSelector, step.action.targetSelector);
        return;
      case 'upload-file': {
        const locator = this.resolveLocator(step.action.selector);
        if (!locator.setInputFiles) {
          throw new Error(
            `Replay does not support file upload for step ${step.id} in the current browser adapter.`,
          );
        }
        await locator.setInputFiles(step.action.fileName);
        return;
      }
      case 'reload':
        await this.page.reload();
        return;
      case 'dialog':
        await this.executeDialogStep(step.action);
        return;
      case 'wait-for-download':
        await this.page.waitForEvent('download', { timeout: 5_000 });
        return;
      case 'wait-for-popup':
        await this.page.waitForEvent('popup', { timeout: 5_000 });
        return;
      default:
        throw new Error('Replay does not support this action step.');
    }
  }

  private async executeAssertionStep(step: AssertionReplayStep): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    switch (step.assertion.kind) {
      case 'element-visible':
        await this.resolveLocator(step.assertion.selector).waitFor({
          state: 'visible',
          timeout: 5_000,
        });
        return;
      case 'element-hidden':
        await this.resolveLocator(step.assertion.selector).waitFor({
          state: 'hidden',
          timeout: 5_000,
        });
        return;
      case 'element-enabled':
        await this.assertElementEnabled(step.assertion.selector);
        return;
      case 'element-contains-text':
        await this.assertElementContainsText(
          step.assertion.selector,
          step.assertion.expectedText,
        );
        return;
      case 'url-matches':
        this.assertUrlMatches(step.assertion);
        return;
      default:
        throw new Error(
          `Replay does not support assertion step ${step.assertion.kind} yet.`,
        );
    }
  }

  private async executePressKey(action: {
    selector?: string;
    key: string;
    modifiers: string[];
  }): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    const key = [...action.modifiers, action.key].join('+');
    if (action.selector) {
      await this.resolveLocator(action.selector).press(key);
      return;
    }

    await this.page.keyboard.press(key);
  }

  private async executeDialogStep(action: {
    action: 'accept' | 'dismiss';
    promptText?: string;
  }): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    const dialog = (await this.page.waitForEvent('dialog', {
      timeout: 5_000,
    })) as ConnectedDialog;
    if (action.action === 'accept') {
      await dialog.accept(action.promptText);
      return;
    }
    await dialog.dismiss();
  }

  private async assertElementEnabled(selector: string): Promise<void> {
    const locator = this.resolveLocator(selector);
    const enabled = await locator.isEnabled();
    if (!enabled) {
      throw new Error(`Expected ${selector} to be enabled.`);
    }
  }

  private async assertElementContainsText(
    selector: string,
    expectedText: string,
  ): Promise<void> {
    const locator = this.resolveLocator(selector);
    const text = (await locator.textContent()) ?? '';
    if (!text.includes(expectedText)) {
      throw new Error(`Expected ${selector} to contain text "${expectedText}".`);
    }
  }

  private assertUrlMatches(assertion: Extract<Assertion, { kind: 'url-matches' }>): void {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    const currentUrl = this.page.url();
    const matches =
      assertion.matchMode === 'exact'
        ? currentUrl === assertion.expectedUrl
        : assertion.matchMode === 'glob'
          ? globToRegExp(assertion.expectedUrl).test(currentUrl)
          : new RegExp(assertion.expectedUrl).test(currentUrl);

    if (!matches) {
      throw new Error(
        `Expected URL ${currentUrl} to match ${assertion.matchMode} pattern ${assertion.expectedUrl}.`,
      );
    }
  }

  private resolveLocator(selector: string): ConnectedLocator {
    if (this.page === null) {
      throw new Error('Managed page is not available for replay.');
    }

    try {
      const resolved = new Function('page', `"use strict"; return (${selector});`)(
        this.page,
      ) as ConnectedLocator;
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        typeof resolved.click !== 'function'
      ) {
        throw new Error('Selector did not resolve to a Playwright locator.');
      }
      return resolved;
    } catch (error) {
      throw new Error(
        `Unable to resolve replay selector ${selector}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async emitResponseBodyEvent(
    requestId: string,
    responseUrl: string,
  ): Promise<void> {
    if (this.cdpSession === null) {
      return;
    }

    const requestRecord = this.requestMap.get(requestId);
    if (!requestRecord) {
      return;
    }

    try {
      const bodyResult = await maybeGetResponseBody(this.cdpSession, requestId);
      if (bodyResult === null) {
        return;
      }

      const responseBody = captureTextBody(
        decodeResponseBody(bodyResult.body, bodyResult.base64Encoded),
        requestRecord.responseContentType,
        false,
        responseUrl,
        this.activeRedactionRules,
      );
      this.requestMap.set(requestId, {
        ...requestRecord,
        responseBody,
      });
      this.emitEvent(
        'network',
        'network.response.body.captured',
        'info',
        `Captured response body for ${responseUrl}.`,
        'runtime_manager',
        {
          requestId,
          responseBody,
        },
      );
    } catch (error) {
      this.emitEvent(
        'network',
        'network.response.body.unavailable',
        'warn',
        `Response body was unavailable for ${responseUrl}.`,
        'runtime_manager',
        {
          requestId,
          responseBody: {
            state: 'unavailable',
            contentType: requestRecord.responseContentType,
            reason:
              error instanceof Error
                ? error.message
                : String(error),
          },
        },
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async captureCheckpointSnapshot(): Promise<BrowserContextSnapshot> {
    if (this.page === null) {
      throw new Error('Managed page is not available for checkpoint capture.');
    }

    const cookies = await this.page.context().cookies();
    const pageUrl = this.page.url();
    const origins = (await this.page.evaluate(() => {
      const readStorage = (storage: Storage): Record<string, string> => {
        const entries: Record<string, string> = {};
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key === null) {
            continue;
          }
          entries[key] = storage.getItem(key) ?? '';
        }
        return entries;
      };

      return [
        {
          origin: window.location.origin,
          localStorage: readStorage(window.localStorage),
          sessionStorage: readStorage(window.sessionStorage),
        },
      ];
    })) as BrowserContextSnapshot['origins'];

    return {
      capturedAt: new Date().toISOString(),
      pageUrl,
      cookies,
      origins,
    };
  }

  private async restoreCheckpoint(checkpoint: Checkpoint): Promise<void> {
    if (this.page === null) {
      throw new Error('Managed page is not available for checkpoint restore.');
    }

    const snapshot = checkpoint.snapshot;
    if (!snapshot) {
      throw new Error(`Checkpoint ${checkpoint.label} does not include a restorable snapshot.`);
    }

    await this.page.context().clearCookies();
    if (snapshot.cookies.length > 0) {
      await this.page.context().addCookies(snapshot.cookies);
    }

    for (const originSnapshot of snapshot.origins) {
      await this.page.goto(originSnapshot.origin);
      await this.page.evaluate(
        (arg) => {
          const { localStorageEntries, sessionStorageEntries } = arg as {
            localStorageEntries: Record<string, string>;
            sessionStorageEntries: Record<string, string>;
          };
          window.localStorage.clear();
          window.sessionStorage.clear();

          Object.entries(localStorageEntries).forEach(([key, value]) => {
            window.localStorage.setItem(key, value);
          });
          Object.entries(sessionStorageEntries).forEach(([key, value]) => {
            window.sessionStorage.setItem(key, value);
          });
        },
        {
          localStorageEntries: originSnapshot.localStorage,
          sessionStorageEntries: originSnapshot.sessionStorage,
        },
      );
    }

    await this.page.goto(snapshot.pageUrl);
    this.state = {
      ...this.state,
      pageUrl: this.page.url(),
      lastError: null,
    };
    this.emitEvent(
      'replay',
      'replay.checkpoint.restored',
      'info',
      `Restored checkpoint ${checkpoint.label}.`,
      'runtime_manager',
      {
        checkpointId: checkpoint.id,
      },
    );
  }
}

const defaultConnector: PlaywrightConnector = {
  connect: async (endpointUrl) => chromium.connectOverCDP(endpointUrl) as unknown as ConnectedBrowser,
};

const CAPTURE_POLICY = {
  responseBodySizeLimitBytes: 262_144,
  sensitiveEndpointPatterns: [
    /\/auth(?:[/?#]|$)/i,
    /\/login(?:[/?#]|$)/i,
    /\/oauth(?:[/?#]|$)/i,
    /\/password(?:[/?#]|$)/i,
    /\/session(?:[/?#]|$)/i,
    /\/token(?:[/?#]|$)/i,
  ],
} as const;

type CaptureBodyPayload =
  | {
      state: 'full';
      contentType?: string;
      text: string;
    }
  | {
      state: 'redacted';
      contentType?: string;
      text: string;
      redactionRuleIds: string[];
    }
  | {
      state: 'excluded' | 'unavailable' | 'truncated';
      contentType?: string;
      reason: string;
    };

function unavailableBody(reason: string, contentType?: string): CaptureBodyPayload {
  return {
    state: 'unavailable',
    contentType,
    reason,
  };
}

function buildAttemptKey(
  method: string,
  url: string,
  protocol: 'http' | 'websocket',
): string {
  return `${protocol}:${method.toUpperCase()}:${url}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return null;
}

async function maybeGetResponseBody(
  cdpSession: ConnectedCdpSession,
  requestId: string,
): Promise<{ body: string; base64Encoded: boolean } | null> {
  const result = await cdpSession.send('Network.getResponseBody', {
    requestId,
  });

  const record = asRecord(result);
  if (!record || typeof record.body !== 'string') {
    return null;
  }

  return {
    body: record.body,
    base64Encoded: record.base64Encoded === true,
  };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}

function normalizeHeaderRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (headers, [key, entry]) => {
      if (typeof entry === 'string') {
        headers[key.toLowerCase()] = entry;
      } else if (typeof entry === 'number' || typeof entry === 'boolean') {
        headers[key.toLowerCase()] = String(entry);
      }
      return headers;
    },
    {},
  );
}

function normalizeNetworkTimings(
  value: unknown,
):
  | {
      dnsMs?: number;
      connectMs?: number;
      tlsMs?: number;
      requestMs?: number;
      responseMs?: number;
    }
  | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const timing = value as Record<string, unknown>;
  const result = {
    dnsMs: positiveDiff(timing.dnsStart, timing.dnsEnd),
    connectMs: positiveDiff(timing.connectStart, timing.connectEnd),
    tlsMs: positiveDiff(timing.sslStart, timing.sslEnd),
    requestMs: positiveDiff(timing.sendStart, timing.sendEnd),
    responseMs: positiveDiff(timing.sendEnd, timing.receiveHeadersEnd),
  };

  return Object.values(result).some((entry) => entry !== undefined) ? result : undefined;
}

function positiveDiff(start: unknown, end: unknown): number | undefined {
  if (typeof start !== 'number' || typeof end !== 'number') {
    return undefined;
  }

  if (start < 0 || end < 0 || end < start) {
    return undefined;
  }

  return Math.round((end - start) * 100) / 100;
}

function totalDurationMs(timings: {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  requestMs?: number;
  responseMs?: number;
}): number | undefined {
  const values = [timings.dnsMs, timings.connectMs, timings.tlsMs, timings.requestMs, timings.responseMs]
    .filter((value): value is number => value !== undefined);

  if (values.length === 0) {
    return undefined;
  }

  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;
}

function collectCorrelationIds(
  requestHeaders: Record<string, string>,
  responseHeaders: Record<string, string>,
): string[] {
  const keys = ['x-request-id', 'x-correlation-id', 'traceparent'];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const key of keys) {
    for (const headers of [requestHeaders, responseHeaders]) {
      const value = headers[key];
      if (!value) {
        continue;
      }

      const entry = `${key}:${value}`;
      if (seen.has(entry)) {
        continue;
      }
      seen.add(entry);
      values.push(entry);
    }
  }

  return values;
}

function captureRequestBody(
  request: Record<string, unknown> | null,
  contentType?: string,
  redactionRules: RedactionRule[] = [],
): CaptureBodyPayload {
  const postData = typeof request?.postData === 'string' ? request.postData : null;
  if (postData === null) {
    return {
      state: 'unavailable',
      contentType,
      reason: 'No request body was provided for this request.',
    };
  }

  return captureTextBody(postData, contentType, true, undefined, redactionRules);
}

function captureTextBody(
  text: string,
  contentType: string | undefined,
  requestScoped: boolean,
  targetUrl?: string,
  redactionRules: RedactionRule[] = [],
): CaptureBodyPayload {
  if (!isTextualContentType(contentType)) {
    return {
      state: 'excluded',
      contentType,
      reason: 'Binary or unsupported content type is excluded by default.',
    };
  }

  if (!requestScoped && isSensitiveEndpoint(targetUrl)) {
    return {
      state: 'excluded',
      contentType,
      reason:
        'Response body capture is excluded for sensitive authentication or session endpoints by default.',
    };
  }

  if (Buffer.byteLength(text, 'utf8') > CAPTURE_POLICY.responseBodySizeLimitBytes) {
    return {
      state: 'truncated',
      contentType,
      reason: `Body exceeded the current capture size limit of ${CAPTURE_POLICY.responseBodySizeLimitBytes} bytes.`,
    };
  }

  const redacted = redactSensitiveText(
    text,
    contentType,
    requestScoped,
    redactionRules,
    requestScoped ? 'request' : 'response',
  );
  if (redacted.redactionRuleIds.length > 0) {
    return {
      state: 'redacted',
      contentType,
      text: redacted.text,
      redactionRuleIds: redacted.redactionRuleIds,
    };
  }

  return {
    state: 'full',
    contentType,
    text,
  };
}

function decodeResponseBody(body: string, base64Encoded: boolean): string {
  if (!base64Encoded) {
    return body;
  }

  return Buffer.from(body, 'base64').toString('utf8');
}

function isTextualContentType(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('application/json') ||
    normalized.includes('application/xml') ||
    normalized.includes('application/javascript') ||
    normalized.includes('application/x-www-form-urlencoded') ||
    normalized.includes('text/') ||
    normalized.includes('+json') ||
    normalized.includes('+xml')
  );
}

function isSensitiveEndpoint(targetUrl?: string): boolean {
  if (!targetUrl) {
    return false;
  }

  return CAPTURE_POLICY.sensitiveEndpointPatterns.some((pattern) => pattern.test(targetUrl));
}

function redactSensitiveHeaders(
  headers: Record<string, string>,
  redactionRules: RedactionRule[],
  scope: 'request' | 'response',
): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>((next, [key, value]) => {
    let nextValue = isSensitiveHeader(key) ? '[REDACTED]' : value;

    for (const rule of redactionRules) {
      if (rule.mode !== 'user-defined' || !matchesRuleScope(rule.scope, scope)) {
        continue;
      }

      if (rule.kind === 'header' && key.toLowerCase() === rule.target.toLowerCase()) {
        nextValue = '[REDACTED]';
      }

      if (rule.kind === 'cookie' && /^(cookie|set-cookie)$/i.test(key)) {
        nextValue = redactCookieHeader(nextValue, rule.target);
      }
    }

    next[key] = nextValue;
    return next;
  }, {});
}

function isSensitiveHeader(key: string): boolean {
  return /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token)$/i.test(
    key,
  );
}

function redactSensitiveText(
  text: string,
  contentType: string | undefined,
  requestScoped: boolean,
  redactionRules: RedactionRule[],
  scope: 'request' | 'response',
): {
  text: string;
  redactionRuleIds: string[];
} {
  let nextText = text;
  const redactionRuleIds = new Set<string>();
  const normalizedContentType = contentType?.toLowerCase() ?? '';

  const jsonFieldPattern =
    /"(password|passcode|token|access_token|refresh_token|authorization|cookie|set-cookie|secret|api[_-]?key|session(id)?)"\s*:\s*"([^"]*)"/gi;
  nextText = nextText.replace(jsonFieldPattern, (_match, key: string) => {
    redactionRuleIds.add(`rule-${key.toLowerCase()}`);
    return `"${key}":"[REDACTED]"`;
  });

  const formFieldPattern =
    /(^|[?&])(password|passcode|token|access_token|refresh_token|authorization|cookie|secret|api[_-]?key|session(id)?)=([^&]*)/gi;
  nextText = nextText.replace(formFieldPattern, (_match, prefix: string, key: string) => {
    redactionRuleIds.add(`rule-${key.toLowerCase()}`);
    return `${prefix}${key}=[REDACTED]`;
  });

  if (
    requestScoped &&
    normalizedContentType.includes('application/json') &&
    !nextText.includes('[REDACTED]') &&
    /password/i.test(nextText)
  ) {
    redactionRuleIds.add('rule-password');
    nextText = '[REDACTED JSON BODY]';
  }

  for (const rule of redactionRules) {
    if (rule.mode !== 'user-defined' || !matchesRuleScope(rule.scope, scope)) {
      continue;
    }

    const before = nextText;
    nextText = applyUserDefinedRuleToText(nextText, normalizedContentType, rule, requestScoped);
    if (nextText !== before) {
      redactionRuleIds.add(rule.id);
    }
  }

  return {
    text: nextText,
    redactionRuleIds: [...redactionRuleIds],
  };
}

function redactUrlByRules(url: string, redactionRules: RedactionRule[]): string {
  if (!url) {
    return url;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  let changed = false;
  for (const rule of redactionRules) {
    if (
      rule.mode !== 'user-defined' ||
      rule.kind !== 'query-param' ||
      !matchesRuleScope(rule.scope, 'request')
    ) {
      continue;
    }

    if (parsed.searchParams.has(rule.target)) {
      parsed.searchParams.set(rule.target, '[REDACTED]');
      changed = true;
    }
  }

  return changed ? parsed.toString() : url;
}

function applyUserDefinedRuleToText(
  text: string,
  normalizedContentType: string,
  rule: RedactionRule,
  requestScoped: boolean,
): string {
  switch (rule.kind) {
    case 'json-path':
      return redactJsonPathText(text, rule.target);
    case 'form-field':
      return redactKeyValueField(text, rule.target);
    case 'query-param':
      return requestScoped ? redactKeyValueField(text, rule.target) : text;
    case 'regex':
      return redactRegexText(text, rule.target);
    case 'cookie':
      return normalizedContentType.includes('cookie') ? redactCookieHeader(text, rule.target) : text;
    case 'header':
      return text;
    default:
      return text;
  }
}

function matchesRuleScope(
  ruleScope: RedactionRule['scope'],
  targetScope: 'request' | 'response',
): boolean {
  return ruleScope === 'both' || ruleScope === targetScope;
}

function redactCookieHeader(value: string, cookieName: string): string {
  const pattern = new RegExp(`(^|[;\\s])(${escapeForRegExp(cookieName)})=([^;]*)`, 'gi');
  return value.replace(pattern, (_match, prefix: string, key: string) => {
    return `${prefix}${key}=[REDACTED]`;
  });
}

function redactKeyValueField(text: string, key: string): string {
  const pattern = new RegExp(`(^|[?&])(${escapeForRegExp(key)})=([^&]*)`, 'gi');
  return text.replace(pattern, (_match, prefix: string, matchedKey: string) => {
    return `${prefix}${matchedKey}=[REDACTED]`;
  });
}

function redactRegexText(text: string, pattern: string): string {
  try {
    return text.replace(new RegExp(pattern, 'gi'), '[REDACTED]');
  } catch {
    return text;
  }
}

function redactJsonPathText(text: string, jsonPath: string): string {
  if (!jsonPath.startsWith('$.')) {
    return text;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const segments = jsonPath
      .slice(2)
      .split('.')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (segments.length === 0) {
      return text;
    }

    if (!redactJsonPathValue(parsed, segments)) {
      return text;
    }

    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function redactJsonPathValue(value: unknown, segments: string[]): boolean {
  if (segments.length === 0 || typeof value !== 'object' || value === null) {
    return false;
  }

  const [head, ...tail] = segments;
  const record = value as Record<string, unknown>;

  if (!(head in record)) {
    return false;
  }

  if (tail.length === 0) {
    record[head] = '[REDACTED]';
    return true;
  }

  return redactJsonPathValue(record[head], tail);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRestorableCheckpoint(checkpoint: Checkpoint): checkpoint is Checkpoint & {
  snapshot: BrowserContextSnapshot;
} {
  return checkpoint.status === 'valid' && checkpoint.snapshot !== undefined;
}
