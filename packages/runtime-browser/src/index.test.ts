import { describe, expect, it } from 'vitest';
import { BrowserSessionManager } from './manager';

describe('BrowserSessionManager', () => {
  it('starts from an idle state', () => {
    const manager = new BrowserSessionManager();

    expect(manager.getState()).toEqual({
      phase: 'idle',
      targetUrl: null,
      pageUrl: null,
      sessionId: null,
      lastError: null,
    });
  });

  it('rejects invalid launch requests before touching Playwright', async () => {
    const manager = new BrowserSessionManager();

    await expect(manager.launch({ targetUrl: '' })).rejects.toThrow('Target URL is required.');
    await expect(manager.launch({ targetUrl: 'example' })).rejects.toThrow(
      'Target URL must be a valid absolute URL.',
    );
    await expect(manager.launch({ targetUrl: 'file:///tmp/index.html' })).rejects.toThrow(
      'Target URL must use http or https.',
    );
  });
});
