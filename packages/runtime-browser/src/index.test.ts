import { describe, expect, it } from 'vitest';
import { domainVersions, type RecordedStep } from '@browser-blackbox/domain';
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
  let disconnected = false;
  let detached = false;
  let pageUrl = 'about:blank';
  let headingVisible = false;
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
      pageUrl = targetUrl;
      navigatedUrls.push(targetUrl);
      actionLog.push(`goto:${targetUrl}`);
    },
    reload: async () => {
      actionLog.push('reload');
    },
    dragAndDrop: async (source: string, target: string) => {
      actionLog.push(`drag:${source}->${target}`);
    },
    waitForEvent: async () => {
      throw new Error('waitForEvent not configured in this stub');
    },
    keyboard: {
      press: async (key: string) => {
        actionLog.push(`keyboard:${key}`);
      },
    },
    url: () => pageUrl,
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
    send: async (method: string) => {
      sentCommands.push(method);
      return undefined;
    },
  };

  const context = {
    newCDPSession: async () => cdpSession,
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
      navigatedUrls: () => [...navigatedUrls],
      sentCommands: () => [...sentCommands],
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
    manager.registerSurface(createSurfaceStub());
    manager.subscribe((event) => {
      observedMessages.push(event.message);
    });

    await manager.launch({ targetUrl: 'https://example.com/' });
    connectorStub.state.emitCdpEvent('Network.requestWillBeSent', {
      request: {
        method: 'GET',
        url: 'https://example.com/api/health',
      },
    });

    expect(observedMessages).toContain(
      'Launching managed browser session for https://example.com/.',
    );
    expect(observedMessages).toContain(
      'Playwright attached to the embedded Chromium target.',
    );
    expect(observedMessages).toContain('GET https://example.com/api/health');
  });

  it('executes supported replay steps against the attached page', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    manager.registerSurface(createSurfaceStub());
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
      plan: {
        mode: 'from-start',
        targetStepId: 'step-assert-dashboard',
        checkpointId: null,
        startStrategy: 'start',
        executionStepIds: steps.map((step) => step.id),
      },
    });

    expect(result.completedStepIds).toEqual(steps.map((step) => step.id));
    expect(connectorStub.state.actionLog()).toEqual([
      'goto:https://example.com/',
      'goto:https://example.com/login',
      'fill:label:Email:qa@example.test',
      'click:button:Sign in',
    ]);
  });

  it('rejects explicit from-checkpoint replay until checkpoint restore exists', async () => {
    const connectorStub = createConnectorStub();
    const manager = new BrowserSessionManager(connectorStub.connector);
    manager.registerSurface(createSurfaceStub());
    await manager.launch({ targetUrl: 'https://example.com/' });

    await expect(
      manager.executeReplay({
        steps: [],
        plan: {
          mode: 'from-checkpoint',
          targetStepId: null,
          checkpointId: 'checkpoint-1',
          startStrategy: 'checkpoint',
          executionStepIds: [],
        },
      }),
    ).rejects.toThrow('Checkpoint restore is not implemented yet.');
  });
});
