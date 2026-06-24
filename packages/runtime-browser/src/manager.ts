import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeEvent,
  BrowserRuntimeEventCategory,
  BrowserRuntimeEventLevel,
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

type ConnectedPage = {
  context: () => {
    newCDPSession: (page: ConnectedPage) => Promise<ConnectedCdpSession>;
  };
  goto: (targetUrl: string) => Promise<unknown>;
  url: () => string;
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
  private listeners = new Set<(event: BrowserRuntimeEvent) => void>();
  private surface: ManagedBrowserSurface | null = null;
  private state: BrowserRuntimeState = DEFAULT_STATE;

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
    this.state = {
      phase: 'launching',
      targetUrl: parsedUrl.toString(),
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    };
    this.emitEvent('lifecycle', 'info', `Launching managed browser session for ${parsedUrl.toString()}.`);

    try {
      const browser = await this.connector.connect(this.surface.getCdpEndpoint());
      this.emitEvent('lifecycle', 'info', 'Playwright attached to the embedded Chromium target.');

      const page = await this.resolveEmbeddedPage(browser, this.surface.getURL());
      const cdpSession = await page.context().newCDPSession(page);
      cdpSession.on('event', ({ method, params }) => {
        this.handleCdpEvent(method, params);
      });

      await cdpSession.send('Page.enable');
      await cdpSession.send('Network.enable');
      this.emitEvent('lifecycle', 'info', 'CDP page and network domains enabled.');

      await page.goto(parsedUrl.toString());

      this.browser = browser;
      this.cdpSession = cdpSession;

      this.state = {
        phase: 'running',
        targetUrl: parsedUrl.toString(),
        pageUrl: page.url(),
        sessionId: randomUUID(),
        playwrightAttached: true,
        cdpAttached: true,
        lastError: null,
      };
      this.emitEvent('browser', 'info', `Navigation completed for ${page.url()}.`);

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
      this.emitEvent('lifecycle', 'error', 'Managed browser session launch failed.', message);
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
    this.emitEvent('lifecycle', 'info', 'Stopping managed browser session.');

    await this.disposeConnection();
    this.state = { ...DEFAULT_STATE };
    this.emitEvent('lifecycle', 'info', 'Managed browser session stopped.');
    return { state: this.getState() };
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
      const requestMethod = typeof request?.method === 'string' ? request.method : 'UNKNOWN';
      const requestUrl = typeof request?.url === 'string' ? request.url : 'unknown URL';
      this.emitEvent('network', 'info', `${requestMethod} ${requestUrl}`);
      return;
    }

    if (method === 'Network.responseReceived') {
      const response = asRecord(params?.response);
      const status = typeof response?.status === 'number' ? response.status : 'unknown';
      const responseUrl = typeof response?.url === 'string' ? response.url : 'unknown URL';
      this.emitEvent('network', 'info', `Response ${status} from ${responseUrl}`);
      return;
    }

    if (method === 'Network.loadingFailed') {
      const failedUrl = typeof params?.blockedReason === 'string' ? params.blockedReason : 'request';
      const errorText = typeof params?.errorText === 'string' ? params.errorText : 'unknown failure';
      this.emitEvent('network', 'error', `Network loading failed for ${failedUrl}.`, errorText);
      return;
    }

    if (method === 'Page.frameNavigated') {
      const frame = asRecord(params?.frame);
      const frameUrl = typeof frame?.url === 'string' ? frame.url : null;
      if (frameUrl !== null) {
        this.emitEvent('browser', 'info', `Frame navigated to ${frameUrl}.`);
      }
    }
  }

  private emitEvent(
    category: BrowserRuntimeEventCategory,
    level: BrowserRuntimeEventLevel,
    message: string,
    detail?: string,
  ): void {
    const event: BrowserRuntimeEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      level,
      message,
      ...(detail ? { detail } : {}),
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

const defaultConnector: PlaywrightConnector = {
  connect: async (endpointUrl) => chromium.connectOverCDP(endpointUrl) as unknown as ConnectedBrowser,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return null;
}
