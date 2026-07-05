import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  ArrowDown,
  ArrowUp,
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
import {
  buildComparisonCsv,
  buildComparisonMarkdown,
  buildComparisonRanking,
  buildComparisonSeries,
  buildPingTaskComparisonSeries,
  COMPARISON_METRICS,
  formatComparisonValue,
  getComparisonRequestHours,
  getComparisonMetric,
  isValidComparisonCustomRange,
  nodesToComparisonNodes,
  prepareComparisonTrendData,
  trimComparisonSeriesToRange,
  type ComparisonMetricKey,
  type ComparisonRankingRow,
  type ComparisonSeries,
} from "@/utils/vpsCompare";
import type { NodeInfo } from "@/types/komari";

const DEFAULT_METRIC: ComparisonMetricKey = "cpu";
const DEFAULT_HOURS = 4;
type CompareView = "trend" | "ranking";
type CompareRangeMode = "preset" | "custom";

function isComparisonMetricKey(value: string | null): value is ComparisonMetricKey {
  return COMPARISON_METRICS.some((metric) => metric.key === value);
}

function isCompareView(value: string | null): value is CompareView {
  return value === "trend" || value === "ranking";
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

function toDateTimeLocalValue(seconds: number) {
  const date = new Date(seconds * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
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

function formatExportRangeToken(mode: CompareRangeMode, hours: number, start: number | null, end: number | null) {
  if (mode !== "custom" || start == null || end == null) return `${hours}h`;
  return `${new Date(start * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${new Date(end * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
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

function getSelectedMetricLoadType(metricKey: ComparisonMetricKey) {
  const metric = getComparisonMetric(metricKey);
  if (metric.source !== "load" || !metric.loadType) {
    throw new Error(`Metric ${metricKey} does not use load records`);
  }
  return metric.loadType;
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
    hours?: number;
    view?: CompareView;
    rangeMode?: CompareRangeMode;
    from?: number | null;
    to?: number | null;
  },
) {
  const next = new URLSearchParams(base);
  if (patch.nodes) {
    if (patch.nodes.length > 0) next.set("nodes", patch.nodes.join(","));
    else next.delete("nodes");
  }
  if (patch.metric) next.set("metric", patch.metric);
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
  return next;
}

function ComparisonTrendChart({
  metricKey,
  hours,
  series,
  loading,
  selectedCount,
  rangeStart,
  rangeEnd,
}: {
  metricKey: ComparisonMetricKey;
  hours: number;
  series: ComparisonSeries[];
  loading: boolean;
  selectedCount: number;
  rangeStart?: number | null;
  rangeEnd?: number | null;
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
          values: createTimeAxisFormatter(hours),
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
  }, [colors, h, hours, metric.axisKind, metric.label, metric.source, metricKey, resolvedAppearance, visualSeries, w]);

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
  return (
    <div className="compare-ranking-table-wrap">
      <table className="compare-ranking-table">
        <thead>
          <tr>
            <th>VPS</th>
            <th>分组</th>
            <th>地区</th>
            <th>样本</th>
            <th>平均</th>
            <th>P95</th>
            <th>峰值</th>
            <th>最新</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
      {rows.length === 0 && (
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
  const metricParam = searchParams.get("metric");
  const viewParam = searchParams.get("tab");
  const rangeParam = searchParams.get("range");
  const initialMetric = isComparisonMetricKey(metricParam)
    ? metricParam
    : DEFAULT_METRIC;
  const initialHours = Number.parseInt(searchParams.get("hours") || "", 10);
  const initialView = isCompareView(viewParam) ? viewParam : "trend";
  const initialRangeMode = isCompareRangeMode(rangeParam) ? rangeParam : "preset";
  const initialFrom = parseUrlSeconds(searchParams.get("from"));
  const initialTo = parseUrlSeconds(searchParams.get("to"));
  const initialCustomEnd = initialTo ?? Math.floor(Date.now() / 1000);
  const initialCustomStart = initialFrom ?? initialCustomEnd - Math.max(1, Number.isFinite(initialHours) ? initialHours : DEFAULT_HOURS) * 3_600;
  const [selectedUuids, setSelectedUuids] = useState(() =>
    parseSelectedNodes(searchParams.get("nodes")),
  );
  const [selectedPingTaskIds] = useState(() =>
    parseSelectedTaskIds(searchParams.get("pingTasks")),
  );
  const [metricKey, setMetricKey] = useState<ComparisonMetricKey>(initialMetric);
  const [hours, setHours] = useState(Number.isFinite(initialHours) && initialHours > 0 ? initialHours : DEFAULT_HOURS);
  const [view, setView] = useState<CompareView>(initialView);
  const [rangeMode, setRangeMode] = useState<CompareRangeMode>(initialRangeMode);
  const [customStartInput, setCustomStartInput] = useState(() => toDateTimeLocalValue(initialCustomStart));
  const [customEndInput, setCustomEndInput] = useState(() => toDateTimeLocalValue(initialCustomEnd));
  const [nodeSearch, setNodeSearch] = useState("");
  const [exportStatus, setExportStatus] = useState("");

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
  const metric = getComparisonMetric(metricKey);
  const selectedKey = selectedNodes.map((node) => node.uuid).join(",");
  const compareNodes = useMemo(() => nodesToComparisonNodes(selectedNodes), [selectedNodes]);
  const singleNodePingTaskMode =
    metric.source === "ping" && compareNodes.length === 1 && selectedPingTaskIds.length > 0;
  const loadRanges = useMemo(
    () => buildLoadTimeRangeOptions(config?.record_preserve_time).filter((range) => range.value > 0),
    [config?.record_preserve_time],
  );
  const pingRanges = useMemo(
    () => buildPingTimeRangeOptions(config?.ping_record_preserve_time).filter((range) => range.value > 0),
    [config?.ping_record_preserve_time],
  );
  const rangeOptions = metric.source === "ping" ? pingRanges : loadRanges;
  const activeHours = rangeOptions.some((range) => range.value === hours)
    ? hours
    : rangeOptions[0]?.value ?? DEFAULT_HOURS;
  const customStartSeconds = fromDateTimeLocalValue(customStartInput);
  const customEndSeconds = fromDateTimeLocalValue(customEndInput);
  const customRangeValid = isValidComparisonCustomRange(customStartSeconds, customEndSeconds);
  const activeRangeMode = rangeMode === "custom" ? "custom" : "preset";
  const rangeIsUsable = activeRangeMode !== "custom" || customRangeValid;
  const maxRangeHours = metric.source === "ping"
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
  );
  const filteredNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return nodeOptions;
    return nodeOptions.filter((node) => compareSearchText(node).includes(query));
  }, [nodeOptions, nodeSearch]);

  const canQuery = selectedNodes.length > 0;
  const canFetch = canQuery && rangeIsUsable;
  const loadQuery = useQuery({
    queryKey: ["compare", "load", selectedKey, requestHours, metricKey, activeRangeMode, customStartSeconds, customEndSeconds],
    queryFn: () =>
      getComparisonLoadRecords({
        uuids: selectedNodes.map((node) => node.uuid),
        hours: requestHours,
        loadType: getSelectedMetricLoadType(metricKey),
      }),
    enabled: canFetch && metric.source === "load",
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
    enabled: canFetch && metric.source === "ping",
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const rawSeries = useMemo(
    () => {
      if (singleNodePingTaskMode && compareNodes[0]) {
        return buildPingTaskComparisonSeries({
          metricKey,
          node: compareNodes[0],
          records: pingQuery.data?.records ?? [],
          tasks: pingQuery.data?.tasks ?? [],
          taskIds: selectedPingTaskIds,
        });
      }

      return buildComparisonSeries({
        metricKey,
        nodes: compareNodes,
        loadRecords: loadQuery.data ?? {},
        pingRecords: pingQuery.data?.records ?? [],
      });
    },
    [
      compareNodes,
      loadQuery.data,
      metricKey,
      pingQuery.data?.records,
      pingQuery.data?.tasks,
      selectedPingTaskIds,
      singleNodePingTaskMode,
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
  const isLoading = metric.source === "load" ? loadQuery.isLoading : pingQuery.isLoading;
  const isFetching = metric.source === "load" ? loadQuery.isFetching : pingQuery.isFetching;
  const queryError = metric.source === "load" ? loadQuery.error : pingQuery.error;
  const totalSamples = rankingRows.reduce((total, row) => total + row.samples, 0);
  const strongest = rankingRows[0];

  const commitSelected = (next: string[]) => {
    const unique = Array.from(new Set(next));
    setSelectedUuids(unique);
    setSearchParams(updateParams(searchParams, { nodes: unique }), { replace: true });
  };

  const commitMetric = (next: ComparisonMetricKey) => {
    setMetricKey(next);
    const nextMetric = getComparisonMetric(next);
    const nextRanges = nextMetric.source === "ping" ? pingRanges : loadRanges;
    const nextHours = nextRanges.some((range) => range.value === hours)
      ? hours
      : nextRanges[0]?.value ?? DEFAULT_HOURS;
    if (activeRangeMode === "preset") setHours(nextHours);
    setSearchParams(
      updateParams(
        searchParams,
        activeRangeMode === "preset"
          ? { metric: next, hours: nextHours, rangeMode: "preset" }
          : { metric: next, rangeMode: "custom", from: customStartSeconds, to: customEndSeconds },
      ),
      { replace: true },
    );
  };

  const commitHours = (next: number) => {
    setRangeMode("preset");
    setHours(next);
    setSearchParams(updateParams(searchParams, { hours: next, rangeMode: "preset" }), { replace: true });
  };

  const commitCustomRange = (nextStartInput: string, nextEndInput: string) => {
    setRangeMode("custom");
    setCustomStartInput(nextStartInput);
    setCustomEndInput(nextEndInput);
    setSearchParams(
      updateParams(searchParams, {
        rangeMode: "custom",
        from: fromDateTimeLocalValue(nextStartInput),
        to: fromDateTimeLocalValue(nextEndInput),
      }),
      { replace: true },
    );
  };

  const activateCustomRange = () => {
    const start = fromDateTimeLocalValue(customStartInput);
    const end = fromDateTimeLocalValue(customEndInput);
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
    commitCustomRange(toDateTimeLocalValue(seededStart), toDateTimeLocalValue(seededEnd));
  };

  const commitView = (next: CompareView) => {
    setView(next);
    setSearchParams(updateParams(searchParams, { view: next }), { replace: true });
  };

  const refresh = () => {
    if (!canFetch) return;
    if (metric.source === "load") void loadQuery.refetch();
    else void pingQuery.refetch();
  };

  const copyMarkdown = async () => {
    const markdown = buildComparisonMarkdown(rankingRows, metricKey);
    await navigator.clipboard.writeText(markdown);
    setExportStatus("Markdown 已复制");
  };

  const exportCsv = () => {
    const csv = buildComparisonCsv(rankingRows, metricKey);
    downloadText(`vps-compare-${metricKey}-${exportRangeToken}.csv`, csv, "text/csv;charset=utf-8");
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
              <span>选择 1 台查看趋势，选择多台进行对比</span>
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
        <div className="compare-segmented is-metrics" aria-label="选择指标">
          {COMPARISON_METRICS.map((item) => (
            <button
              key={item.key}
              type="button"
              data-active={metricKey === item.key ? "true" : "false"}
              onClick={() => commitMetric(item.key)}
            >
              {item.shortLabel}
            </button>
          ))}
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
        <div className="compare-segmented" aria-label="选择视图">
          <button
            type="button"
            data-active={view === "trend" ? "true" : "false"}
            onClick={() => commitView("trend")}
          >
            <LineChart size={14} />
            趋势
          </button>
          <button
            type="button"
            data-active={view === "ranking" ? "true" : "false"}
            onClick={() => commitView("ranking")}
          >
            <BarChart3 size={14} />
            排行
          </button>
        </div>
      </section>

      <section className="compare-summary-grid">
        <div className="compare-summary-card">
          <span>已选 VPS</span>
          <strong>{selectedNodes.length}</strong>
          <small>{selectedNodes.length <= 1 ? "单台可查看" : "多台对比中"}</small>
        </div>
        <div className="compare-summary-card">
          <span>时间范围</span>
          <strong>{activeRangeMode === "custom" ? "自定义" : activeRangeLabel}</strong>
          <small>{activeRangeMode === "custom" && customRangeValid ? activeRangeLabel : metric.label}</small>
        </div>
        <div className="compare-summary-card">
          <span>样本量</span>
          <strong>{totalSamples}</strong>
          <small>{isFetching ? "刷新中" : metric.shortLabel}</small>
        </div>
        <div className="compare-summary-card">
          <span>压力最高</span>
          <strong>{strongest?.name ?? "--"}</strong>
          <small>{strongest ? `P95 ${formatComparisonValue(metricKey, strongest.p95)}` : "等待数据"}</small>
        </div>
      </section>

      <section className="compare-stage">
        <header className="compare-stage-head">
          <div>
            <h2>{metric.label}</h2>
            <p>
              {selectedNodes.length === 0
                ? "选择 VPS 后查看历史趋势。"
                : singleNodePingTaskMode
                  ? `正在查看 ${nodeLabel(selectedNodes[0])} 的 ${selectedPingTaskIds.length} 个 Ping 任务趋势。`
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
        {view === "trend" ? (
          <ComparisonTrendChart
            metricKey={metricKey}
            hours={displayRangeHours}
            series={series}
            loading={canFetch && isLoading}
            selectedCount={selectedNodes.length}
            rangeStart={activeRangeMode === "custom" && customRangeValid ? customStartSeconds : null}
            rangeEnd={activeRangeMode === "custom" && customRangeValid ? customEndSeconds : null}
          />
        ) : (
          <RankingTable metricKey={metricKey} rows={rankingRows} selectedCount={selectedNodes.length} />
        )}
      </section>

      <section className="compare-ranking-preview">
        <header>
          <h2>区间排行</h2>
          <p>按 P95 和平均值排序，适合快速定位压力最大的 VPS。</p>
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
