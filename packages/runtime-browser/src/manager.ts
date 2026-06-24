import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  ManagedBrowserSurface,
  BrowserRuntimeState,
} from './contracts';

type ConnectedCdpSession = {
  detach: () => Promise<void>;
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
  private surface: ManagedBrowserSurface | null = null;
  private state: BrowserRuntimeState = DEFAULT_STATE;

  constructor(private readonly connector: PlaywrightConnector = defaultConnector) {}

  getState(): BrowserRuntimeState {
    return { ...this.state };
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

    try {
      const browser = await this.connector.connect(this.surface.getCdpEndpoint());
      const page = await this.resolveEmbeddedPage(browser, this.surface.getURL());
      const cdpSession = await page.context().newCDPSession(page);

      await cdpSession.send('Page.enable');
      await cdpSession.send('Network.enable');
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

    await this.disposeConnection();
    this.state = { ...DEFAULT_STATE };
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
}

const defaultConnector: PlaywrightConnector = {
  connect: async (endpointUrl) => chromium.connectOverCDP(endpointUrl) as unknown as ConnectedBrowser,
};
