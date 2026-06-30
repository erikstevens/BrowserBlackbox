import { describe, expect, it } from 'vitest';
import { checkpointFixture, domainVersions, type RecordedStep } from '@browser-blackbox/domain';
import type { ManagedBrowserSurface } from './contracts';
import { BrowserSessionManager } from './manager';

function createSurfaceStub(): ManagedBrowserSurface {
  let pageUrl = 'about:blank';

  return {
    getCdpEndpoint: () => 'http://127.0.0.1:9333',
    getURL: () => pageUrl,
  };
}

function createConnectorStub() {
  const sentCommands: string[] = [];
  const navigatedUrls: string[] = [];
  const actionLog: string[] = [];
  const restoredCookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }> = [];
  const responseBodies = new Map<string, { body: string; base64Encoded: boolean }>();
  let disconnected = false;
  let detached = false;
  let pageUrl = 'about:blank';
  let headingVisible = false;
  let currentOrigin = 'about:blank';
  const localStorageByOrigin = new Map<string, Record<string, string>>();
  const sessionStorageByOrigin = new Map<string, Record<string, string>>();
  let waitForEventHandler:
    | ((event: 'dialog' | 'download' | 'popup') => Promise<unknown>)
    | null = null;
  const routeHandlers: Array<(route: {
    request: () => { url: () => string; method: () => string; headers: () => Record<string, string> };
    continue: () => Promise<void>;
    abort: (errorCode?: string) => Promise<void>;
    fulfill: (options: {
      status?: number;
      contentType?: string;
      body?: string;
      headers?: Record<string, string>;
    }) => Promise<void>;
  }) => Promise<void>> = [];
  let cdpEventListener:
    | ((data: { method: string; params?: Record<string, unknown> }) => void)
    | null = null;

  function createLocator(label: string, kind: 'button' | 'label' | 'heading') {
    return {
      click: async () => {
        actionLog.push(`click:${label}`);
        if (label.includes('Sign in')) {
          headingVisible = true;
        }
      },
      dblclick: async () => {
        actionLog.push(`dblclick:${label}`);
      },
      fill: async (value: string) => {
        actionLog.push(`fill:${label}:${value}`);
      },
      selectOption: async (value: string) => {
        actionLog.push(`select:${label}:${value}`);
      },
      setChecked: async (checked: boolean) => {
        actionLog.push(`checked:${label}:${checked}`);
      },
      press: async (key: string) => {
        actionLog.push(`press:${label}:${key}`);
      },
      waitFor: async ({ state }: { state: 'visible' | 'hidden'; timeout?: number }) => {
        const visible = kind === 'heading' ? headingVisible : true;
        if ((state === 'visible' && !visible) || (state === 'hidden' && visible)) {
          throw new Error(`waitFor ${label} failed`);
        }
      },
      isEnabled: async () => true,
      textContent: async () => (kind === 'heading' && headingVisible ? 'Dashboard' : label),
    };
  }

  const page = {
    context: () => context,
    goto: async (targetUrl: string) => {
      let abortedWith: string | null = null;
      let fulfilledStatus: number | null = null;
      for (const handler of routeHandlers) {
        await handler({
          request: () => ({
            url: () => targetUrl,
            method: () => 'GET',
            headers: () => ({}),
          }),
          continue: async () => {
            actionLog.push(`continue:${targetUrl}`);
          },
          abort: async (errorCode?: string) => {
            abortedWith = errorCode ?? 'aborted';
            actionLog.push(`abort:${targetUrl}:${abortedWith}`);
          },
          fulfill: async (options) => {
            fulfilledStatus = options.status ?? 200;
            actionLog.push(`fulfill:${targetUrl}:${fulfilledStatus}`);
          },
        });
        if (abortedWith || fulfilledStatus !== null) {
          break;
        }
      }
      if (abortedWith) {
        throw new Error(`route aborted with ${abortedWith}`);
      }
      pageUrl = targetUrl;
      currentOrigin = new URL(targetUrl).origin;
      navigatedUrls.push(targetUrl);
      actionLog.push(`goto:${targetUrl}`);
    },
    reload: async () => {
      actionLog.push('reload');
    },
    dragAndDrop: async (source: string, target: string) => {
      actionLog.push(`drag:${source}->${target}`);
    },
    waitForEvent: async (event: 'dialog' | 'download' | 'popup') => {
      if (waitForEventHandler) {
        return waitForEventHandler(event);
      }
      throw new Error('waitForEvent not configured in this stub');
    },
    keyboard: {
      press: async (key: string) => {
        actionLog.push(`keyboard:${key}`);
      },
    },
    url: () => pageUrl,
    evaluate: async (pageFunction: unknown, arg?: unknown) => {
      if (typeof pageFunction !== 'function') {
        throw new Error('evaluate stub requires a function');
      }

      const source = String(pageFunction);
      if (source.includes('readStorage')) {
        return [
          {
            origin: currentOrigin,
            localStorage: localStorageByOrigin.get(currentOrigin) ?? {},
            sessionStorage: sessionStorageByOrigin.get(currentOrigin) ?? {},
          },
        ] as unknown;
      }

      const payload = arg as {
        localStorageEntries: Record<string, string>;
        sessionStorageEntries: Record<string, string>;
      };
      localStorageByOrigin.set(currentOrigin, { ...payload.localStorageEntries });
      sessionStorageByOrigin.set(currentOrigin, { ...payload.sessionStorageEntries });
      actionLog.push(`restore-storage:${currentOrigin}`);
      return undefined as unknown;
    },
    getByRole: (role: string, options?: { name?: string }) =>
      createLocator(`${role}:${options?.name ?? ''}`, role === 'heading' ? 'heading' : 'button'),
    getByLabel: (label: string) => createLocator(`label:${label}`, 'label'),
  };

  const cdpSession = {
    detach: async () => {
      detached = true;
    },
    on: (_event: 'event', listener: (data: { method: string; params?: Record<string, unknown> }) => void) => {
      cdpEventListener = listener;
    },
    send: async (method: string, params?: Record<string, unknown>) => {
      sentCommands.push(method);
      if (method === 'Network.getResponseBody') {
        const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
        return responseBodies.get(requestId) ?? {
          body: '',
          base64Encoded: false,
        };
      }
      return undefined;
    },
  };

  const context = {
    newCDPSession: async () => cdpSession,
    cookies: async () => [
      {
        name: 'session',
        value: 'opaque-session',
        domain: 'example.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      },
    ],
    addCookies: async (cookies: typeof restoredCookies) => {
      restoredCookies.splice(0, restoredCookies.length, ...cookies);
      actionLog.push(`restore-cookies:${cookies.length}`);
    },
    clearCookies: async () => {
      restoredCookies.splice(0, restoredCookies.length);
      actionLog.push('clear-cookies');
    },
    route: async (
      _url: string | RegExp,
      handler: (route: {
        request: () => { url: () => string; method: () => string; headers: () => Record<string, string> };
        continue: () => Promise<void>;
        abort: (errorCode?: string) => Promise<void>;
        fulfill: (options: {
          status?: number;
          contentType?: string;
          body?: string;
          headers?: Record<string, string>;
        }) => Promise<void>;
      }) => Promise<void>,
    ) => {
      routeHandlers.push(handler);
      actionLog.push('route:install');
    },
    unroute: async (
      _url: string | RegExp,
      handler: (route: {
        request: () => { url: () => string; method: () => string; headers: () => Record<string, string> };
        continue: () => Promise<void>;
        abort: (errorCode?: string) => Promise<void>;
        fulfill: (options: {
          status?: number;
          contentType?: string;
          body?: string;
          headers?: Record<string, string>;
        }) => Promise<void>;
      }) => Promise<void>,
    ) => {
      const index = routeHandlers.findIndex((entry) => entry === handler);
      if (index >= 0) {
        routeHandlers.splice(index, 1);
      }
      actionLog.push('route:remove');
    },
    pages: () => [page],
  };

  const browser = {
    contexts: () => [context],
    close: async () => {
      disconnected = true;
    },
  };

  return {
    connector: {
      connect: async () => browser,
    },
    state: {
      detached: () => detached,
      disconnected: () => disconnected,
      emitCdpEvent: (method: string, params?: Record<string, unknown>) => {
        cdpEventListener?.({ method, params });
      },
      actionLog: () => [...actionLog],
      restoredCookies: () => [...restoredCookies],
      navigatedUrls: () => [...navigatedUrls],
      sentCommands: () => [...sentCommands],
      seedOriginState: (
        origin: string,
        localStorage: Record<string, string>,
        sessionStorage: Record<string, string>,
      ) => {
        localStorageByOrigin.set(origin, { ...localStorage });
        sessionStorageByOrigin.set(origin, { ...sessionStorage });
      },
      setResponseBody: (
        requestId: string,
        body: string,
        base64Encoded = false,
      ) => {
        responseBodies.set(requestId, {
          body,
          base64Encoded,
        });
      },
      setWaitForEventHandler: (
        handler: (event: 'dialog' | 'download' | 'popup') => Promise<unknown>,
      ) => {
        waitForEventHandler = handler;
      },
    },
  };
}

describe('BrowserSessionManager', () => {
  it('starts from an idle state', () => {
    const manager = new BrowserSessionManager();

    expect(manager.getState()).toEqual({
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    });
  });

  it('rejects invalid launch requests before touching the embedded surface', async () => {
    const manager = new BrowserSessionManager();
    manager.registerSurface(createSurfaceStub());

    await expect(manager.launch({ targetUrl: '' })).rejects.toThrow('Target URL is required.');
    await expect(manager.launch({ targetUrl: 'example' })).rejects.toThrow(
      'Target URL must be a valid absolute URL.',
    );
    await expect(manager.launch({ targetUrl: 'file:///tmp/index.html' })).rejects.toThrow(
      'Target URL must use http or https.',
    );
  });

  it('launches and stops against the registered embedded surface', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    manager.registerSurface(createSurfaceStub());

    const launch = await manager.launch({ targetUrl: 'https://example.com/' });
    expect(launch.state.phase).toBe('running');
    expect(launch.state.pageUrl).toBe('https://example.com/');
    expect(launch.state.playwrightAttached).toBe(true);
    expect(launch.state.cdpAttached).toBe(true);
    expect(connectorStub.state.sentCommands()).toEqual(['Page.enable', 'Network.enable']);
    expect(connectorStub.state.navigatedUrls()).toEqual(['https://example.com/']);

    const stop = await manager.stop();
    expect(stop.state).toEqual({
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      playwrightAttached: false,
      cdpAttached: false,
      lastError: null,
    });
    expect(connectorStub.state.detached()).toBe(true);
    expect(connectorStub.state.disconnected()).toBe(true);
  });

  it('emits lifecycle and network events for observers', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedMessages: string[] = [];
    const observedEvents: Array<{ code: string; data?: Record<string, unknown> }> = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedMessages.push(event.message);
      observedEvents.push({
        code: event.code,
        data: event.data,
      });
    });

    await manager.launch({ targetUrl: 'https://example.com/' });
    connectorStub.state.setResponseBody(
      'request-1',
      JSON.stringify({ ok: true, token: 'opaque-token' }),
    );
    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-1',
      request: {
        method: 'GET',
        url: 'https://example.com/api/health',
        headers: {
          Authorization: 'Bearer top-secret',
          'X-Request-Id': 'req-123',
        },
        postData: JSON.stringify({
          password: 'secret-password',
        }),
      },
    });
    connectorStub.state.emitCdpEvent('Network.responseReceived', {
      requestId: 'request-1',
      response: {
        status: 200,
        url: 'https://example.com/api/health',
        protocol: 'h2',
        fromDiskCache: true,
        fromServiceWorker: false,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'session=opaque',
          'X-Request-Id': 'req-123',
        },
        timing: {
          dnsStart: 0,
          dnsEnd: 5,
          connectStart: 5,
          connectEnd: 15,
          sslStart: 15,
          sslEnd: 25,
          sendStart: 25,
          sendEnd: 35,
          receiveHeadersEnd: 80,
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedMessages).toContain(
      'Launching managed browser session for https://example.com/.',
    );
    expect(observedMessages).toContain(
      'Playwright attached to the embedded Chromium target.',
    );
    expect(observedMessages).toContain('GET https://example.com/api/health');
    expect(observedEvents.find((event) => event.code === 'network.request.started')?.data)
      .toMatchObject({
        body: {
          state: 'redacted',
          redactionRuleIds: ['rule-password'],
        },
        headers: {
          authorization: '[REDACTED]',
          'x-request-id': 'req-123',
        },
      });
    expect(observedEvents.find((event) => event.code === 'network.response.received')?.data)
      .toMatchObject({
        correlationIds: ['x-request-id:req-123'],
        durationMs: 80,
        fromCache: true,
        fromServiceWorker: false,
        headers: {
          'content-type': 'application/json',
          'set-cookie': '[REDACTED]',
          'x-request-id': 'req-123',
        },
        protocol: 'http',
        status: 200,
        timings: {
          dnsMs: 5,
          connectMs: 10,
          tlsMs: 10,
          requestMs: 10,
          responseMs: 45,
        },
      });
    expect(observedEvents.find((event) => event.code === 'network.response.body.captured')?.data)
      .toMatchObject({
        requestId: 'request-1',
        responseBody: {
          state: 'redacted',
          redactionRuleIds: ['rule-token'],
        },
      });
  });

  it('excludes sensitive response bodies and truncates oversized payloads by policy', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedEvents: Array<{ code: string; data?: Record<string, unknown> }> = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedEvents.push({
        code: event.code,
        data: event.data,
      });
    });

    await manager.launch({ targetUrl: 'https://example.com/' });

    connectorStub.state.setResponseBody(
      'request-sensitive',
      JSON.stringify({ token: 'opaque', session: 'super-secret' }),
    );
    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-sensitive',
      request: {
        method: 'POST',
        url: 'https://example.com/api/login',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });
    connectorStub.state.emitCdpEvent('Network.responseReceived', {
      requestId: 'request-sensitive',
      response: {
        status: 200,
        url: 'https://example.com/api/login',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });

    connectorStub.state.setResponseBody(
      'request-large',
      'x'.repeat(262_145),
    );
    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-large',
      request: {
        method: 'GET',
        url: 'https://example.com/api/report',
        headers: {
          Accept: 'application/json',
        },
      },
    });
    connectorStub.state.emitCdpEvent('Network.responseReceived', {
      requestId: 'request-large',
      response: {
        status: 200,
        url: 'https://example.com/api/report',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      observedEvents.find((event) => event.code === 'network.response.body.captured' && event.data?.requestId === 'request-sensitive')?.data,
    ).toMatchObject({
      requestId: 'request-sensitive',
      responseBody: {
        state: 'excluded',
      },
    });
    expect(
      observedEvents.find((event) => event.code === 'network.response.body.captured' && event.data?.requestId === 'request-large')?.data,
    ).toMatchObject({
      requestId: 'request-large',
      responseBody: {
        state: 'truncated',
      },
    });
  });

  it('applies user-defined redaction rules to live request and response capture', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedEvents: Array<{ code: string; data?: Record<string, unknown> }> = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedEvents.push({
        code: event.code,
        data: event.data,
      });
    });

    await manager.launch({
      targetUrl: 'https://example.com/',
      redactionRules: [
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'rule-user-account-id',
          kind: 'query-param',
          target: 'accountId',
          scope: 'request',
          mode: 'user-defined',
        },
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'rule-user-email',
          kind: 'json-path',
          target: '$.profile.email',
          scope: 'both',
          mode: 'user-defined',
        },
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'rule-user-trace',
          kind: 'header',
          target: 'X-Trace-Token',
          scope: 'request',
          mode: 'user-defined',
        },
      ],
    });

    connectorStub.state.setResponseBody(
      'request-user-rules',
      JSON.stringify({
        profile: {
          email: 'qa@example.test',
        },
      }),
    );
    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-user-rules',
      request: {
        method: 'POST',
        url: 'https://example.com/api/customer?accountId=abc123',
        headers: {
          'Content-Type': 'application/json',
          'X-Trace-Token': 'trace-secret',
        },
        postData: JSON.stringify({
          profile: {
            email: 'qa@example.test',
          },
        }),
      },
    });
    connectorStub.state.emitCdpEvent('Network.responseReceived', {
      requestId: 'request-user-rules',
      response: {
        status: 200,
        url: 'https://example.com/api/customer?accountId=abc123',
        headers: {
          'Content-Type': 'application/json',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedEvents.find((event) => event.code === 'network.request.started')?.data)
      .toMatchObject({
        headers: {
          'x-trace-token': '[REDACTED]',
        },
        body: {
          state: 'redacted',
          text: '{"profile":{"email":"[REDACTED]"}}',
          redactionRuleIds: ['rule-user-email'],
        },
        url: 'https://example.com/api/customer?accountId=%5BREDACTED%5D',
      });
    expect(observedEvents.find((event) => event.code === 'network.response.received')?.data)
      .toMatchObject({
        url: 'https://example.com/api/customer?accountId=%5BREDACTED%5D',
      });
    expect(observedEvents.find((event) => event.code === 'network.response.body.captured')?.data)
      .toMatchObject({
        requestId: 'request-user-rules',
        responseBody: {
          state: 'redacted',
          text: '{"profile":{"email":"[REDACTED]"}}',
          redactionRuleIds: ['rule-user-email'],
        },
      });
  });

  it('tracks retry and blocked metadata for repeated failed requests', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedEvents: Array<{ code: string; data?: Record<string, unknown>; detail?: string }> = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedEvents.push({
        code: event.code,
        data: event.data,
        detail: event.detail,
      });
    });

    await manager.launch({ targetUrl: 'https://example.com/' });

    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-retry-1',
      request: {
        method: 'GET',
        url: 'https://example.com/api/retry',
        headers: {},
      },
    });
    connectorStub.state.emitCdpEvent('Network.loadingFailed', {
      requestId: 'request-retry-1',
      errorText: 'Blocked by client',
      blockedReason: 'inspector',
    });

    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      requestId: 'request-retry-2',
      request: {
        method: 'GET',
        url: 'https://example.com/api/retry',
        headers: {},
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      observedEvents.find((event) => event.code === 'network.request.failed')?.data,
    ).toMatchObject({
      blocked: true,
      blockedReason: 'inspector',
      protocol: 'http',
      retryCount: 0,
    });
    expect(
      observedEvents
        .filter((event) => event.code === 'network.request.started')
        .at(-1)?.data,
    ).toMatchObject({
      protocol: 'http',
      retryCount: 1,
      url: 'https://example.com/api/retry',
    });
  });

  it('captures websocket handshake traffic as websocket protocol evidence', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedEvents: Array<{ code: string; data?: Record<string, unknown> }> = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedEvents.push({
        code: event.code,
        data: event.data,
      });
    });

    await manager.launch({ targetUrl: 'https://example.com/' });

    connectorStub.state.emitCdpEvent('Network.webSocketCreated', {
      requestId: 'ws-1',
      url: 'wss://example.com/socket?sessionId=abc123',
    });
    connectorStub.state.emitCdpEvent('Network.webSocketWillSendHandshakeRequest', {
      requestId: 'ws-1',
      request: {
        headers: {
          'X-Request-Id': 'ws-123',
          Cookie: 'session=opaque',
        },
      },
    });
    connectorStub.state.emitCdpEvent('Network.webSocketHandshakeResponseReceived', {
      requestId: 'ws-1',
      response: {
        status: 101,
        headers: {
          'X-Request-Id': 'ws-123',
          'Set-Cookie': 'session=opaque',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedEvents.find((event) => event.code === 'network.request.started')?.data)
      .toMatchObject({
        protocol: 'websocket',
        method: 'GET',
        retryCount: 0,
        url: 'wss://example.com/socket?sessionId=abc123',
      });
    expect(observedEvents.find((event) => event.code === 'network.response.received')?.data)
      .toMatchObject({
        correlationIds: ['x-request-id:ws-123'],
        protocol: 'websocket',
        retryCount: 0,
        status: 101,
        url: 'wss://example.com/socket?sessionId=abc123',
      });
  });

  it('executes supported replay steps against the attached page', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedCodes: string[] = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedCodes.push(event.code);
    });
    await manager.launch({ targetUrl: 'https://example.com/' });

    const steps: RecordedStep[] = [
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-open-login',
        title: 'Open login page',
        kind: 'action',
        status: 'active',
        evidenceState: 'stale',
        createdAt: '2026-06-25T12:00:00.000Z',
        updatedAt: '2026-06-25T12:00:00.000Z',
        dependencyStepIds: [],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'navigate',
          url: 'https://example.com/login',
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-fill-email',
        title: 'Fill email',
        kind: 'action',
        status: 'active',
        evidenceState: 'stale',
        createdAt: '2026-06-25T12:00:00.000Z',
        updatedAt: '2026-06-25T12:00:00.000Z',
        dependencyStepIds: ['step-open-login'],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'fill',
          selector: 'page.getByLabel("Email")',
          value: 'qa@example.test',
          sensitive: false,
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-submit-login',
        title: 'Submit login form',
        kind: 'action',
        status: 'active',
        evidenceState: 'stale',
        createdAt: '2026-06-25T12:00:00.000Z',
        updatedAt: '2026-06-25T12:00:00.000Z',
        dependencyStepIds: ['step-fill-email'],
        invalidatesEvidenceAfter: true,
        action: {
          type: 'click',
          selector: 'page.getByRole("button", { name: "Sign in" })',
        },
      },
      {
        schemaVersion: domainVersions.domainSchemaVersion,
        id: 'step-assert-dashboard',
        title: 'Assert dashboard heading',
        kind: 'assertion',
        status: 'active',
        evidenceState: 'stale',
        createdAt: '2026-06-25T12:00:00.000Z',
        updatedAt: '2026-06-25T12:00:00.000Z',
        dependencyStepIds: ['step-submit-login'],
        invalidatesEvidenceAfter: true,
        assertion: {
          schemaVersion: domainVersions.domainSchemaVersion,
          kind: 'element-visible',
          selector: 'page.getByRole("heading", { name: "Dashboard" })',
        },
      },
    ];

    const result = await manager.executeReplay({
      targetUrl: 'https://example.com/login',
      steps,
      checkpoints: [
        {
          ...checkpointFixture,
          id: 'checkpoint-dashboard',
          stepId: 'step-assert-dashboard',
          dependencyStepIds: steps.map((step) => step.id),
        },
      ],
      plan: {
        mode: 'from-start',
        targetStepId: 'step-assert-dashboard',
        checkpointId: null,
        startStrategy: 'start',
        executionStepIds: steps.map((step) => step.id),
      },
    });

    expect(result.completedStepIds).toEqual(steps.map((step) => step.id));
    expect(result.capturedCheckpoints).toHaveLength(1);
    expect(result.capturedCheckpoints[0]?.checkpointId).toBe('checkpoint-dashboard');
    expect(result.capturedCheckpoints[0]?.snapshot.pageUrl).toBe('https://example.com/login');
    expect(connectorStub.state.actionLog()).toEqual([
      'goto:https://example.com/',
      'goto:https://example.com/login',
      'fill:label:Email:qa@example.test',
      'click:button:Sign in',
    ]);
    expect(observedCodes).toContain('replay.assertion.passed');
  });

  it('emits replay failure events for missing popup triggers', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedEvents: Array<{ code: string; detail?: string; data?: Record<string, unknown> }> =
      [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedEvents.push({
        code: event.code,
        detail: event.detail,
        data: event.data,
      });
    });
    connectorStub.state.setWaitForEventHandler(async (event) => {
      throw new Error(`${event} timed out`);
    });
    await manager.launch({ targetUrl: 'https://example.com/' });

    await expect(
      manager.executeReplay({
        targetUrl: 'https://example.com/',
        steps: [
          {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: 'step-wait-popup',
            title: 'Wait for popup',
            kind: 'action',
            status: 'active',
            evidenceState: 'stale',
            createdAt: '2026-06-25T12:00:00.000Z',
            updatedAt: '2026-06-25T12:00:00.000Z',
            dependencyStepIds: [],
            invalidatesEvidenceAfter: true,
            action: {
              type: 'wait-for-popup',
            },
          },
        ],
        checkpoints: [],
        plan: {
          mode: 'from-start',
          targetStepId: 'step-wait-popup',
          checkpointId: null,
          startStrategy: 'start',
          executionStepIds: ['step-wait-popup'],
        },
      }),
    ).rejects.toThrow('popup timed out');

    expect(observedEvents.find((event) => event.code === 'replay.step.failed')).toMatchObject({
      detail: 'popup timed out',
      data: {
        actionType: 'wait-for-popup',
        stepId: 'step-wait-popup',
        stepKind: 'action',
      },
    });
  });

  it('restores and resumes from a compatible checkpoint snapshot', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    manager.registerSurface(createSurfaceStub());
    await manager.launch({ targetUrl: 'https://example.com/' });
    connectorStub.state.seedOriginState(
      'https://example.com',
      { auth_state: 'signed-in' },
      { dashboard_tab: 'overview' },
    );

    const checkpoint = {
      ...checkpointFixture,
      id: 'checkpoint-dashboard',
      label: 'Dashboard state',
      stepId: 'step-submit-login',
      dependencyStepIds: ['step-open-login', 'step-fill-email', 'step-submit-login'],
      snapshot: {
        capturedAt: '2026-06-25T12:03:00.000Z',
        pageUrl: 'https://example.com/dashboard',
        cookies: [
          {
            name: 'session',
            value: 'restored-token',
            domain: 'example.com',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const,
          },
        ],
        origins: [
          {
            origin: 'https://example.com',
            localStorage: {
              auth_state: 'signed-in',
            },
            sessionStorage: {
              dashboard_tab: 'overview',
            },
          },
        ],
      },
    };

    const result = await manager.executeReplay({
      steps: [
        {
          schemaVersion: domainVersions.domainSchemaVersion,
          id: 'step-assert-dashboard',
          title: 'Assert dashboard heading',
          kind: 'assertion',
          status: 'active',
          evidenceState: 'stale',
          createdAt: '2026-06-25T12:00:00.000Z',
          updatedAt: '2026-06-25T12:00:00.000Z',
          dependencyStepIds: ['step-submit-login'],
          invalidatesEvidenceAfter: true,
          assertion: {
            schemaVersion: domainVersions.domainSchemaVersion,
            kind: 'url-matches',
            expectedUrl: 'https://example.com/dashboard',
            matchMode: 'exact',
          },
        },
      ],
      checkpoints: [checkpoint],
      plan: {
        mode: 'from-checkpoint',
        targetStepId: 'step-assert-dashboard',
        checkpointId: checkpoint.id,
        startStrategy: 'checkpoint',
        executionStepIds: ['step-assert-dashboard'],
      },
    });

    expect(result.restoredCheckpointId).toBe(checkpoint.id);
    expect(connectorStub.state.restoredCookies()).toEqual(checkpoint.snapshot?.cookies ?? []);
    expect(connectorStub.state.actionLog()).toContain('clear-cookies');
    expect(connectorStub.state.actionLog()).toContain('restore-storage:https://example.com');
    expect(connectorStub.state.actionLog()).toContain('goto:https://example.com/dashboard');
  });

  it('applies route-block simulation rules during replay and emits timeline-friendly events', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    const observedCodes: string[] = [];
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedCodes.push(event.code);
    });
    await manager.launch({ targetUrl: 'https://example.com/' });

    await expect(
      manager.executeReplay({
        targetUrl: 'https://example.com/',
        steps: [
          {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: 'step-open-home',
            title: 'Open home',
            kind: 'action',
            status: 'active',
            evidenceState: 'stale',
            createdAt: '2026-06-25T12:00:00.000Z',
            updatedAt: '2026-06-25T12:00:00.000Z',
            dependencyStepIds: [],
            invalidatesEvidenceAfter: true,
            action: {
              type: 'navigate',
              url: 'https://example.com/home',
            },
          },
        ],
        checkpoints: [],
        plan: {
          mode: 'from-start',
          targetStepId: 'step-open-home',
          checkpointId: null,
          startStrategy: 'start',
          executionStepIds: ['step-open-home'],
        },
        simulationRules: [
          {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: 'sim-domain-status',
            enabled: true,
            title: 'Domain status override',
            appliesTo: 'global',
            match: {
              domain: 'example.com',
              method: 'GET',
            },
            action: {
              kind: 'forced-status',
              status: 503,
            },
          },
          {
            schemaVersion: domainVersions.domainSchemaVersion,
            id: 'sim-exact-block',
            enabled: true,
            title: 'Block home route',
            appliesTo: 'global',
            match: {
              routePattern: 'https://example.com/home',
              method: 'GET',
            },
            action: {
              kind: 'route-block',
            },
          },
        ],
      }),
    ).rejects.toThrow('route aborted with blockedbyclient');

    expect(connectorStub.state.actionLog()).toContain('route:install');
    expect(connectorStub.state.actionLog()).toContain(
      'abort:https://example.com/home:blockedbyclient',
    );
    expect(connectorStub.state.actionLog()).not.toContain(
      'fulfill:https://example.com/home:503',
    );
    expect(observedCodes).toContain('replay.simulation_rule.applied');
    expect(observedCodes).toContain('replay.execution.failed');
  });
});
