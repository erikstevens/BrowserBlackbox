import { create } from 'zustand';
import type {
  BrowserRuntimeDiagnostics,
  BrowserRuntimeEvent,
  BrowserRuntimeHealth,
  BrowserRuntimeState,
  BrowserRuntimeUpdate,
} from '@browser-blackbox/runtime-browser';

type WorkspaceState = {
  targetUrl: string;
  browserRuntime: BrowserRuntimeState;
  runtimeHealth: BrowserRuntimeHealth;
  runtimeEvents: BrowserRuntimeEvent[];
  setTargetUrl: (targetUrl: string) => void;
  setBrowserRuntime: (browserRuntime: BrowserRuntimeState) => void;
  setRuntimeDiagnostics: (diagnostics: BrowserRuntimeDiagnostics) => void;
  pushRuntimeUpdate: (update: BrowserRuntimeUpdate) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  targetUrl: 'https://example.com',
  browserRuntime: {
    phase: 'idle',
    targetUrl: null,
    pageUrl: null,
    sessionId: null,
    playwrightAttached: false,
    cdpAttached: false,
    lastError: null,
  },
  runtimeHealth: {
    status: 'idle',
    lastEventAt: null,
    lastError: null,
    recentEventCount: 0,
    subscriberCount: 0,
  },
  runtimeEvents: [],
  setTargetUrl: (targetUrl) => set({ targetUrl }),
  setBrowserRuntime: (browserRuntime) => set({ browserRuntime }),
  setRuntimeDiagnostics: (diagnostics) =>
    set({
      browserRuntime: diagnostics.state,
      runtimeHealth: diagnostics.health,
      runtimeEvents: diagnostics.recentEvents,
    }),
  pushRuntimeUpdate: (update) =>
    set((state) => ({
      browserRuntime: update.state,
      runtimeHealth: update.health,
      runtimeEvents: [update.event, ...state.runtimeEvents.filter((event) => event.id !== update.event.id)].slice(
        0,
        80,
      ),
    })),
}));
