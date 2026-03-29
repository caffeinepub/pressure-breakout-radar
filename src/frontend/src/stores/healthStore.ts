import { create } from "zustand";

interface HealthState {
  lastFullScanTime: number;
  lastMonitorUpdateTime: number;
  inFlightScan: boolean;
  lastError: string | null;
  failedRequestCount: number;
  setLastFullScanTime: (t: number) => void;
  setLastMonitorUpdateTime: (t: number) => void;
  setInFlightScan: (v: boolean) => void;
  setLastError: (msg: string | null) => void;
  incrementFailedRequests: () => void;
}

export const useHealthStore = create<HealthState>((set) => ({
  lastFullScanTime: 0,
  lastMonitorUpdateTime: 0,
  inFlightScan: false,
  lastError: null,
  failedRequestCount: 0,
  setLastFullScanTime: (t) => set({ lastFullScanTime: t }),
  setLastMonitorUpdateTime: (t) => set({ lastMonitorUpdateTime: t }),
  setInFlightScan: (v) => set({ inFlightScan: v }),
  setLastError: (msg) => set({ lastError: msg }),
  incrementFailedRequests: () =>
    set((s) => ({ failedRequestCount: s.failedRequestCount + 1 })),
}));
