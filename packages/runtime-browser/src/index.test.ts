import { describe, expect, it } from 'vitest';
import type { ManagedBrowserSurface } from './contracts';
import { BrowserSessionManager } from './manager';

function createSurfaceStub(): ManagedBrowserSurface {
  let attached = false;
  let pageUrl = 'about:blank';

  return {
    attachDebugger: () => {
      attached = true;
    },
    detachDebugger: () => {
      attached = false;
    },
    getURL: () => pageUrl,
    isDebuggerAttached: () => attached,
    loadURL: async (targetUrl) => {
      pageUrl = targetUrl;
    },
    sendDebuggerCommand: async () => undefined,
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
    const manager = new BrowserSessionManager();
    manager.registerSurface(createSurfaceStub());

    const launch = await manager.launch({ targetUrl: 'https://example.com/' });
    expect(launch.state.phase).toBe('running');
    expect(launch.state.pageUrl).toBe('https://example.com/');
    expect(launch.state.cdpAttached).toBe(true);

    const stop = await manager.stop();
    expect(stop.state).toEqual({
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      cdpAttached: false,
      lastError: null,
    });
  });
});
