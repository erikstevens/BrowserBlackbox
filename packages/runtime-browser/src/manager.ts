import { randomUUID } from 'node:crypto';
import type { Assertion, RecordedStep } from '@browser-blackbox/domain';
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
  private requestMap = new Map<string, { method: string; url: string }>();
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
    this.requestMap.clear();
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
    if (this.state.phase !== 'running' || this.page === null) {
      throw new Error('A managed browser session must be running before replay can execute.');
    }

    if (
      request.plan.mode === 'from-checkpoint' &&
      request.plan.startStrategy === 'checkpoint'
    ) {
      throw new Error(
        'Checkpoint restore is not implemented yet. Use Replay from start or Replay to step instead.',
      );
    }

    const stepsToExecute = this.resolveReplaySteps(request.steps, request.plan);
    const completedStepIds: string[] = [];
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

        await this.executeStep(step);
        completedStepIds.push(step.id);
        this.state = {
          ...this.state,
          pageUrl: this.page.url(),
          lastError: null,
        };
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
      if (requestId !== null) {
        this.requestMap.set(requestId, {
          method: requestMethod,
          url: requestUrl,
        });
      }
      this.emitEvent(
        'network',
        'network.request.started',
        'info',
        `${requestMethod} ${requestUrl}`,
        'cdp',
        {
          method: requestMethod,
          requestId,
          url: requestUrl,
        },
      );
      return;
    }

    if (method === 'Network.responseReceived') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const response = asRecord(params?.response);
      const requestRecord = requestId !== null ? this.requestMap.get(requestId) : undefined;
      const status = typeof response?.status === 'number' ? response.status : 'unknown';
      const responseUrl = typeof response?.url === 'string' ? response.url : 'unknown URL';
      this.emitEvent(
        'network',
        'network.response.received',
        'info',
        `Response ${status} from ${responseUrl}`,
        'cdp',
        {
          method: requestRecord?.method ?? null,
          requestId,
          status,
          url: responseUrl,
        },
      );
      return;
    }

    if (method === 'Network.loadingFailed') {
      const requestId = typeof params?.requestId === 'string' ? params.requestId : null;
      const requestRecord = requestId !== null ? this.requestMap.get(requestId) : undefined;
      const failedUrl = requestRecord?.url ?? 'request';
      const errorText = typeof params?.errorText === 'string' ? params.errorText : 'unknown failure';
      this.emitEvent(
        'network',
        'network.request.failed',
        'error',
        `Network loading failed for ${failedUrl}.`,
        'cdp',
        {
          errorText,
          method: requestRecord?.method ?? null,
          requestId,
          url: failedUrl,
        },
        errorText,
      );
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
  ): RecordedStep[] {
    if (
      plan.startStrategy === 'checkpoint' &&
      plan.mode !== 'from-checkpoint' &&
      plan.targetStepId !== null
    ) {
      this.emitEvent(
        'replay',
        'replay.checkpoint.fallback',
        'warn',
        'Checkpoint restore is not implemented yet. Falling back to replay from start.',
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

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
}
