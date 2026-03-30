import { useEffect, useRef, useState } from "react";
import type { PersistentExecutionState } from "../../executionStateMachine";
import type {
  AggressionBubble,
  ExecutionContext,
  Kline,
  VacuumZone,
} from "../../types";

interface CandlestickChartProps {
  candles: Kline[];
  currentPrice: number;
  paddingMode?: "compact" | "standard" | "wide";
  height?: number;
  aggressionBubbles?: AggressionBubble[];
  vacuumZone?: VacuumZone;
  timeframe?: "1m" | "5m" | "15m";
  executionContext?: ExecutionContext;
  machineState?: PersistentExecutionState;
}

const PADDING_RATIOS = { compact: 0.05, standard: 0.08, wide: 0.13 };
const COLOR_UP = "oklch(0.68 0.15 145)";
const COLOR_DOWN = "oklch(0.63 0.21 25)";
const COLOR_WICK_UP = "oklch(0.6 0.12 145)";
const COLOR_WICK_DOWN = "oklch(0.55 0.18 25)";
const COLOR_GRID = "rgba(50,120,130,0.12)";
const COLOR_AXIS = "rgba(100,160,170,0.45)";
const COLOR_PRICE_LINE = "rgba(39,211,223,0.45)";
const COLOR_PRICE_LABEL_BG = "rgba(20,55,65,0.92)";
const COLOR_PRICE_LABEL_TEXT = "rgba(39,211,223,1)";
const FONT_MONO = "10px GeistMono, monospace";

// Focus window per timeframe: default live framing
const FOCUS_WINDOWS: Record<string, number> = {
  "1m": 36,
  "5m": 24,
  "15m": 18,
};

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function CandlestickChart({
  candles,
  currentPrice,
  paddingMode = "standard",
  height = 288,
  aggressionBubbles,
  vacuumZone,
  timeframe = "1m",
  executionContext,
  machineState,
}: CandlestickChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLivePaused, setIsLivePaused] = useState(false);

  const stateRef = useRef({
    candles: [] as Kline[],
    currentPrice: 0,
    paddingMode: "standard" as "compact" | "standard" | "wide",
    aggressionBubbles: [] as AggressionBubble[],
    vacuumZone: undefined as VacuumZone | undefined,
    timeframe: "1m" as "1m" | "5m" | "15m",
    executionContext: undefined as ExecutionContext | undefined,
    machineState: undefined as PersistentExecutionState | undefined,
    zoom: 1,
    panOffset: 0,
    liveModePaused: false,
    isDragging: false,
    dragStartX: 0,
    dragStartPan: 0,
    lastPinchDist: 0,
    rafId: 0,
    dirty: false,
    // Soft live-follow Y scale (persisted between frames)
    scalePMin: 0,
    scalePMax: 0,
  });

  // Expose setIsLivePaused for use in event handlers
  const setIsLivePausedRef = useRef(setIsLivePaused);
  setIsLivePausedRef.current = setIsLivePaused;

  function getFocusWindow(): number {
    return FOCUS_WINDOWS[stateRef.current.timeframe] ?? 36;
  }

  function getVisibleCount() {
    const focusWindow = getFocusWindow();
    // zoom=1 -> show focusWindow candles; zoom in = fewer; zoom out = more
    const count = Math.round(focusWindow / stateRef.current.zoom);
    return Math.max(5, Math.min(stateRef.current.candles.length, count));
  }

  function recenterLive() {
    stateRef.current.liveModePaused = false;
    stateRef.current.panOffset = 0;
    stateRef.current.zoom = 1;
    stateRef.current.scalePMin = 0;
    stateRef.current.scalePMax = 0;
    setIsLivePausedRef.current(false);
    scheduleRedraw();
  }

  function drawChart() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;

    if (
      canvas.width !== Math.round(W * dpr) ||
      canvas.height !== Math.round(H * dpr)
    ) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const {
      candles: data,
      currentPrice: livePrice,
      paddingMode: pm,
      vacuumZone: vz,
      liveModePaused,
    } = stateRef.current;
    if (data.length === 0) {
      ctx.restore();
      return;
    }

    const rightPad = PADDING_RATIOS[pm];
    const leftMargin = 8;
    const rightMargin = Math.round(W * rightPad) + 52;
    const topMargin = 12;
    const bottomMargin = 24;
    const chartW = W - leftMargin - rightMargin;
    const chartH = H - topMargin - bottomMargin;

    const visibleCount = getVisibleCount();

    // In live mode, clamp pan to 0 (always show latest candles)
    if (!liveModePaused) {
      stateRef.current.panOffset = 0;
    }

    const panOffset = Math.max(
      0,
      Math.min(stateRef.current.panOffset, data.length - visibleCount),
    );
    stateRef.current.panOffset = panOffset;

    const startIdx = Math.max(
      0,
      data.length - visibleCount - Math.round(panOffset),
    );
    const endIdx = Math.max(
      startIdx + 1,
      Math.min(data.length, startIdx + visibleCount),
    );
    const visible = data.slice(startIdx, endIdx);

    if (visible.length === 0) {
      ctx.restore();
      return;
    }

    // === SOFT LIVE-FOLLOW Y SCALE ===
    const focusCandles = visible;
    const fMin = Math.min(...focusCandles.map((k) => k.low));
    const fMax = Math.max(...focusCandles.map((k) => k.high));
    const fRange = Math.max(fMax - fMin, fMax * 0.0002);
    const padding = fRange * 0.18;
    const idealPMin = fMin - padding;
    const idealPMax = fMax + padding;

    const anchorPrice =
      livePrice > 0 ? livePrice : visible[visible.length - 1].close;

    let pMin: number;
    let pMax: number;

    if (!liveModePaused) {
      const cPMin = stateRef.current.scalePMin;
      const cPMax = stateRef.current.scalePMax;
      if (cPMin !== 0 && cPMax !== 0) {
        const cRange = cPMax - cPMin;
        const pricePos = (anchorPrice - cPMin) / cRange;
        if (pricePos >= 0.38 && pricePos <= 0.65) {
          pMin = cPMin;
          pMax = cPMax;
        } else {
          pMin = idealPMin;
          pMax = idealPMax;
          stateRef.current.scalePMin = pMin;
          stateRef.current.scalePMax = pMax;
        }
      } else {
        pMin = idealPMin;
        pMax = idealPMax;
        stateRef.current.scalePMin = pMin;
        stateRef.current.scalePMax = pMax;
      }
    } else {
      const allMin = Math.min(...visible.map((k) => k.low));
      const allMax = Math.max(...visible.map((k) => k.high));
      const allRange = Math.max(allMax - allMin, allMax * 0.0002);
      pMin = allMin - allRange * 0.12;
      pMax = allMax + allRange * 0.12;
      stateRef.current.scalePMin = 0;
      stateRef.current.scalePMax = 0;
    }

    const pRange = pMax - pMin;

    function toY(price: number) {
      return topMargin + chartH - ((price - pMin) / pRange) * chartH;
    }
    function toX(i: number) {
      return leftMargin + (i / (visibleCount - 1 || 1)) * chartW;
    }

    // === VACUUM BANDS (drawn first, behind everything) ===
    if (vz && vz.side !== "NONE" && vz.startPrice > 0 && vz.endPrice > 0) {
      const bandTop = Math.min(toY(vz.startPrice), toY(vz.endPrice));
      const bandBottom = Math.max(toY(vz.startPrice), toY(vz.endPrice));

      const clipTop = topMargin;
      const clipBottom = topMargin + chartH;
      const visTop = Math.max(bandTop, clipTop);
      const visBottom = Math.min(bandBottom, clipBottom);

      if (visBottom > visTop) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(leftMargin, clipTop, chartW + 4, chartH);
        ctx.clip();

        if (vz.side === "ABOVE") {
          ctx.fillStyle = "rgba(0,180,220,0.10)";
          ctx.fillRect(leftMargin, visTop, chartW + 4, visBottom - visTop);
          if (bandTop >= clipTop && bandTop <= clipBottom) {
            ctx.strokeStyle = "rgba(0,200,240,0.38)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(leftMargin, bandTop);
            ctx.lineTo(leftMargin + chartW + 4, bandTop);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (bandBottom >= clipTop && bandBottom <= clipBottom) {
            ctx.strokeStyle = "rgba(0,200,240,0.22)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(leftMargin, bandBottom);
            ctx.lineTo(leftMargin + chartW + 4, bandBottom);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          const labelY = Math.max(visTop + 12, clipTop + 12);
          ctx.fillStyle = "rgba(0,200,240,0.55)";
          ctx.font = "8px GeistMono, monospace";
          ctx.textAlign = "left";
          ctx.fillText("VACUUM ABOVE", leftMargin + 4, labelY);
        } else {
          ctx.fillStyle = "rgba(180,40,120,0.10)";
          ctx.fillRect(leftMargin, visTop, chartW + 4, visBottom - visTop);
          if (bandTop >= clipTop && bandTop <= clipBottom) {
            ctx.strokeStyle = "rgba(220,60,140,0.38)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(leftMargin, bandTop);
            ctx.lineTo(leftMargin + chartW + 4, bandTop);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (bandBottom >= clipTop && bandBottom <= clipBottom) {
            ctx.strokeStyle = "rgba(220,60,140,0.22)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(leftMargin, bandBottom);
            ctx.lineTo(leftMargin + chartW + 4, bandBottom);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          const labelY = Math.min(visBottom - 4, clipBottom - 4);
          ctx.fillStyle = "rgba(220,60,140,0.55)";
          ctx.font = "8px GeistMono, monospace";
          ctx.textAlign = "left";
          ctx.fillText("VACUUM BELOW", leftMargin + 4, labelY);
        }
        ctx.restore();
      }
    }

    // === EXECUTION ZONES (after vacuum, before grid) ===
    // labelsOnly=false: draw fill + border lines, skip label chips
    // labelsOnly=true:  draw only the label chip (for second-pass z-order)
    function drawZoneBand(
      ectx: CanvasRenderingContext2D,
      priceStart: number,
      priceEnd: number,
      fillColor: string,
      borderColor: string,
      label: string,
      labelColor: string,
      side: "top" | "bottom",
      labelsOnly = false,
    ) {
      const y1 = toY(Math.max(priceStart, priceEnd));
      const y2 = toY(Math.min(priceStart, priceEnd));
      const clipTop = topMargin;
      const clipBottom = topMargin + chartH;
      const visTop = Math.max(y1, clipTop);
      const visBottom = Math.min(y2, clipBottom);
      if (visBottom <= visTop) return;

      if (!labelsOnly) {
        ectx.save();
        ectx.beginPath();
        ectx.rect(leftMargin, clipTop, chartW + 4, chartH);
        ectx.clip();

        ectx.fillStyle = fillColor;
        ectx.fillRect(leftMargin, visTop, chartW + 4, visBottom - visTop);

        ectx.strokeStyle = borderColor;
        ectx.lineWidth = 1;
        ectx.setLineDash([]);
        if (y1 >= clipTop && y1 <= clipBottom) {
          ectx.beginPath();
          ectx.moveTo(leftMargin, y1);
          ectx.lineTo(leftMargin + chartW + 4, y1);
          ectx.stroke();
        }
        if (y2 >= clipTop && y2 <= clipBottom) {
          ectx.globalAlpha = 0.4;
          ectx.beginPath();
          ectx.moveTo(leftMargin, y2);
          ectx.lineTo(leftMargin + chartW + 4, y2);
          ectx.stroke();
          ectx.globalAlpha = 1;
        }
        ectx.restore();
      } else {
        // Labels-only pass: draw chip badge on top of candles + bubbles
        ectx.save();
        ectx.beginPath();
        ectx.rect(leftMargin, clipTop, chartW + 4, chartH);
        ectx.clip();

        // Compute label Y with clamping to avoid grid bleed
        const rawLabelY =
          side === "top"
            ? Math.max(visTop + 11, clipTop + 11)
            : Math.min(visBottom - 4, clipBottom - 11);
        const labelY = Math.max(
          clipTop + 11,
          Math.min(clipBottom - 4, rawLabelY),
        );

        // Measure text for chip
        ectx.font = "bold 9px GeistMono, monospace";
        const textW = ectx.measureText(label).width;
        const chipW = textW + 10;
        const chipH = 14;
        const chipX = leftMargin + chartW - chipW - 2;
        const chipY = labelY - chipH / 2;

        // Dark backing chip
        ectx.globalAlpha = 0.88;
        ectx.fillStyle = "rgba(8,16,24,0.82)";
        ectx.beginPath();
        ectx.roundRect(chipX, chipY, chipW, chipH, 3);
        ectx.fill();

        // Chip border (same color as zone border line)
        ectx.strokeStyle = borderColor;
        ectx.lineWidth = 0.8;
        ectx.globalAlpha = 0.7;
        ectx.stroke();

        // Label text — near-full opacity
        ectx.fillStyle = labelColor.replace(/[\d.]+\)$/, "0.97)");
        ectx.font = "bold 9px GeistMono, monospace";
        ectx.textAlign = "center";
        ectx.globalAlpha = 1.0;
        ectx.fillText(label, chipX + chipW / 2, labelY + 3.5);

        ectx.restore();
      }
    }

    // === MACHINE-STATE-AWARE EXECUTION ZONE RESOLUTION ===
    const ec = stateRef.current.executionContext;
    const ms = stateRef.current.machineState;

    // Resolve which zones to draw and at what alpha
    let drawZones = false;
    let zoneAlpha = 1.0;
    let isFadingOut = false;
    let tp1Hit = false;
    let tp2Hit = false;
    let isLongDir = false;
    let zoneEntry: { start: number; end: number } | null = null;
    let zoneSl: { start: number; end: number } | null = null;
    let zoneTp1: { start: number; end: number } | null = null;
    let zoneTp2: { start: number; end: number } | null = null;

    if (ms && ms.state !== "NO_SETUP") {
      const msState = ms.state;
      isLongDir = ms.direction === "LONG";
      zoneEntry = ms.entryZone;
      zoneSl = ms.slZone;
      zoneTp1 = ms.tp1Zone;
      zoneTp2 = ms.tp2Zone;

      if (msState === "BUILDING") {
        drawZones = !!(zoneEntry && zoneSl);
        zoneAlpha = 0.32; // faint projected zones
      } else if (msState === "READY") {
        drawZones = !!(zoneEntry && zoneSl && zoneTp1);
        zoneAlpha = 1.0;
      } else if (msState === "ACTIVE") {
        drawZones = !!(zoneEntry && zoneSl && zoneTp1);
        zoneAlpha = 1.0;
      } else if (msState === "TP1_HIT") {
        drawZones = !!(zoneEntry && zoneSl && zoneTp1);
        zoneAlpha = 1.0;
        tp1Hit = true;
      } else if (msState === "TP2_HIT") {
        drawZones = !!(zoneEntry && zoneSl && zoneTp1);
        zoneAlpha = 0.75;
        tp1Hit = true;
        tp2Hit = true;
      } else if (msState === "INVALIDATED") {
        const fadeProgress = Math.min(1, (ms.invalidatedFadeMs ?? 0) / 3500);
        zoneAlpha = Math.max(0, 1 - fadeProgress) * 0.55;
        drawZones = zoneAlpha > 0.04;
        isFadingOut = true;
      }
    } else if (!ms) {
      // Fallback: no machine state — use legacy ec validity
      const hasValidExecFallback =
        ec?.entryBias &&
        ec.entryBias !== "NEUTRAL" &&
        (ec.executionValidityState === "VALID_LONG" ||
          ec.executionValidityState === "VALID_SHORT" ||
          ec.executionValidityState === "RECLAIM_LONG" ||
          ec.executionValidityState === "RECLAIM_SHORT");
      if (hasValidExecFallback && ec) {
        drawZones = true;
        isLongDir = ec.entryBias === "LONG";
        zoneEntry = ec.entryZone;
        zoneSl = ec.slZone;
        zoneTp1 = ec.tp1Zone;
        zoneTp2 = ec.tp2Zone ?? null;
      }
    }

    // Helper to scale alpha for a given base value
    function scaleAlpha(base: number): number {
      return base * zoneAlpha;
    }

    const hasValidExec = drawZones;
    if (hasValidExec) {
      const isLong = isLongDir;

      // --- FIRST PASS: fills + border lines only (no label chips) ---
      if (zoneSl) {
        drawZoneBand(
          ctx,
          zoneSl.start,
          zoneSl.end,
          isLong
            ? `rgba(220,60,60,${scaleAlpha(0.1)})`
            : `rgba(220,120,40,${scaleAlpha(0.1)})`,
          isLong
            ? `rgba(220,60,60,${scaleAlpha(0.42)})`
            : `rgba(220,120,40,${scaleAlpha(0.42)})`,
          "SL",
          isLong
            ? `rgba(220,60,60,${scaleAlpha(0.55)})`
            : `rgba(220,120,40,${scaleAlpha(0.55)})`,
          isLong ? "bottom" : "top",
          false,
        );
      }

      if (zoneTp2) {
        const tp2Label = tp2Hit ? "TP2 ✓" : "TP2";
        drawZoneBand(
          ctx,
          zoneTp2.start,
          zoneTp2.end,
          isLong
            ? `rgba(0,160,200,${scaleAlpha(0.07)})`
            : `rgba(100,80,200,${scaleAlpha(0.07)})`,
          isLong
            ? `rgba(0,160,200,${scaleAlpha(0.28)})`
            : `rgba(100,80,200,${scaleAlpha(0.28)})`,
          tp2Label,
          isLong
            ? `rgba(0,180,220,${scaleAlpha(0.5)})`
            : `rgba(120,100,220,${scaleAlpha(0.5)})`,
          isLong ? "top" : "bottom",
          false,
        );
      }

      if (zoneTp1) {
        const tp1Label = tp1Hit ? "TP1 ✓" : "TP1";
        drawZoneBand(
          ctx,
          zoneTp1.start,
          zoneTp1.end,
          isLong
            ? `rgba(0,180,220,${scaleAlpha(0.13)})`
            : `rgba(120,80,220,${scaleAlpha(0.13)})`,
          isLong
            ? `rgba(0,180,220,${tp1Hit ? scaleAlpha(0.7) : scaleAlpha(0.55)})`
            : `rgba(120,80,220,${tp1Hit ? scaleAlpha(0.7) : scaleAlpha(0.55)})`,
          tp1Label,
          isLong
            ? `rgba(0,200,240,${scaleAlpha(0.6)})`
            : `rgba(140,100,240,${scaleAlpha(0.6)})`,
          isLong ? "top" : "bottom",
          false,
        );
      }

      if (zoneEntry) {
        const entryLabel =
          ms?.state === "ACTIVE"
            ? "ACTIVE"
            : ms?.state === "TP1_HIT"
              ? "ENTRY ✓"
              : "ENTRY";
        drawZoneBand(
          ctx,
          zoneEntry.start,
          zoneEntry.end,
          isLong
            ? `rgba(0,200,100,${scaleAlpha(0.16)})`
            : `rgba(200,60,120,${scaleAlpha(0.16)})`,
          isLong
            ? `rgba(0,200,100,${scaleAlpha(0.65)})`
            : `rgba(200,60,120,${scaleAlpha(0.65)})`,
          entryLabel,
          isLong
            ? `rgba(0,220,110,${scaleAlpha(0.7)})`
            : `rgba(220,80,140,${scaleAlpha(0.7)})`,
          "top",
          false,
        );
      }

      // Trigger line (dashed) — only for READY or fallback
      const showTriggerLine =
        !ms || ms.state === "READY" || ms.state === "BUILDING";
      const triggerPrice = showTriggerLine
        ? isLong
          ? (zoneEntry?.start ?? 0)
          : (zoneEntry?.end ?? 0)
        : 0;
      if (triggerPrice > 0) {
        const trigY = toY(triggerPrice);
        if (trigY >= topMargin && trigY <= topMargin + chartH) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = isLong
            ? `rgba(0,200,100,${scaleAlpha(0.35)})`
            : `rgba(200,60,120,${scaleAlpha(0.35)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(leftMargin, trigY);
          ctx.lineTo(leftMargin + chartW + 4, trigY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }

    // Grid
    const gridLines = 5;
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = topMargin + (i / gridLines) * chartH;
      ctx.beginPath();
      ctx.moveTo(leftMargin, y);
      ctx.lineTo(W - rightMargin + 4, y);
      ctx.stroke();
      const price = pMax - (i / gridLines) * pRange;
      ctx.fillStyle = COLOR_AXIS;
      ctx.font = FONT_MONO;
      ctx.textAlign = "left";
      ctx.fillText(formatPrice(price), W - rightMargin + 8, y + 3.5);
    }

    // Time axis
    const timeLabelStep = Math.max(1, Math.floor(visible.length / 4));
    ctx.fillStyle = COLOR_AXIS;
    ctx.font = "9px GeistMono, monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < visible.length; i += timeLabelStep) {
      const x = toX(i);
      ctx.fillText(formatTime(visible[i].openTime), x, H - 4);
    }

    // Candles
    const candleW = Math.max(1, (chartW / visibleCount) * 0.7);
    for (let i = 0; i < visible.length; i++) {
      const k = visible[i];
      const x = toX(i);
      const isUp = k.close >= k.open;
      const bodyTop = toY(Math.max(k.open, k.close));
      const bodyBottom = toY(Math.min(k.open, k.close));
      const bodyH = Math.max(1, bodyBottom - bodyTop);

      ctx.strokeStyle = isUp ? COLOR_WICK_UP : COLOR_WICK_DOWN;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, toY(k.high));
      ctx.lineTo(x, toY(k.low));
      ctx.stroke();

      ctx.fillStyle = isUp ? COLOR_UP : COLOR_DOWN;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }

    // Live price line
    const lp = livePrice > 0 ? livePrice : visible[visible.length - 1].close;
    const lpY = toY(lp);
    if (lpY >= topMargin && lpY <= topMargin + chartH) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = COLOR_PRICE_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftMargin, lpY);
      ctx.lineTo(W - rightMargin + 4, lpY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // === AGGRESSION BUBBLES (above candles, below price label) ===
    const bubbles = stateRef.current.aggressionBubbles;

    function drawBubble(
      bctx: CanvasRenderingContext2D,
      bx: number,
      by: number,
      r: number,
      side: "BUY" | "SELL",
      alpha: number,
    ) {
      bctx.save();
      bctx.globalAlpha = alpha;
      // Softer glow — suggest aggression without covering the chart
      bctx.shadowBlur = r * 0.7;
      bctx.shadowColor =
        side === "BUY" ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
      const gradient = bctx.createRadialGradient(bx, by, 0, bx, by, r);
      if (side === "BUY") {
        gradient.addColorStop(0, "rgba(34,197,94,0.48)");
        gradient.addColorStop(0.55, "rgba(34,197,94,0.18)");
        gradient.addColorStop(1, "rgba(34,197,94,0.02)");
      } else {
        gradient.addColorStop(0, "rgba(239,68,68,0.48)");
        gradient.addColorStop(0.55, "rgba(239,68,68,0.18)");
        gradient.addColorStop(1, "rgba(239,68,68,0.02)");
      }
      bctx.beginPath();
      bctx.arc(bx, by, r, 0, Math.PI * 2);
      bctx.fillStyle = gradient;
      bctx.fill();
      bctx.shadowBlur = 0;
      bctx.strokeStyle =
        side === "BUY" ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)";
      bctx.lineWidth = 0.7;
      bctx.stroke();
      bctx.restore();
    }

    if (bubbles.length > 0) {
      const protectRight = W - rightMargin + 6;

      // Sort weakest first, strongest last (strongest renders on top)
      const sortedBubbles = [...bubbles].sort((a, b) => a.radius - b.radius);

      // Track placed bubble positions for clustering
      const placedPositions: {
        x: number;
        y: number;
        r: number;
        side: string;
      }[] = [];

      for (const bubble of sortedBubbles) {
        const ci = visible.findIndex(
          (c) => c.openTime === bubble.candleOpenTime,
        );
        if (ci < 0) continue;
        let bx = toX(ci);
        const r = bubble.radius;

        // Clamp bx to canvas bounds
        bx = Math.max(leftMargin + r + 2, Math.min(bx, protectRight - r - 2));

        // Anchor BUY to candle body lower zone, SELL to candle body upper zone
        const candle = visible[ci];
        let rawBy: number;
        if (bubble.side === "BUY") {
          // Anchor near lower body / wick midpoint (bullish defense zone)
          const bodyLow = Math.min(candle.open, candle.close);
          const wickLow = candle.low;
          const anchorPrice = bodyLow * 0.65 + wickLow * 0.35;
          rawBy = toY(anchorPrice);
        } else {
          // Anchor near upper body / wick midpoint (bearish hit zone)
          const bodyHigh = Math.max(candle.open, candle.close);
          const wickHigh = candle.high;
          const anchorPrice = bodyHigh * 0.65 + wickHigh * 0.35;
          rawBy = toY(anchorPrice);
        }

        // Clamp by to chart canvas bounds
        let finalBy = Math.max(
          topMargin + r + 2,
          Math.min(rawBy, topMargin + chartH - r - 2),
        );

        // Slight price-line avoidance (reduced drift)
        const nearPriceLine = Math.abs(finalBy - lpY) < r + 6;
        if (nearPriceLine) {
          const shift = r + 6;
          if (bubble.side === "BUY") {
            finalBy = Math.min(topMargin + chartH - r - 2, finalBy + shift);
          } else {
            finalBy = Math.max(topMargin + r + 2, finalBy - shift);
          }
        }

        // Determine if this bubble is a minor in a cluster (same side, close proximity)
        let isMinor = false;
        for (const placed of placedPositions) {
          if (placed.side !== bubble.side) continue;
          const dist = Math.sqrt(
            (bx - placed.x) ** 2 + (finalBy - placed.y) ** 2,
          );
          if (dist < r + placed.r + 10) {
            isMinor = true;
            break;
          }
        }

        // Minor bubbles in a cluster get reduced alpha; dominant stays full
        const bubbleAlpha = isMinor ? 0.8 * 0.65 : 0.8;
        drawBubble(ctx, bx, finalBy, r, bubble.side, bubbleAlpha);

        placedPositions.push({ x: bx, y: finalBy, r, side: bubble.side });
      }
    }

    // === SECOND PASS: Execution zone label chips (on top of bubbles) ===
    if (hasValidExec) {
      const isLong = isLongDir;

      if (zoneSl) {
        drawZoneBand(
          ctx,
          zoneSl.start,
          zoneSl.end,
          "",
          isLong
            ? `rgba(220,60,60,${scaleAlpha(0.42)})`
            : `rgba(220,120,40,${scaleAlpha(0.42)})`,
          "SL",
          isLong
            ? `rgba(220,60,60,${scaleAlpha(0.55)})`
            : `rgba(220,120,40,${scaleAlpha(0.55)})`,
          isLong ? "bottom" : "top",
          true,
        );
      }

      if (zoneTp2) {
        const tp2Label = tp2Hit ? "TP2 ✓" : "TP2";
        drawZoneBand(
          ctx,
          zoneTp2.start,
          zoneTp2.end,
          "",
          isLong
            ? `rgba(0,160,200,${scaleAlpha(0.28)})`
            : `rgba(100,80,200,${scaleAlpha(0.28)})`,
          tp2Label,
          isLong
            ? `rgba(0,180,220,${scaleAlpha(0.5)})`
            : `rgba(120,100,220,${scaleAlpha(0.5)})`,
          isLong ? "top" : "bottom",
          true,
        );
      }

      if (zoneTp1) {
        const tp1Label = tp1Hit ? "TP1 ✓" : "TP1";
        drawZoneBand(
          ctx,
          zoneTp1.start,
          zoneTp1.end,
          "",
          isLong
            ? `rgba(0,180,220,${tp1Hit ? scaleAlpha(0.7) : scaleAlpha(0.55)})`
            : `rgba(120,80,220,${tp1Hit ? scaleAlpha(0.7) : scaleAlpha(0.55)})`,
          tp1Label,
          isLong
            ? `rgba(0,200,240,${scaleAlpha(0.6)})`
            : `rgba(140,100,240,${scaleAlpha(0.6)})`,
          isLong ? "top" : "bottom",
          true,
        );
      }

      if (zoneEntry) {
        const entryLabel =
          ms?.state === "ACTIVE"
            ? "ACTIVE"
            : ms?.state === "TP1_HIT" || ms?.state === "TP2_HIT"
              ? "ENTRY ✓"
              : "ENTRY";
        drawZoneBand(
          ctx,
          zoneEntry.start,
          zoneEntry.end,
          "",
          isLong
            ? `rgba(0,200,100,${scaleAlpha(0.65)})`
            : `rgba(200,60,120,${scaleAlpha(0.65)})`,
          entryLabel,
          isLong
            ? `rgba(0,220,110,${scaleAlpha(0.7)})`
            : `rgba(220,80,140,${scaleAlpha(0.7)})`,
          "top",
          true,
        );
      }

      // INVALIDATED marker — brief flash before clearing
      if (isFadingOut && zoneAlpha > 0.1) {
        const invalidY = zoneEntry
          ? toY((zoneEntry.start + zoneEntry.end) / 2)
          : -1;
        if (invalidY >= topMargin && invalidY <= topMargin + chartH) {
          ctx.save();
          ctx.globalAlpha = zoneAlpha * 0.9;
          ctx.font = "bold 9px GeistMono, monospace";
          ctx.fillStyle = "rgba(220,60,60,0.9)";
          ctx.textAlign = "center";
          ctx.fillText("✕ INVALIDATED", leftMargin + chartW / 2, invalidY - 4);
          ctx.restore();
        }
      }
    }

    // === PRICE LABEL (topmost layer) ===
    if (lpY >= topMargin && lpY <= topMargin + chartH) {
      const labelX = W - rightMargin + 6;
      const labelText = formatPrice(lp);
      ctx.font = "bold 10px GeistMono, monospace";
      const measuredLabelW = ctx.measureText(labelText).width + 8;
      const labelH = 16;
      ctx.fillStyle = COLOR_PRICE_LABEL_BG;
      ctx.beginPath();
      ctx.roundRect(labelX, lpY - labelH / 2, measuredLabelW, labelH, 3);
      ctx.fill();
      ctx.fillStyle = COLOR_PRICE_LABEL_TEXT;
      ctx.textAlign = "left";
      ctx.fillText(labelText, labelX + 4, lpY + 4);
    }

    ctx.restore();
  }

  function scheduleRedraw() {
    if (stateRef.current.dirty) return;
    stateRef.current.dirty = true;
    stateRef.current.rafId = requestAnimationFrame(() => {
      stateRef.current.dirty = false;
      drawChart();
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.candles = candles;
    scheduleRedraw();
  }, [candles]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.currentPrice = currentPrice;
    scheduleRedraw();
  }, [currentPrice]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.paddingMode = paddingMode;
    scheduleRedraw();
  }, [paddingMode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.aggressionBubbles = aggressionBubbles ?? [];
    scheduleRedraw();
  }, [aggressionBubbles]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.vacuumZone = vacuumZone;
    scheduleRedraw();
  }, [vacuumZone]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.executionContext = executionContext;
    scheduleRedraw();
  }, [executionContext]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.machineState = machineState;
    scheduleRedraw();
  }, [machineState]);

  // When timeframe changes: reset live mode and scale
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional ref-based update pattern
  useEffect(() => {
    stateRef.current.timeframe = timeframe;
    stateRef.current.zoom = 1;
    stateRef.current.panOffset = 0;
    stateRef.current.liveModePaused = false;
    stateRef.current.scalePMin = 0;
    stateRef.current.scalePMax = 0;
    setIsLivePaused(false);
    scheduleRedraw();
  }, [timeframe]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable event setup, no deps needed
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      stateRef.current.zoom = Math.max(
        0.3,
        Math.min(8, stateRef.current.zoom + delta),
      );
      scheduleRedraw();
    }

    function onMouseDown(e: MouseEvent) {
      stateRef.current.isDragging = true;
      stateRef.current.dragStartX = e.clientX;
      stateRef.current.dragStartPan = stateRef.current.panOffset;
    }

    function onMouseMove(e: MouseEvent) {
      if (!stateRef.current.isDragging) return;
      const W = canvas!.offsetWidth;
      const visibleCount = getVisibleCount();
      const dx = e.clientX - stateRef.current.dragStartX;
      const candlesPerPx = visibleCount / (W * 0.85);
      const newPan = stateRef.current.dragStartPan - dx * candlesPerPx;
      stateRef.current.panOffset = newPan;
      if (newPan > 1 && !stateRef.current.liveModePaused) {
        stateRef.current.liveModePaused = true;
        setIsLivePausedRef.current(true);
      } else if (newPan <= 0.5 && stateRef.current.liveModePaused) {
        stateRef.current.liveModePaused = false;
        stateRef.current.panOffset = 0;
        setIsLivePausedRef.current(false);
      }
      scheduleRedraw();
    }

    function onMouseUp() {
      stateRef.current.isDragging = false;
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        stateRef.current.isDragging = true;
        stateRef.current.dragStartX = e.touches[0].clientX;
        stateRef.current.dragStartPan = stateRef.current.panOffset;
        stateRef.current.lastPinchDist = 0;
      } else if (e.touches.length === 2) {
        stateRef.current.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        stateRef.current.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (e.touches.length === 1 && stateRef.current.isDragging) {
        const W = canvas!.offsetWidth;
        const visibleCount = getVisibleCount();
        const dx = e.touches[0].clientX - stateRef.current.dragStartX;
        const candlesPerPx = visibleCount / (W * 0.85);
        const newPan = stateRef.current.dragStartPan - dx * candlesPerPx;
        stateRef.current.panOffset = newPan;
        if (newPan > 1 && !stateRef.current.liveModePaused) {
          stateRef.current.liveModePaused = true;
          setIsLivePausedRef.current(true);
        } else if (newPan <= 0.5 && stateRef.current.liveModePaused) {
          stateRef.current.liveModePaused = false;
          stateRef.current.panOffset = 0;
          setIsLivePausedRef.current(false);
        }
        scheduleRedraw();
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (stateRef.current.lastPinchDist > 0) {
          const scale = dist / stateRef.current.lastPinchDist;
          stateRef.current.zoom = Math.max(
            0.3,
            Math.min(8, stateRef.current.zoom * scale),
          );
          scheduleRedraw();
        }
        stateRef.current.lastPinchDist = dist;
      }
    }

    function onTouchEnd() {
      stateRef.current.isDragging = false;
      stateRef.current.lastPinchDist = 0;
    }

    const ro = new ResizeObserver(() => scheduleRedraw());
    ro.observe(canvas);

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(stateRef.current.rafId);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: `${height}px` }}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor: "crosshair",
        }}
      />
      {/* LIVE / RECENTER button */}
      {isLivePaused && (
        <button
          type="button"
          onClick={recenterLive}
          style={{
            position: "absolute",
            bottom: "28px",
            right: "8px",
            padding: "3px 8px",
            fontSize: "9px",
            fontFamily: "GeistMono, monospace",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "rgba(39,211,223,1)",
            background: "rgba(20,55,65,0.88)",
            border: "1px solid rgba(39,211,223,0.45)",
            borderRadius: "4px",
            cursor: "pointer",
            lineHeight: 1.4,
            backdropFilter: "blur(4px)",
            zIndex: 10,
            boxShadow: "0 0 8px rgba(39,211,223,0.18)",
          }}
        >
          ⟳ RECENTER
        </button>
      )}
      {/* LIVE indicator */}
      {!isLivePaused && (
        <div
          style={{
            position: "absolute",
            bottom: "28px",
            right: "8px",
            padding: "2px 7px",
            fontSize: "8px",
            fontFamily: "GeistMono, monospace",
            fontWeight: 700,
            letterSpacing: "0.1em",
            color: "rgba(39,211,223,0.65)",
            background: "rgba(39,211,223,0.06)",
            border: "1px solid rgba(39,211,223,0.18)",
            borderRadius: "4px",
            lineHeight: 1.4,
            pointerEvents: "none",
          }}
        >
          LIVE
        </div>
      )}
    </div>
  );
}
