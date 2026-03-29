import { create } from "zustand";
import type { LivePatch } from "../types";

interface Top10LiveState {
  patches: Record<string, LivePatch>;
  setPatch: (symbol: string, patch: LivePatch) => void;
  setPatches: (patches: Record<string, LivePatch>) => void;
  clearPatches: () => void;
}

export const useTop10LiveStore = create<Top10LiveState>((set) => ({
  patches: {},
  setPatch: (symbol, patch) =>
    set((state) => ({
      patches: {
        ...state.patches,
        [symbol]: { ...state.patches[symbol], ...patch },
      },
    })),
  setPatches: (patches) =>
    set((state) => ({
      patches: { ...state.patches, ...patches },
    })),
  clearPatches: () => set({ patches: {} }),
}));
