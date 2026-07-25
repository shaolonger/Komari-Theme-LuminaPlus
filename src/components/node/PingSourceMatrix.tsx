import { useMemo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";
import { formatLatencyValue, formatMetricNumber } from "@/utils/format";
import { latencyHeatColor } from "@/utils/metricTone";
import { isValidPingLatency } from "@/utils/pingSamples";
import { buildPingTaskVpsCompareUrl } from "@/utils/vpsCompare";

const REGULAR_SOURCE_LIMIT = 4;
const COMPACT_SOURCE_LIMIT = 4;
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 22;
const SPARKLINE_BASELINE_MAX = 300;

type SparkPoint = { x: number; y: number };

function sourceMeta(source: HomepagePingSourceRow) {
  return source.group || source.target || `ID ${source.taskId}`;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[center];
  return (sorted[center - 1] + sorted[center]) / 2;
}

function smoothPath(points: SparkPoint[]) {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const point = points[0];
    return `M ${Math.max(0, point.x - 1.4)} ${point.y} L ${Math.min(
      SPARKLINE_WIDTH,
      point.x + 1.4,
    )} ${point.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (after.x - current.x) / 6;
    const control2Y = next.y - (after.y - current.y) / 6;
    path += ` C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${next.x} ${next.y}`;
  }
  return path;
}

function buildSparklineGeometry(
  samples: Array<{ time: number; value: number }>,
  sampleLimit: number,
) {
  const selected = samples.slice(-sampleLimit);
  const validValues = selected
    .map((sample) => sample.value)
    .filter(isValidPingLatency);
  const scaleMax = Math.max(SPARKLINE_BASELINE_MAX, ...validValues, 1);
  const firstTime = selected[0]?.time ?? 0;
  const lastTime = selected[selected.length - 1]?.time ?? firstTime;
  const timeSpan = Math.max(0, lastTime - firstTime);
  const xForSample = (sample: { time: number }, index: number) => {
    if (selected.length <= 1) return SPARKLINE_WIDTH / 2;
    if (timeSpan <= 0) return (index / (selected.length - 1)) * SPARKLINE_WIDTH;
    return Math.max(
      0,
      Math.min(SPARKLINE_WIDTH, ((sample.time - firstTime) / timeSpan) * SPARKLINE_WIDTH),
    );
  };
  const yForValue = (value: number) => {
    const ratio = Math.min(1, value / scaleMax);
    return SPARKLINE_HEIGHT - 2.5 - ratio * (SPARKLINE_HEIGHT - 5);
  };

  const segments: SparkPoint[][] = [];
  const lossMarkers: number[] = [];
  let activeSegment: SparkPoint[] = [];

  selected.forEach((sample, index) => {
    const x = xForSample(sample, index);
    if (!isValidPingLatency(sample.value)) {
      if (activeSegment.length > 0) segments.push(activeSegment);
      activeSegment = [];
      lossMarkers.push(x);
      return;
    }
    activeSegment.push({ x, y: yForValue(sample.value) });
  });
  if (activeSegment.length > 0) segments.push(activeSegment);

  return {
    paths: segments.map(smoothPath).filter(Boolean),
    lossMarkers,
  };
}

function PingTaskSparkline({
  source,
  density,
}: {
  source: HomepagePingSourceRow;
  density: "regular" | "compact";
}) {
  const sampleLimit = density === "compact" ? 14 : 22;
  const geometry = useMemo(
    () => buildSparklineGeometry(source.samples, sampleLimit),
    [source.samples, sampleLimit],
  );
  const lineColor = latencyHeatColor(source.latencyMs);
  const style = { "--ping-task-line": lineColor } as CSSProperties;

  if (geometry.paths.length === 0 && geometry.lossMarkers.length === 0) {
    return <span className="ping-task-sparkline-empty">暂无趋势</span>;
  }

  return (
    <svg
      className="ping-task-sparkline"
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      style={style}
      aria-hidden
    >
      <path className="ping-task-sparkline-baseline" d={`M 0 20.5 L ${SPARKLINE_WIDTH} 20.5`} />
      {geometry.paths.map((path, index) => (
        <path key={`${source.taskId}-${index}`} className="ping-task-sparkline-line" d={path} />
      ))}
      {geometry.lossMarkers.map((x, index) => (
        <line
          key={`${source.taskId}-loss-${index}`}
          className="ping-task-sparkline-loss"
          x1={x}
          x2={x}
          y1="1"
          y2={SPARKLINE_HEIGHT - 1}
        />
      ))}
    </svg>
  );
}

function PingTaskTile({
  source,
  density,
}: {
  source: HomepagePingSourceRow;
  density: "regular" | "compact";
}) {
  const latencyColor = latencyHeatColor(source.latencyMs);
  const hasLoss = (source.lossPercent ?? 0) > 0;
  return (
    <article
      className="ping-task-tile"
      data-status={source.status}
      data-loss={hasLoss ? "true" : "false"}
      title={source.title}
    >
      <div className="ping-task-tile-head">
        <Link
          to={buildPingTaskVpsCompareUrl({ taskId: source.taskId })}
          className="ping-task-name"
          title="对比该任务下的 VPS"
        >
          {source.name}
        </Link>
        <span className="ping-task-readings tabular">
          <strong style={{ color: latencyColor }}>
            {source.latencyShortLabel}
            {source.latencyMs != null && <small>ms</small>}
          </strong>
          <i aria-hidden />
          <strong className="ping-task-loss-value">
            {source.lossShortLabel}
            {source.lossPercent != null && <small>%</small>}
          </strong>
        </span>
      </div>
      {density === "regular" && <small className="ping-task-meta">{sourceMeta(source)}</small>}
      <PingTaskSparkline source={source} density={density} />
    </article>
  );
}

export function PingSourceMatrix({
  rows,
  compareUrl,
  density = "regular",
}: {
  rows: HomepagePingSourceRow[];
  compareUrl: string;
  density?: "regular" | "compact";
}) {
  if (rows.length === 0) return null;

  const limit = density === "compact" ? COMPACT_SOURCE_LIMIT : REGULAR_SOURCE_LIMIT;
  const hasOverflow = rows.length > limit;
  const sourceLimit = hasOverflow ? limit - 1 : limit;
  const visibleRows = rows.slice(0, sourceLimit);
  const overflowCount = rows.length - visibleRows.length;
  const latencyValues = rows
    .map((row) => row.latencyMs)
    .filter((value): value is number => value != null);
  const lossValues = rows
    .map((row) => row.lossPercent)
    .filter((value): value is number => value != null);
  const medianLatency = median(latencyValues);
  const worstLatency = latencyValues.length > 0 ? Math.max(...latencyValues) : null;
  const maxLoss = lossValues.length > 0 ? Math.max(...lossValues) : null;

  return (
    <section className="ping-source-matrix" data-density={density}>
      {density === "regular" && (
        <header className="ping-source-matrix-head">
          <span className="ping-source-matrix-title">
            监测任务
            <b>{rows.length}</b>
          </span>
          <span className="ping-source-summary" aria-label="Ping 聚合摘要">
            <span>
              中位 <strong>{medianLatency == null ? "—" : `${formatLatencyValue(medianLatency)} ms`}</strong>
            </span>
            <span>
              最差 <strong>{worstLatency == null ? "—" : `${formatLatencyValue(worstLatency)} ms`}</strong>
            </span>
            <span>
              max 丢包 <strong>{maxLoss == null ? "—" : `${formatMetricNumber(maxLoss)}%`}</strong>
            </span>
          </span>
          <Link to={compareUrl} className="ping-source-matrix-link">
            <BarChart3 size={12} strokeWidth={2.1} />
            <span>对比</span>
          </Link>
        </header>
      )}
      <div className="ping-source-list">
        {visibleRows.map((source) => (
          <PingTaskTile key={source.taskId} source={source} density={density} />
        ))}
        {hasOverflow && (
          <Link
            to={compareUrl}
            className="ping-task-overflow"
            title={`查看其余 ${overflowCount} 个监测任务`}
          >
            <strong>+{overflowCount}</strong>
            <span>{density === "regular" ? "个任务" : "更多"}</span>
          </Link>
        )}
      </div>
    </section>
  );
}
