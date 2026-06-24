import { randomUUID } from 'node:crypto';
import type {
  BrowserLaunchRequest,
  BrowserRuntimeCommandResult,
  ManagedBrowserSurface,
  BrowserRuntimeState,
} from './contracts';

const DEFAULT_STATE: BrowserRuntimeState = {
  phase: 'idle',
  targetUrl: null,
  pageUrl: null,
  sessionId: null,
  cdpAttached: false,
  lastError: null,
};

export class BrowserSessionManager {
  private surface: ManagedBrowserSurface | null = null;
  private state: BrowserRuntimeState = DEFAULT_STATE;

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
      cdpAttached: false,
      lastError: null,
    };

    try {
      if (!this.surface.isDebuggerAttached()) {
        this.surface.attachDebugger('1.3');
      }

      await this.surface.sendDebuggerCommand('Page.enable');
      await this.surface.sendDebuggerCommand('Network.enable');
      await this.surface.loadURL(parsedUrl.toString());

      this.state = {
        phase: 'running',
        targetUrl: parsedUrl.toString(),
        pageUrl: this.surface.getURL(),
        sessionId: randomUUID(),
        cdpAttached: this.surface.isDebuggerAttached(),
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
        cdpAttached: this.surface?.isDebuggerAttached() ?? false,
        lastError: message,
      };
      await this.disposeSurface();
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
      cdpAttached: this.surface?.isDebuggerAttached() ?? false,
      lastError: null,
    };

    await this.disposeSurface();
    this.state = { ...DEFAULT_STATE };
    return { state: this.getState() };
  }

  private async disposeSurface(): Promise<void> {
    if (this.surface !== null && this.surface.isDebuggerAttached()) {
      this.surface.detachDebugger();
    }
  }
}
