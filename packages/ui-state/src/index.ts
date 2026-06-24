import { create } from 'zustand';

type WorkspaceState = {
  targetUrl: string;
  browserRuntime: {
    phase: 'idle' | 'launching' | 'running' | 'stopping' | 'error';
    targetUrl: string | null;
    pageUrl: string | null;
    sessionId: string | null;
    cdpAttached: boolean;
    lastError: string | null;
  };
  setTargetUrl: (targetUrl: string) => void;
  setBrowserRuntime: (browserRuntime: WorkspaceState['browserRuntime']) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  targetUrl: 'https://example.com',
  browserRuntime: {
    phase: 'idle',
    targetUrl: null,
    pageUrl: null,
    sessionId: null,
    cdpAttached: false,
    lastError: null,
  },
  setTargetUrl: (targetUrl) => set({ targetUrl }),
  setBrowserRuntime: (browserRuntime) => set({ browserRuntime }),
}));
