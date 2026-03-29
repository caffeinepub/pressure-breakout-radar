import { create } from "zustand";
import type { SelectedMonitorSnapshot } from "../types";

interface SelectedMonitorState {
  snapshot: SelectedMonitorSnapshot | null;
  setSnapshot: (s: SelectedMonitorSnapshot) => void;
  patchSnapshot: (p: Partial<SelectedMonitorSnapshot>) => void;
  clearSnapshot: () => void;
}

export const useSelectedMonitorStore = create<SelectedMonitorState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  patchSnapshot: (patch) =>
    set((state) =>
      state.snapshot ? { snapshot: { ...state.snapshot, ...patch } } : state,
    ),
  clearSnapshot: () => set({ snapshot: null }),
}));
