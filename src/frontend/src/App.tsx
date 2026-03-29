import { useEffect } from "react";
import { getCache } from "./cache";
import { AppHeader } from "./components/AppHeader";
import { Top10List } from "./components/Top10List";
import { SelectedMonitor } from "./components/monitor/SelectedMonitor";
import { useTop10LiveStore } from "./stores/top10LiveStore";
import { useTop10SelectionStore } from "./stores/top10SelectionStore";
import { useUIStore } from "./stores/uiStore";
import type { Candidate } from "./types";
import { startDiscoveryLoop, startTop10LiveLoop } from "./updateLoops";

export default function App() {
  const setCandidates = useTop10SelectionStore((s) => s.setCandidates);
  const setPatches = useTop10LiveStore((s) => s.setPatches);
  const clearPatches = useTop10LiveStore((s) => s.clearPatches);
  const setAppStatus = useUIStore((s) => s.setAppStatus);
  const setIsCachedData = useUIStore((s) => s.setIsCachedData);
  const hasData = useTop10SelectionStore((s) => s.isInitialized);
  const selectedSymbol = useUIStore((s) => s.selectedSymbol);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional one-shot setup
  useEffect(() => {
    const cached = getCache<Candidate[]>("top10Snapshot");
    if (cached && cached.length > 0) {
      setCandidates(cached);
      setIsCachedData(true);
      setAppStatus("USING_CACHE");
    }

    const stopDiscovery = startDiscoveryLoop(
      (top10) => {
        clearPatches();
        setCandidates(top10);
        setIsCachedData(false);
      },
      (status) => {
        setAppStatus(status);
        if (status === "LIVE") setIsCachedData(false);
      },
    );

    return stopDiscovery;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable zustand actions
  useEffect(() => {
    if (!hasData) return;

    const stopLive = startTop10LiveLoop(
      () => useTop10SelectionStore.getState().candidates.map((c) => c.symbol),
      (patches) => setPatches(patches),
    );

    return stopLive;
  }, [hasData]);

  return (
    <div className="radar-grid relative min-h-screen">
      <div className="relative z-10 flex flex-col min-h-screen">
        <AppHeader />

        <main className="flex-1 px-4 py-4 pb-8">
          <Top10List />
        </main>

        <footer className="px-4 py-4 border-t border-[oklch(0.78_0.13_195/8%)]">
          <p className="text-center text-[10px] text-radar-dim">
            © {new Date().getFullYear()} Built with love using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(typeof window !== "undefined" ? window.location.hostname : "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-radar-cyan hover:opacity-80 transition-opacity"
            >
              caffeine.ai
            </a>
          </p>
        </footer>
      </div>

      {selectedSymbol && <SelectedMonitor symbol={selectedSymbol} />}
    </div>
  );
}
