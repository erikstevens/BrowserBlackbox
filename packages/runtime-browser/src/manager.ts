import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  BrowserRuntimeState,
} from './contracts';

const DEFAULT_STATE: BrowserRuntimeState = {
  phase: 'idle',
  targetUrl: null,
  pageUrl: null,
  sessionId: null,
  lastError: null,
};

export class BrowserSessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private state: BrowserRuntimeState = DEFAULT_STATE;

  getState(): BrowserRuntimeState {
    return { ...this.state };
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

    await this.stop();
    this.state = {
      phase: 'launching',
      targetUrl: parsedUrl.toString(),
      pageUrl: null,
      sessionId: null,
      lastError: null,
    };

    try {
      this.browser = await chromium.launch({ headless: false });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      await this.page.goto(parsedUrl.toString(), { waitUntil: 'domcontentloaded' });

      this.state = {
        phase: 'running',
        targetUrl: parsedUrl.toString(),
        pageUrl: this.page.url(),
        sessionId: randomUUID(),
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
        lastError: message,
      };
      await this.disposeBrowser();
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
      lastError: null,
    };

    await this.disposeBrowser();
    this.state = { ...DEFAULT_STATE };
    return { state: this.getState() };
  }

  private async disposeBrowser(): Promise<void> {
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;

    if (browser !== null) {
      await browser.close();
    }
  }
}
