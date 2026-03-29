import { useUIStore } from "../stores/uiStore";

export function AppHeader() {
  const appStatus = useUIStore((s) => s.appStatus);

  const statusConfig = (
    {
      LIVE: {
        label: "LIVE",
        dotClass: "live-dot",
        textClass: "text-radar-green",
      },
      SCANNING: {
        label: "SCANNING",
        dotClass: "live-dot-cyan",
        textClass: "text-radar-cyan",
      },
      ERROR: { label: "ERROR", dotClass: "", textClass: "text-red-400" },
      STALE: { label: "STALE", dotClass: "", textClass: "text-orange-400" },
      USING_CACHE: {
        label: "CACHED",
        dotClass: "",
        textClass: "text-yellow-400",
      },
    } as const
  )[appStatus] ?? {
    label: "LIVE",
    dotClass: "live-dot",
    textClass: "text-radar-green",
  };

  return (
    <header
      data-ocid="app.panel"
      className="sticky top-0 z-50 bg-[oklch(0.10_0.025_200/92%)] backdrop-blur-md border-b border-[oklch(0.78_0.13_195/12%)] px-4 py-3.5"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-radar-cyan opacity-80" />
          <div>
            <div className="text-[13px] font-bold text-foreground tracking-tight leading-none">
              Pressure Breakout
            </div>
            <div className="text-[10px] text-radar-cyan uppercase tracking-[0.2em] leading-none mt-0.5">
              Radar
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {statusConfig.dotClass ? (
            <span className={statusConfig.dotClass} />
          ) : (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                appStatus === "ERROR"
                  ? "bg-red-400"
                  : appStatus === "STALE"
                    ? "bg-orange-400"
                    : "bg-yellow-400"
              }`}
            />
          )}
          <span
            className={`text-[11px] font-mono font-bold tracking-widest ${statusConfig.textClass}`}
          >
            {statusConfig.label}
          </span>
        </div>
      </div>
    </header>
  );
}
