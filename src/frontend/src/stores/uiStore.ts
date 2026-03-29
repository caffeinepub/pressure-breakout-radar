import { create } from "zustand";
import type { AppStatus } from "../types";

interface UIState {
  selectedSymbol: string | null;
  appStatus: AppStatus;
  isCachedData: boolean;
  setSelectedSymbol: (symbol: string | null) => void;
  setAppStatus: (status: AppStatus) => void;
  setIsCachedData: (val: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedSymbol: null,
  appStatus: "SCANNING",
  isCachedData: false,
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  setAppStatus: (appStatus) => set({ appStatus }),
  setIsCachedData: (isCachedData) => set({ isCachedData }),
}));
