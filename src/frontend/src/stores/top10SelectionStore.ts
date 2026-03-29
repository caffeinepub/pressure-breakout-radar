import { create } from "zustand";
import type { Candidate } from "../types";

interface Top10SelectionState {
  candidates: Candidate[];
  lastScanTime: number;
  isInitialized: boolean;
  setCandidates: (candidates: Candidate[]) => void;
}

export const useTop10SelectionStore = create<Top10SelectionState>((set) => ({
  candidates: [],
  lastScanTime: 0,
  isInitialized: false,
  setCandidates: (candidates) =>
    set({ candidates, lastScanTime: Date.now(), isInitialized: true }),
}));
