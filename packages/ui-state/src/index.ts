import { create } from 'zustand';

type WorkspaceState = {
  targetUrl: string;
  setTargetUrl: (targetUrl: string) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  targetUrl: 'https://example.com',
  setTargetUrl: (targetUrl) => set({ targetUrl }),
}));
