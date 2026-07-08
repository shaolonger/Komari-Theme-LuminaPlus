import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Check,
  ChevronLeft,
  Copy,
  Download,
  LineChart,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  getComparisonLoadRecords,
  getComparisonPingRecords,
  getPingOverview,
} from "@/services/api";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  getAxisColors,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "@/components/instance/chartShared";
import {
  buildLoadTimeRangeOptions,
  buildPingTimeRangeOptions,
} from "@/components/instance/chartShared";
import { Spinner } from "@/components/ui/Spinner";
import { useAllNodeMeta, useVisibleNodeUuids } from "@/hooks/useNode";
import { usePreferences } from "@/hooks/usePreferences";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  buildComparisonCsv,
  buildComparisonMarkdown,
  buildComparisonRanking,
  buildComparisonSeries,
  buildMultiMetricComparisonAnalysis,
  buildPingTaskComparisonSeries,
  buildPingTaskVpsComparisonSeries,
  COMPARISON_METRICS,
  formatComparisonValue,
  getComparisonRequestHours,
  getComparisonMetric,
  getPingTaskBoundNodeUuids,
  isValidComparisonCustomRange,
  mergePingTasksById,
  nodesToComparisonNodes,
  normalizeComparisonPingTaskId,
  prepareComparisonTrendData,
  sortComparisonRankingRows,
  trimComparisonSeriesToRange,
  type ComparisonMetricKey,
  type ComparisonRankingRow,
  type ComparisonRankingSortKey,
  type ComparisonSortDirection,
  type ComparisonSeries,
} from "@/utils/vpsCompare";
import {
  formatDateTimeLocalValue,
  formatExportRangeToken as formatDisplayExportRangeToken,
  parseDateTimeLocalInZone,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";
import type { NodeInfo, PingTask } from "@/types/komari";

const DEFAULT_METRIC: ComparisonMetricKey = "cpu";
const DEFAULT_HOURS = 4;
type CompareView = "trend" | "ranking" | "insights" | "matrix";
type CompareRangeMode = "preset" | "custom";

function isComparisonMetricKey(value: string | null): value is ComparisonMetricKey {
  return COMPARISON_METRICS.some((metric) => metric.key === value);
}

function isCompareView(value: string | null): value is CompareView {
  return value === "trend" || value === "ranking" || value === "insights" || value === "matrix";
}

function isCompareRangeMode(value: string | null): value is CompareRangeMode {
  return value === "preset" || value === "custom";
}

function parseUrlSeconds(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseSelectedNodes(value: string | null) {
  return value
    ? Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)))
    : [];
}

function parseSelectedTaskIds(value: string | null) {
  return value
    ? Array.from(
        new Set(
          value
            .split(",")
            .map((item) => Number.parseInt(item.trim(), 10))
            .filter((item) => Number.isInteger(item) && item > 0),
        ),
      ).sort((left, right) => left - right)
    : [];
}

function parseSelectedMetricKeys(value: string | null, fallback: ComparisonMetricKey) {
  const parsed = value
    ? Array.from(
        new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(isComparisonMetricKey),
        ),
      )
    : [];
  return parsed.length > 0 ? parsed : [fallback];
}

function normalizeViewForMetricMode(view: CompareView, multiMetricMode: boolean): CompareView {
  if (multiMetricMode) {
    return view === "insights" || view === "matrix" || view === "ranking" ? view : "matrix";
  }
  return view === "ranking" ? "ranking" : "trend";
}

function formatRangeDuration(hours: number) {
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24} 天`;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} 天`;
  return `${Math.max(1, Math.round(hours * 10) / 10)} 小时`;
}

function formatDurationSeconds(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "原始采样";
  if (seconds >= 86_400 && seconds % 86_400 === 0) return `${seconds / 86_400} 天`;
  if (seconds >= 3_600 && seconds % 3_600 === 0) return `${seconds / 3_600} 小时`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function formatExportRangeToken(
  mode: CompareRangeMode,
  hours: number,
  start: number | null,
  end: number | null,
  displayTimeZone: DisplayTimeZone,
) {
  if (mode !== "custom" || start == null || end == null) return `${hours}h`;
  return formatDisplayExportRangeToken(start, end, displayTimeZone);
}

function nodeLabel(node: NodeInfo) {
  return node.name.trim() || node.uuid;
}

function rowInstanceUuid(rowUuid: string) {
  return rowUuid.split(":ping:")[0] || rowUuid;
}

function formatNodeMeta(node: NodeInfo) {
  const parts = [node.group, node.region].map((value) => String(value || "").trim()).filter(Boolean);
  return parts.length ? parts.join(" / ") : "未分组";
}

function formatAxisValue(metricKey: ComparisonMetricKey, value: number) {
  if (value === 0) return "";
  return formatComparisonValue(metricKey, value);
}

function compareSearchText(node: NodeInfo) {
  return [
    node.uuid,
    node.name,
    node.group,
    node.region,
    node.public_remark,
    node.tags,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function updateParams(
  base: URLSearchParams,
  patch: {
    nodes?: string[];
    metric?: ComparisonMetricKey;
    metrics?: ComparisonMetricKey[] | null;
    hours?: number;
    view?: CompareView;
    rangeMode?: CompareRangeMode;
    from?: number | null;
    to?: number | null;
    pingTask?: number | null;
    pingTasks?: number[] | null;
  },
) {
  const next = new URLSearchParams(base);
  if (patch.nodes) {
    if (patch.nodes.length > 0) next.set("nodes", patch.nodes.join(","));
    else next.delete("nodes");
  }
  if (patch.metric) next.set("metric", patch.metric);
  if (patch.metrics !== undefined) {
    const metrics = patch.metrics ? Array.from(new Set(patch.metrics)) : [];
    if (metrics.length > 0) next.set("metric", metrics[0]);
    if (metrics.length > 1) next.set("metrics", metrics.join(","));
    else next.delete("metrics");
  }
  if (patch.hours != null) next.set("hours", String(patch.hours));
  if (patch.view) next.set("tab", patch.view);
  if (patch.rangeMode) {
    if (patch.rangeMode === "custom") next.set("range", "custom");
    else {
      next.delete("range");
      next.delete("from");
      next.delete("to");
    }
  }
  if (patch.from !== undefined) {
    if (patch.from != null) next.set("from", String(Math.floor(patch.from)));
    else next.delete("from");
  }
  if (patch.to !== undefined) {
    if (patch.to != null) next.set("to", String(Math.floor(patch.to)));
    else next.delete("to");
  }
  if (patch.pingTask !== undefined) {
    if (patch.pingTask != null) next.set("pingTask", String(patch.pingTask));
    else next.delete("pingTask");
  }
  if (patch.pingTasks !== undefined) {
    if (patch.pingTasks && patch.pingTasks.length > 0) {
      next.set("pingTasks", patch.pingTasks.join(","));
    } else {
      next.delete("pingTasks");
    }
  }
  return next;
}

function taskFallbackName(taskId: number) {
  return `任务 #${taskId}`;
}

function pingTaskDisplayName(
  taskId: number | null | undefined,
  taskName?: string,
  group?: string,
) {
  if (taskId == null) return "全部 Ping 任务";
  const name = taskName?.trim() || taskFallbackName(taskId);
  const groupLabel = group?.trim();
  return groupLabel ? `${groupLabel} / ${name}` : name;
}

const RANKING_SORT_COLUMNS: Array<{
  key: ComparisonRankingSortKey;
  label: string;
}> = [
  { key: "name", label: "VPS" },
  { key: "group", label: "分组" },
  { key: "region", label: "地区" },
  { key: "samples", label: "样本" },
  { key: "average", label: "平均" },
  { key: "p95", label: "P95" },
  { key: "max", label: "峰值" },
  { key: "latest", label: "最新" },
];

function defaultRankingSortDirection(key: ComparisonRankingSortKey): ComparisonSortDirection {
  return key === "name" || key === "group" || key === "region" ? "asc" : "desc";
}

function nextRankingSort(
  current: { key: ComparisonRankingSortKey; direction: ComparisonSortDirection },
  key: ComparisonRankingSortKey,
) {
  if (current.key !== key) {
    return { key, direction: defaultRankingSortDirection(key) };
  }
  return { key, direction: current.direction === "asc" ? "desc" : "asc" } as const;
}

function ariaSortValue(
  current: { key: ComparisonRankingSortKey; direction: ComparisonSortDirection },
  key: ComparisonRankingSortKey,
) {
  if (current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}

function ComparisonTrendChart({
  metricKey,
  hours,
  series,
  loading,
  selectedCount,
  rangeStart,
  rangeEnd,
  displayTimeZone,
}: {
  metricKey: ComparisonMetricKey;
  hours: number;
  series: ComparisonSeries[];
  loading: boolean;
  selectedCount: number;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  displayTimeZone: DisplayTimeZone;
}) {
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref } = useResponsiveChartSize("wide");
  const dataRef = useRef<uPlot.AlignedData>([[]]);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const metric = getComparisonMetric(metricKey);
  const trend = useMemo(
    () => prepareComparisonTrendData({ metricKey, series, hours, start: rangeStart, end: rangeEnd }),
    [hours, metricKey, rangeEnd, rangeStart, series],
  );
  const visualSeries = trend.series;
  const data = useMemo(
    () => [trend.times, ...trend.valuesBySeries] as uPlot.AlignedData,
    [trend],
  );
  dataRef.current = data;
  const hasRenderableData = trend.valuesBySeries.some((values) =>
    values.some((value) => typeof value === "number" && Number.isFinite(value)),
  );
  const colors = useMemo(
    () => visualSeries.map((_, index) => colorForSeries(index, visualSeries.length)),
    [visualSeries],
  );
  const options = useMemo<uPlot.Options>(() => {
    const isDark = resolvedAppearance === "dark";
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      dataRef,
      rangeHours: hours,
      displayTimeZone,
      estimatedWidth: 220,
      setTooltip,
      buildRows: (idx) =>
        visualSeries.map((item, index) => ({
          label: item.name,
          value: formatComparisonValue(
            metricKey,
            dataRef.current[index + 1]?.[idx] as number | null | undefined,
          ),
          color: colors[index],
        })),
    });

    return {
      width: w,
      height: h,
      padding: [8, 16, 10, 4],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: { x: { time: true }, y: { auto: true } },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: hours >= 72 ? 38 : 34,
          values: createTimeAxisFormatter(hours, displayTimeZone),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: metric.axisKind === "network" ? 82 : 56,
          values: (_self, splits) => splits.map((value) => formatAxisValue(metricKey, value)),
        },
      ],
      series: [
        { label: "time" },
        ...visualSeries.map((item, index) => ({
          label: item.name,
          stroke: colors[index],
          width: metric.source === "ping" ? 2 : 1.8,
          spanGaps: false,
          points: { show: false },
        })),
      ],
      hooks: {
        init: [
          (u) => {
            u.root.setAttribute("aria-label", `${metric.label} VPS 对比趋势`);
            tooltipHooks.onInit(u);
          },
        ],
        setCursor: [tooltipHooks.onSetCursor],
      },
    } as uPlot.Options;
  }, [
    colors,
    displayTimeZone,
    h,
    hours,
    metric.axisKind,
    metric.label,
    metric.source,
    metricKey,
    resolvedAppearance,
    visualSeries,
    w,
  ]);

  if (loading) {
    return (
      <div className="compare-chart-empty">
        <Spinner size={22} />
        <span>正在加载历史数据</span>
      </div>
    );
  }

  if (selectedCount === 0) {
    return <div className="compare-chart-empty">请选择 VPS 查看历史数据</div>;
  }

  if (!hasRenderableData) {
    return <div className="compare-chart-empty">当前选择下暂无历史数据</div>;
  }

  const trendMeta =
    metric.source === "ping"
      ? [
          `按 ${formatDurationSeconds(trend.bucketSeconds)} 对齐`,
          trend.smoothWindow > 1 ? "轻度平滑" : "原始走势",
          `${trend.rawSamples} 原始样本`,
        ]
      : [`${trend.rawSamples} 原始样本`];

  return (
    <div ref={ref} className="compare-chart-wrap">
      <div className="compare-chart-meta" aria-label="图表数据处理摘要">
        {trendMeta.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <UplotReact
        key={`${metricKey}-${hours}-${trend.bucketSeconds ?? "raw"}-${visualSeries.map((item) => item.uuid).join("-")}`}
        options={options}
        data={data}
        resetScales={false}
      />
      {tooltip.show && (
        <div className="instance-chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          <div className="instance-chart-tooltip-time">{tooltip.time}</div>
          {tooltip.rows.map((row) => (
            <div key={row.label} className="instance-chart-tooltip-row">
              <span className="instance-chart-tooltip-dot" style={{ background: row.color }} />
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RankingTable({
  metricKey,
  rows,
  selectedCount,
}: {
  metricKey: ComparisonMetricKey;
  rows: ComparisonRankingRow[];
  selectedCount: number;
}) {
  const [sort, setSort] = useState<{
    key: ComparisonRankingSortKey;
    direction: ComparisonSortDirection;
  }>({ key: "p95", direction: "desc" });
  const sortedRows = useMemo(
    () => sortComparisonRankingRows(rows, sort.key, sort.direction),
    [rows, sort.direction, sort.key],
  );

  return (
    <div className="compare-ranking-table-wrap">
      <table className="compare-ranking-table">
        <thead>
          <tr>
            {RANKING_SORT_COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th key={column.key} aria-sort={ariaSortValue(sort, column.key)}>
                  <button
                    type="button"
                    className="compare-ranking-sort-button"
                    data-active={active ? "true" : "false"}
                    onClick={() => setSort((current) => nextRankingSort(current, column.key))}
                    title={`按${column.label}${active && sort.direction === "asc" ? "降序" : "排序"}`}
                  >
                    <span>{column.label}</span>
                    {active ? (
                      sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                    ) : (
                      <ArrowUpDown size={12} />
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.uuid}>
              <td>
                <Link to={`/instance/${rowInstanceUuid(row.uuid)}`} className="compare-ranking-name">
                  {row.name}
                </Link>
              </td>
              <td>{row.group || "-"}</td>
              <td>{row.region || "-"}</td>
              <td>{row.samples}</td>
              <td>{formatComparisonValue(metricKey, row.average)}</td>
              <td>{formatComparisonValue(metricKey, row.p95)}</td>
              <td>{formatComparisonValue(metricKey, row.max)}</td>
              <td>{formatComparisonValue(metricKey, row.latest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sortedRows.length === 0 && (
        <div className="compare-chart-empty">
          {selectedCount === 0 ? "请选择 VPS 查看排行" : "当前范围暂无排行数据"}
        </div>
      )}
    </div>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Compare() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allNodes = useAllNodeMeta();
  const visibleNodeUuids = useVisibleNodeUuids();
  const { data: config } = usePublicConfig();
  const themeSettings = useThemeSettings();
  const displayTimeZone = themeSettings.displayTimeZone;
  const metricParam = searchParams.get("metric");
  const viewParam = searchParams.get("tab");
  const rangeParam = searchParams.get("range");
  const initialMetric = isComparisonMetricKey(metricParam)
    ? metricParam
    : DEFAULT_METRIC;
  const initialMetricKeys = parseSelectedMetricKeys(searchParams.get("metrics"), initialMetric);
  const initialHasPingMetric = initialMetricKeys.some((key) => getComparisonMetric(key).source === "ping");
  const initialHours = Number.parseInt(searchParams.get("hours") || "", 10);
  const initialView = normalizeViewForMetricMode(
    isCompareView(viewParam) ? viewParam : "trend",
    initialMetricKeys.length > 1,
  );
  const initialRangeMode = isCompareRangeMode(rangeParam) ? rangeParam : "preset";
  const initialFrom = parseUrlSeconds(searchParams.get("from"));
  const initialTo = parseUrlSeconds(searchParams.get("to"));
  const initialPingTaskId =
    initialHasPingMetric
      ? normalizeComparisonPingTaskId(searchParams.get("pingTask"))
      : null;
  const initialCustomEnd = initialTo ?? Math.floor(Date.now() / 1000);
  const initialCustomStart = initialFrom ?? initialCustomEnd - Math.max(1, Number.isFinite(initialHours) ? initialHours : DEFAULT_HOURS) * 3_600;
  const [selectedUuids, setSelectedUuids] = useState(() =>
    parseSelectedNodes(searchParams.get("nodes")),
  );
  const [selectedPingTaskIds, setSelectedPingTaskIds] = useState(() =>
    parseSelectedTaskIds(searchParams.get("pingTasks")),
  );
  const [selectedPingTaskId, setSelectedPingTaskId] = useState<number | null>(initialPingTaskId);
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<ComparisonMetricKey[]>(() => initialMetricKeys);
  const [hours, setHours] = useState(Number.isFinite(initialHours) && initialHours > 0 ? initialHours : DEFAULT_HOURS);
  const [view, setView] = useState<CompareView>(initialView);
  const [rangeMode, setRangeMode] = useState<CompareRangeMode>(initialRangeMode);
  const [customStartInput, setCustomStartInput] = useState(() =>
    formatDateTimeLocalValue(initialCustomStart, displayTimeZone),
  );
  const [customEndInput, setCustomEndInput] = useState(() =>
    formatDateTimeLocalValue(initialCustomEnd, displayTimeZone),
  );
  const [nodeSearch, setNodeSearch] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const previousDisplayTimeZoneRef = useRef<DisplayTimeZone>(displayTimeZone);

  useEffect(() => {
    const previousTimeZone = previousDisplayTimeZoneRef.current;
    if (previousTimeZone === displayTimeZone) return;
    previousDisplayTimeZoneRef.current = displayTimeZone;
    setCustomStartInput((previousInput) => {
      const seconds = parseDateTimeLocalInZone(previousInput, previousTimeZone);
      return seconds == null ? previousInput : formatDateTimeLocalValue(seconds, displayTimeZone);
    });
    setCustomEndInput((previousInput) => {
      const seconds = parseDateTimeLocalInZone(previousInput, previousTimeZone);
      return seconds == null ? previousInput : formatDateTimeLocalValue(seconds, displayTimeZone);
    });
  }, [displayTimeZone]);

  const nodeOptions = useMemo(() => {
    const nodeByUuid = new Map(allNodes.map((node) => [node.uuid, node]));
    return visibleNodeUuids
      .map((uuid) => nodeByUuid.get(uuid))
      .filter((node): node is NodeInfo => Boolean(node));
  }, [allNodes, visibleNodeUuids]);

  const selectedUuidSet = useMemo(() => new Set(selectedUuids), [selectedUuids]);
  const selectedNodes = useMemo(
    () => nodeOptions.filter((node) => selectedUuidSet.has(node.uuid)),
    [nodeOptions, selectedUuidSet],
  );
  const selectedMetrics = useMemo(
    () => selectedMetricKeys.map((key) => getComparisonMetric(key)),
    [selectedMetricKeys],
  );
  const multiMetricMode = selectedMetricKeys.length > 1;
  const metricKey = selectedMetricKeys[0] ?? DEFAULT_METRIC;
  const metric = getComparisonMetric(metricKey);
  const hasPingMetrics = selectedMetrics.some((item) => item.source === "ping");
  const hasLoadMetrics = selectedMetrics.some((item) => item.source === "load");
  const selectedLoadTypes = useMemo(
    () =>
      Array.from(
        new Set(
          selectedMetrics
            .map((item) => (item.source === "load" ? item.loadType : null))
            .filter((item): item is NonNullable<typeof item> => Boolean(item)),
        ),
      ).sort(),
    [selectedMetrics],
  );
  const activeView = normalizeViewForMetricMode(view, multiMetricMode);
  const selectedKey = selectedNodes.map((node) => node.uuid).join(",");
  const compareNodes = useMemo(() => nodesToComparisonNodes(selectedNodes), [selectedNodes]);
  const taskScopedPingMode = hasPingMetrics && selectedPingTaskId != null;
  const singleNodePingTaskMode =
    !multiMetricMode &&
    metric.source === "ping" &&
    !taskScopedPingMode &&
    compareNodes.length === 1 &&
    selectedPingTaskIds.length > 0;
  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(config?.record_preserve_time).filter((range) => range.value > 0),
    [config?.record_preserve_time],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(config?.ping_record_preserve_time).filter((range) => range.value > 0),
    [config?.ping_record_preserve_time],
  );
  const rangeOptions = hasPingMetrics ? pingRanges : loadRanges;
  const activeHours = rangeOptions.some((range) => range.value === hours)
    ? hours
    : rangeOptions[0]?.value ?? DEFAULT_HOURS;
  const customStartSeconds = parseDateTimeLocalInZone(customStartInput, displayTimeZone);
  const customEndSeconds = parseDateTimeLocalInZone(customEndInput, displayTimeZone);
  const customRangeValid = isValidComparisonCustomRange(customStartSeconds, customEndSeconds);
  const activeRangeMode = rangeMode === "custom" ? "custom" : "preset";
  const rangeIsUsable = activeRangeMode !== "custom" || customRangeValid;
  const maxRangeHours =
    hasPingMetrics && hasLoadMetrics
      ? Math.min(
          config?.ping_record_preserve_time ?? Number.POSITIVE_INFINITY,
          config?.record_preserve_time ?? Number.POSITIVE_INFINITY,
        )
      : hasPingMetrics
        ? config?.ping_record_preserve_time
        : config?.record_preserve_time;
  const requestHours = getComparisonRequestHours({
    presetHours: activeHours,
    customStart: activeRangeMode === "custom" ? customStartSeconds : null,
    customEnd: activeRangeMode === "custom" ? customEndSeconds : null,
    maxHours: maxRangeHours,
  });
  const customRangeDurationHours =
    customRangeValid && customStartSeconds != null && customEndSeconds != null
      ? Math.max(1 / 60, (customEndSeconds - customStartSeconds) / 3_600)
      : null;
  const displayRangeHours =
    activeRangeMode === "custom" && customRangeDurationHours != null
      ? customRangeDurationHours
      : activeHours;
  const activeRangeLabel =
    activeRangeMode === "custom" && customRangeValid
      ? formatRangeDuration(displayRangeHours)
      : `${activeHours} 小时`;
  const exportRangeToken = formatExportRangeToken(
    activeRangeMode,
    activeHours,
    customRangeValid ? customStartSeconds : null,
    customRangeValid ? customEndSeconds : null,
    displayTimeZone,
  );
  const filteredNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return nodeOptions;
    return nodeOptions.filter((node) => compareSearchText(node).includes(query));
  }, [nodeOptions, nodeSearch]);
  const pingTaskCatalogIds = useMemo(() => {
    const ids = new Set<number>();
    for (const taskId of Object.keys(themeSettings.homepagePingBindings)) {
      const normalizedTaskId = normalizeComparisonPingTaskId(taskId);
      if (normalizedTaskId != null) ids.add(normalizedTaskId);
    }
    if (selectedPingTaskId != null) ids.add(selectedPingTaskId);
    for (const taskId of selectedPingTaskIds) {
      ids.add(taskId);
    }
    return Array.from(ids).sort((left, right) => left - right);
  }, [selectedPingTaskId, selectedPingTaskIds, themeSettings.homepagePingBindings]);
  const selectedPingTaskBoundUuids = useMemo(
    () =>
      getPingTaskBoundNodeUuids(
        themeSettings.homepagePingBindings,
        selectedPingTaskId,
        visibleNodeUuids,
      ),
    [selectedPingTaskId, themeSettings.homepagePingBindings, visibleNodeUuids],
  );

  const canQuery = selectedNodes.length > 0;
  const canFetch = canQuery && rangeIsUsable;
  const loadQuery = useQuery({
    queryKey: ["compare", "load", selectedKey, requestHours, selectedLoadTypes.join(","), activeRangeMode, customStartSeconds, customEndSeconds],
    queryFn: async () => {
      const recordsByType = new Map(
        await Promise.all(
          selectedLoadTypes.map(async (loadType) => [
            loadType,
            await getComparisonLoadRecords({
              uuids: selectedNodes.map((node) => node.uuid),
              hours: requestHours,
              loadType,
            }),
          ] as const),
        ),
      );
      const recordsByMetric: Partial<Record<ComparisonMetricKey, Awaited<ReturnType<typeof getComparisonLoadRecords>>>> = {};
      for (const item of selectedMetrics) {
        if (item.source !== "load" || !item.loadType) continue;
        recordsByMetric[item.key] = recordsByType.get(item.loadType) ?? {};
      }
      return recordsByMetric;
    },
    enabled: canFetch && hasLoadMetrics,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const pingQuery = useQuery({
    queryKey: ["compare", "ping", selectedKey, requestHours, activeRangeMode, customStartSeconds, customEndSeconds],
    queryFn: () =>
      getComparisonPingRecords({
        uuids: selectedNodes.map((node) => node.uuid),
        hours: requestHours,
      }),
    enabled: canFetch && hasPingMetrics,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const pingTaskCatalogQuery = useQuery({
    queryKey: ["compare", "ping-task-catalog", pingTaskCatalogIds.join(",")],
    queryFn: async ({ signal }) => {
      const results = await Promise.allSettled(
        pingTaskCatalogIds.map((taskId) => getPingOverview(1, taskId, { signal })),
      );
      const catalogTasks: PingTask[] = [];
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        catalogTasks.push(...result.value.tasks);
      }
      return Array.from(mergePingTasksById([catalogTasks]).values())
        .sort((left, right) => left.id - right.id);
    },
    enabled: hasPingMetrics && pingTaskCatalogIds.length > 0,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const taskById = useMemo(() => {
    return mergePingTasksById([
      pingTaskCatalogQuery.data,
      pingQuery.data?.tasks,
    ]);
  }, [pingQuery.data?.tasks, pingTaskCatalogQuery.data]);
  const pingTaskOptions = useMemo(() => {
    const ids = new Set<number>();
    for (const taskId of pingTaskCatalogIds) ids.add(taskId);
    for (const task of pingQuery.data?.tasks ?? []) {
      ids.add(task.id);
    }
    if (selectedPingTaskId != null) ids.add(selectedPingTaskId);

    return Array.from(ids)
      .sort((left, right) => left - right)
      .map((taskId) => {
        const task = taskById.get(taskId);
        const boundUuids = getPingTaskBoundNodeUuids(
          themeSettings.homepagePingBindings,
          taskId,
          visibleNodeUuids,
        );
        const pieces = [
          task?.target?.trim(),
          task?.interval ? `${task.interval}s` : "",
          boundUuids.length > 0 ? `${boundUuids.length} 台绑定 VPS` : "",
        ].filter(Boolean);
        return {
          id: taskId,
          label: pingTaskDisplayName(
            taskId,
            task?.name,
            themeSettings.homepagePingTaskGroups[String(taskId)],
          ),
          meta: pieces.join(" · ") || `ID ${taskId}`,
          boundUuids,
        };
      });
  }, [
    pingTaskCatalogIds,
    pingQuery.data?.tasks,
    selectedPingTaskId,
    taskById,
    themeSettings.homepagePingBindings,
    themeSettings.homepagePingTaskGroups,
    visibleNodeUuids,
  ]);
  const selectedPingTask = selectedPingTaskId == null ? undefined : taskById.get(selectedPingTaskId);
  const selectedPingTaskLabel = pingTaskDisplayName(
    selectedPingTaskId,
    selectedPingTask?.name,
    selectedPingTaskId == null ? "" : themeSettings.homepagePingTaskGroups[String(selectedPingTaskId)],
  );
  const rawSeries = useMemo(
    () => {
      if (taskScopedPingMode) {
        return buildPingTaskVpsComparisonSeries({
          metricKey,
          nodes: compareNodes,
          records: pingQuery.data?.records ?? [],
          taskId: selectedPingTaskId,
        });
      }

      if (singleNodePingTaskMode && compareNodes[0]) {
        return buildPingTaskComparisonSeries({
          metricKey,
          node: compareNodes[0],
          records: pingQuery.data?.records ?? [],
          tasks: Array.from(taskById.values()),
          taskIds: selectedPingTaskIds,
        });
      }

      return buildComparisonSeries({
        metricKey,
        nodes: compareNodes,
        loadRecords: loadQuery.data?.[metricKey] ?? {},
        pingRecords: pingQuery.data?.records ?? [],
      });
    },
    [
      compareNodes,
      loadQuery.data,
      metricKey,
      pingQuery.data?.records,
      pingQuery.data?.tasks,
      selectedPingTaskId,
      selectedPingTaskIds,
      singleNodePingTaskMode,
      taskById,
      taskScopedPingMode,
    ],
  );
  const multiAnalysis = useMemo(
    () =>
      buildMultiMetricComparisonAnalysis({
        metricKeys: selectedMetricKeys,
        nodes: compareNodes,
        loadRecordsByMetric: loadQuery.data ?? {},
        pingRecords: pingQuery.data?.records ?? [],
        pingTaskId: selectedPingTaskId,
        range:
          activeRangeMode === "custom" && customRangeValid
            ? { start: customStartSeconds, end: customEndSeconds }
            : undefined,
      }),
    [
      activeRangeMode,
      compareNodes,
      customEndSeconds,
      customRangeValid,
      customStartSeconds,
      loadQuery.data,
      pingQuery.data?.records,
      selectedMetricKeys,
      selectedPingTaskId,
    ],
  );
  const series = useMemo(
    () =>
      activeRangeMode === "custom" && customRangeValid
        ? trimComparisonSeriesToRange(rawSeries, {
            start: customStartSeconds,
            end: customEndSeconds,
          })
        : rawSeries,
    [activeRangeMode, customEndSeconds, customRangeValid, customStartSeconds, rawSeries],
  );
  const rankingRows = useMemo(() => buildComparisonRanking(series), [series]);
  const isLoading =
    (hasLoadMetrics && loadQuery.isLoading) ||
    (hasPingMetrics && pingQuery.isLoading);
  const isFetching =
    (hasLoadMetrics && loadQuery.isFetching) ||
    (hasPingMetrics && pingQuery.isFetching);
  const queryError = loadQuery.error ?? pingQuery.error;
  const totalSamples = rankingRows.reduce((total, row) => total + row.samples, 0);
  const strongest = rankingRows[0];
  const pingTaskExportToken =
    taskScopedPingMode && selectedPingTaskId != null ? `task-${selectedPingTaskId}-` : "";

  const commitSelected = (next: string[]) => {
    const unique = Array.from(new Set(next));
    setSelectedUuids(unique);
    setSearchParams(updateParams(searchParams, { nodes: unique }), { replace: true });
  };

  const commitMetricSelection = (nextKeys: ComparisonMetricKey[]) => {
    const normalized = Array.from(new Set(nextKeys)).filter(isComparisonMetricKey);
    const safeKeys = normalized.length > 0 ? normalized : [DEFAULT_METRIC];
    setSelectedMetricKeys(safeKeys);
    const nextMetrics = safeKeys.map((key) => getComparisonMetric(key));
    const nextHasPing = nextMetrics.some((item) => item.source === "ping");
    if (!nextHasPing) {
      setSelectedPingTaskId(null);
      setSelectedPingTaskIds([]);
    }
    const nextRanges = nextHasPing ? pingRanges : loadRanges;
    const nextHours = nextRanges.some((range) => range.value === hours)
      ? hours
      : nextRanges[0]?.value ?? DEFAULT_HOURS;
    if (activeRangeMode === "preset") setHours(nextHours);
    const nextView = normalizeViewForMetricMode(view, safeKeys.length > 1);
    setView(nextView);
    setSearchParams(
      updateParams(
        searchParams,
        activeRangeMode === "preset"
          ? {
              metrics: safeKeys,
              hours: nextHours,
              view: nextView,
              rangeMode: "preset",
              ...(!nextHasPing ? { pingTask: null, pingTasks: null } : {}),
            }
          : {
              metrics: safeKeys,
              view: nextView,
              rangeMode: "custom",
              from: customStartSeconds,
              to: customEndSeconds,
              ...(!nextHasPing ? { pingTask: null, pingTasks: null } : {}),
            },
      ),
      { replace: true },
    );
  };

  const commitMetric = (next: ComparisonMetricKey) => {
    commitMetricSelection([next]);
  };

  const toggleMetric = (next: ComparisonMetricKey) => {
    if (!multiMetricMode) {
      commitMetricSelection(metricKey === next ? [next] : [metricKey, next]);
      return;
    }
    const exists = selectedMetricKeys.includes(next);
    const nextKeys = exists
      ? selectedMetricKeys.filter((item) => item !== next)
      : [...selectedMetricKeys, next];
    commitMetricSelection(nextKeys.length > 0 ? nextKeys : [next]);
  };

  const commitMetricMode = (multi: boolean) => {
    if (multi) {
      commitMetricSelection(selectedMetricKeys.length > 1 ? selectedMetricKeys : [metricKey, "ram"]);
      return;
    }
    commitMetricSelection([metricKey]);
  };

  const commitPingTask = (taskId: number | null) => {
    const normalizedTaskId = normalizeComparisonPingTaskId(taskId);
    const boundUuids =
      normalizedTaskId == null
        ? []
        : getPingTaskBoundNodeUuids(
            themeSettings.homepagePingBindings,
            normalizedTaskId,
            visibleNodeUuids,
          );
    const nextUuids = normalizedTaskId != null && boundUuids.length > 0 ? boundUuids : selectedUuids;

    setSelectedPingTaskId(normalizedTaskId);
    setSelectedPingTaskIds([]);
    if (nextUuids !== selectedUuids) {
      setSelectedUuids(nextUuids);
    }
    setSearchParams(
      updateParams(searchParams, {
        nodes: nextUuids,
        pingTask: normalizedTaskId,
        pingTasks: null,
      }),
      { replace: true },
    );
  };

  useEffect(() => {
    if (!taskScopedPingMode || searchParams.has("nodes") || selectedUuids.length > 0) return;
    if (selectedPingTaskBoundUuids.length === 0) return;
    setSelectedUuids(selectedPingTaskBoundUuids);
    setSearchParams(updateParams(searchParams, { nodes: selectedPingTaskBoundUuids }), { replace: true });
  }, [
    searchParams,
    selectedPingTaskBoundUuids,
    selectedUuids.length,
    setSearchParams,
    taskScopedPingMode,
  ]);

  const commitHours = (next: number) => {
    setRangeMode("preset");
    setHours(next);
    setSearchParams(updateParams(searchParams, { hours: next, rangeMode: "preset" }), { replace: true });
  };

  const commitCustomRange = (nextStartInput: string, nextEndInput: string) => {
    setRangeMode("custom");
    setCustomStartInput(nextStartInput);
    setCustomEndInput(nextEndInput);
    const nextStart = parseDateTimeLocalInZone(nextStartInput, displayTimeZone);
    const nextEnd = parseDateTimeLocalInZone(nextEndInput, displayTimeZone);
    setSearchParams(
      updateParams(searchParams, {
        rangeMode: "custom",
        from: nextStart,
        to: nextEnd,
      }),
      { replace: true },
    );
  };

  const activateCustomRange = () => {
    const start = parseDateTimeLocalInZone(customStartInput, displayTimeZone);
    const end = parseDateTimeLocalInZone(customEndInput, displayTimeZone);
    if (start && end && end > start) {
      setRangeMode("custom");
      setSearchParams(
        updateParams(searchParams, { rangeMode: "custom", from: start, to: end }),
        { replace: true },
      );
      return;
    }

    const seededEnd = Math.floor(Date.now() / 1000);
    const seededStart = seededEnd - activeHours * 3_600;
    commitCustomRange(
      formatDateTimeLocalValue(seededStart, displayTimeZone),
      formatDateTimeLocalValue(seededEnd, displayTimeZone),
    );
  };

  const commitView = (next: CompareView) => {
    const normalized = normalizeViewForMetricMode(next, multiMetricMode);
    setView(normalized);
    setSearchParams(updateParams(searchParams, { view: normalized }), { replace: true });
  };

  const refresh = () => {
    if (!canFetch) return;
    if (hasLoadMetrics) void loadQuery.refetch();
    if (hasPingMetrics) void pingQuery.refetch();
  };

  const copyMarkdown = async () => {
    const markdown = buildComparisonMarkdown(rankingRows, metricKey);
    await navigator.clipboard.writeText(
      taskScopedPingMode ? `Ping 任务范围: ${selectedPingTaskLabel}\n\n${markdown}` : markdown,
    );
    setExportStatus("Markdown 已复制");
  };

  const exportCsv = () => {
    const csv = buildComparisonCsv(rankingRows, metricKey);
    downloadText(`vps-compare-${metricKey}-${pingTaskExportToken}${exportRangeToken}.csv`, csv, "text/csv;charset=utf-8");
    setExportStatus("CSV 已下载");
  };

  return (
    <div className="compare-page">
      <div className="compare-topbar">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          返回首页
        </Link>
        <div className="compare-title-block">
          <h1>VPS 对比工作台</h1>
          <p>自由选择 VPS、指标和时间区间，比较趋势与区间压力。</p>
        </div>
      </div>

      <section className="compare-control-panel">
        <div className="compare-control-main">
          <label className="compare-node-search">
            <Search size={15} aria-hidden />
            <input
              value={nodeSearch}
              onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="搜索名称、UUID、分组、地区或备注"
              aria-label="搜索 VPS"
            />
          </label>
          <div className="compare-selected-strip">
            {selectedNodes.length > 0 ? (
              selectedNodes.map((node) => (
                <button
                  key={node.uuid}
                  type="button"
                  className="compare-selected-pill"
                  onClick={() =>
                    commitSelected(selectedUuids.filter((uuid) => uuid !== node.uuid))
                  }
                  title="从对比中移除"
                >
                  {nodeLabel(node)}
                </button>
              ))
            ) : (
              <span>
                {taskScopedPingMode
                  ? `选择 VPS 比较「${selectedPingTaskLabel}」`
                  : "选择 1 台查看趋势，选择多台进行对比"}
              </span>
            )}
          </div>
        </div>
        <div className="compare-node-picker" aria-label="选择 VPS">
          {filteredNodes.map((node) => {
            const selected = selectedUuidSet.has(node.uuid);
            return (
              <button
                key={node.uuid}
                type="button"
                className="compare-node-option"
                data-selected={selected ? "true" : "false"}
                onClick={() => {
                  if (selected) {
                    commitSelected(selectedUuids.filter((uuid) => uuid !== node.uuid));
                  } else {
                    commitSelected([...selectedUuids, node.uuid]);
                  }
                }}
              >
                <span className="compare-node-check">{selected && <Check size={12} />}</span>
                <span className="compare-node-copy">
                  <strong>{nodeLabel(node)}</strong>
                  <small>{formatNodeMeta(node)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="compare-toolbar">
        <div className="compare-segmented" aria-label="选择指标模式">
          <button
            type="button"
            data-active={!multiMetricMode ? "true" : "false"}
            onClick={() => commitMetricMode(false)}
          >
            单指标
          </button>
          <button
            type="button"
            data-active={multiMetricMode ? "true" : "false"}
            onClick={() => commitMetricMode(true)}
          >
            多指标
          </button>
        </div>
        <div className="compare-segmented is-metrics" aria-label="选择指标">
          {COMPARISON_METRICS.map((item) => {
            const selected = selectedMetricKeys.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                data-active={selected ? "true" : "false"}
                onClick={() => (multiMetricMode ? toggleMetric(item.key) : commitMetric(item.key))}
                title={multiMetricMode ? "多指标模式下点击可勾选或取消" : item.label}
              >
                {multiMetricMode && selected && <Check size={12} />}
                {item.shortLabel}
              </button>
            );
          })}
        </div>
        <div className="compare-range-control">
          <div className="compare-segmented" aria-label="选择时间区间">
            {rangeOptions.map((range) => (
              <button
                key={range.value}
                type="button"
                data-active={activeRangeMode === "preset" && activeHours === range.value ? "true" : "false"}
                onClick={() => commitHours(range.value)}
              >
                {range.label}
              </button>
            ))}
            <button
              type="button"
              data-active={activeRangeMode === "custom" ? "true" : "false"}
              onClick={activateCustomRange}
            >
              自定义
            </button>
          </div>
          {activeRangeMode === "custom" && (
            <div className="compare-custom-range" aria-label="自定义时间范围">
              <label>
                <span>开始</span>
                <input
                  type="datetime-local"
                  value={customStartInput}
                  onChange={(event) => commitCustomRange(event.target.value, customEndInput)}
                />
              </label>
              <label>
                <span>结束</span>
                <input
                  type="datetime-local"
                  value={customEndInput}
                  onChange={(event) => commitCustomRange(customStartInput, event.target.value)}
                />
              </label>
            </div>
          )}
        </div>
        {multiMetricMode ? (
          <div className="compare-segmented" aria-label="选择多指标视图">
            <button
              type="button"
              data-active={activeView === "insights" ? "true" : "false"}
              onClick={() => commitView("insights")}
            >
              <LineChart size={14} />
              洞察
            </button>
            <button
              type="button"
              data-active={activeView === "matrix" ? "true" : "false"}
              onClick={() => commitView("matrix")}
            >
              <BarChart3 size={14} />
              矩阵
            </button>
            <button
              type="button"
              data-active={activeView === "ranking" ? "true" : "false"}
              onClick={() => commitView("ranking")}
            >
              <BarChart3 size={14} />
              排行
            </button>
          </div>
        ) : (
          <div className="compare-segmented" aria-label="选择视图">
            <button
              type="button"
              data-active={activeView === "trend" ? "true" : "false"}
              onClick={() => commitView("trend")}
            >
              <LineChart size={14} />
              趋势
            </button>
            <button
              type="button"
              data-active={activeView === "ranking" ? "true" : "false"}
              onClick={() => commitView("ranking")}
            >
              <BarChart3 size={14} />
              排行
            </button>
          </div>
        )}
      </section>

      {hasPingMetrics && (
        <section className="compare-ping-task-panel" aria-label="Ping 任务范围">
          <div className="compare-ping-task-head">
            <div>
              <span>Ping 任务范围</span>
              <strong>{taskScopedPingMode ? selectedPingTaskLabel : "全部任务聚合"}</strong>
            </div>
            <div className="compare-segmented" aria-label="选择 Ping 对比范围">
              <button
                type="button"
                data-active={!taskScopedPingMode ? "true" : "false"}
                onClick={() => commitPingTask(null)}
              >
                全部任务
              </button>
              <button
                type="button"
                data-active={taskScopedPingMode ? "true" : "false"}
                disabled={pingTaskOptions.length === 0 && selectedPingTaskId == null}
                onClick={() => commitPingTask(selectedPingTaskId ?? pingTaskOptions[0]?.id ?? null)}
              >
                同一任务
              </button>
            </div>
          </div>
          {pingTaskOptions.length > 0 && (
            <div className="compare-ping-task-options">
              {pingTaskOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="compare-ping-task-option"
                  data-active={selectedPingTaskId === option.id ? "true" : "false"}
                  onClick={() => commitPingTask(option.id)}
                  title={option.meta}
                >
                  <strong>{option.label}</strong>
                  <small>{option.meta}</small>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="compare-summary-grid">
        <div className="compare-summary-card">
          <span>已选 VPS</span>
          <strong>{selectedNodes.length}</strong>
          <small>
            {taskScopedPingMode
              ? `任务绑定 ${selectedPingTaskBoundUuids.length} 台`
              : selectedNodes.length <= 1
                ? "单台可查看"
                : "多台对比中"}
          </small>
        </div>
        <div className="compare-summary-card">
          <span>时间范围</span>
          <strong>{activeRangeMode === "custom" ? "自定义" : activeRangeLabel}</strong>
          <small>
            {activeRangeMode === "custom" && customRangeValid
              ? activeRangeLabel
              : multiMetricMode
                ? `${selectedMetricKeys.length} 个指标`
                : metric.label}
          </small>
        </div>
        <div className="compare-summary-card">
          <span>样本量</span>
          <strong>{multiMetricMode ? multiAnalysis.rows.reduce((total, row) => total + row.sampleCount, 0) : totalSamples}</strong>
          <small>{isFetching ? "刷新中" : multiMetricMode ? "多指标" : metric.shortLabel}</small>
        </div>
        <div className="compare-summary-card">
          <span>压力最高</span>
          <strong>{multiMetricMode ? multiAnalysis.rows[0]?.name ?? "--" : strongest?.name ?? "--"}</strong>
          <small>
            {multiMetricMode
              ? multiAnalysis.rows[0]?.worstCell
                ? `${multiAnalysis.rows[0].worstCell.metric.shortLabel} 风险 ${Math.round(multiAnalysis.rows[0].worstCell.riskScore ?? 0)}`
                : "等待数据"
              : strongest
                ? `P95 ${formatComparisonValue(metricKey, strongest.p95)}`
                : "等待数据"}
          </small>
        </div>
      </section>

      <section className="compare-stage">
        <header className="compare-stage-head">
          <div>
            <h2>
              {multiMetricMode
                ? `多指标分析 · ${selectedMetricKeys.length} 项`
                : taskScopedPingMode
                  ? `${metric.label} · ${selectedPingTaskLabel}`
                  : metric.label}
            </h2>
            <p>
              {selectedNodes.length === 0
                ? taskScopedPingMode
                  ? `选择 VPS 后比较「${selectedPingTaskLabel}」。`
                  : "选择 VPS 后查看历史趋势。"
                : multiMetricMode
                  ? `正在分析 ${selectedNodes.length} 台 VPS 的 ${selectedMetricKeys.length} 个指标。`
                : singleNodePingTaskMode
                  ? `正在查看 ${nodeLabel(selectedNodes[0])} 的 ${selectedPingTaskIds.length} 个 Ping 任务趋势。`
                  : taskScopedPingMode
                    ? `正在比较 Ping 任务「${selectedPingTaskLabel}」下 ${selectedNodes.length} 台 VPS 的 ${metric.label}。`
                  : selectedNodes.length === 1
                  ? `正在查看 ${nodeLabel(selectedNodes[0])} 的 ${metric.label}。`
                  : `正在比较 ${selectedNodes.length} 台 VPS 的 ${metric.label}。`}
            </p>
          </div>
          <div className="compare-stage-actions">
            <button type="button" className="compare-action-button" onClick={refresh} disabled={!canFetch}>
              <RefreshCw size={14} />
              刷新
            </button>
            <button
              type="button"
              className="compare-action-button"
              onClick={() => void copyMarkdown()}
              disabled={rankingRows.length === 0}
            >
              <Copy size={14} />
              Markdown
            </button>
            <button
              type="button"
              className="compare-action-button"
              onClick={exportCsv}
              disabled={rankingRows.length === 0}
            >
              <Download size={14} />
              CSV
            </button>
          </div>
        </header>
        {queryError && (
          <div className="compare-error">
            {queryError instanceof Error ? queryError.message : "历史数据加载失败"}
          </div>
        )}
        {activeRangeMode === "custom" && !customRangeValid && (
          <div className="compare-error">结束时间需要晚于开始时间</div>
        )}
        {exportStatus && <div className="compare-export-status">{exportStatus}</div>}
        {!multiMetricMode && activeView === "trend" ? (
          <ComparisonTrendChart
            metricKey={metricKey}
            hours={displayRangeHours}
            series={series}
            loading={canFetch && isLoading}
            selectedCount={selectedNodes.length}
            rangeStart={activeRangeMode === "custom" && customRangeValid ? customStartSeconds : null}
            rangeEnd={activeRangeMode === "custom" && customRangeValid ? customEndSeconds : null}
            displayTimeZone={displayTimeZone}
          />
        ) : !multiMetricMode ? (
          <RankingTable metricKey={metricKey} rows={rankingRows} selectedCount={selectedNodes.length} />
        ) : (
          <div className="compare-chart-empty">多指标结果视图正在准备渲染</div>
        )}
      </section>

      <section className="compare-ranking-preview">
        <header>
          <h2>区间排行</h2>
          <p>
            {taskScopedPingMode
              ? "按同一 Ping 任务内的 P95 和平均值排序。"
              : "按 P95 和平均值排序，适合快速定位压力最大的 VPS。"}
          </p>
        </header>
        <div className="compare-rank-cards">
          {rankingRows.length > 0 ? (
            rankingRows.slice(0, 4).map((row, index) => (
              <Link
                key={row.uuid}
                to={`/instance/${rowInstanceUuid(row.uuid)}`}
                className="compare-rank-card"
                style={{ "--rank": index + 1 } as CSSProperties}
              >
                <span>#{index + 1}</span>
                <strong>{row.name}</strong>
                <small>
                  <ArrowUp size={11} />
                  P95 {formatComparisonValue(metricKey, row.p95)}
                </small>
                <small>
                  <ArrowDown size={11} />
                  平均 {formatComparisonValue(metricKey, row.average)}
                </small>
              </Link>
            ))
          ) : (
            <div className="compare-rank-empty">
              {selectedNodes.length === 0 ? "请选择 VPS 查看区间排行" : "当前范围暂无排行数据"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
