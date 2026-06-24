import { describe, expect, it } from 'vitest';
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
  let disconnected = false;
  let detached = false;
  let pageUrl = 'about:blank';

  const page = {
    context: () => context,
    goto: async (targetUrl: string) => {
      pageUrl = targetUrl;
      navigatedUrls.push(targetUrl);
    },
    url: () => pageUrl,
  };

  const cdpSession = {
    detach: async () => {
      detached = true;
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
});
