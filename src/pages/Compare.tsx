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
  COMPARISON_METRICS,
  formatComparisonValue,
  getComparisonMetric,
  nodesToComparisonNodes,
  prepareComparisonTrendData,
  type ComparisonMetricKey,
  type ComparisonRankingRow,
  type ComparisonSeries,
} from "@/utils/vpsCompare";
import type { NodeInfo } from "@/types/komari";

const DEFAULT_METRIC: ComparisonMetricKey = "cpu";
const DEFAULT_HOURS = 4;
type CompareView = "trend" | "ranking";

function isComparisonMetricKey(value: string | null): value is ComparisonMetricKey {
  return COMPARISON_METRICS.some((metric) => metric.key === value);
}

function isCompareView(value: string | null): value is CompareView {
  return value === "trend" || value === "ranking";
}

function parseSelectedNodes(value: string | null) {
  return value
    ? Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)))
    : [];
}

function nodeLabel(node: NodeInfo) {
  return node.name.trim() || node.uuid;
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
  return next;
}

function ComparisonTrendChart({
  metricKey,
  hours,
  series,
  loading,
  selectedCount,
}: {
  metricKey: ComparisonMetricKey;
  hours: number;
  series: ComparisonSeries[];
  loading: boolean;
  selectedCount: number;
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
    () => prepareComparisonTrendData({ metricKey, series, hours }),
    [hours, metricKey, series],
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

  return (
    <div ref={ref} className="compare-chart-wrap">
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
}: {
  metricKey: ComparisonMetricKey;
  rows: ComparisonRankingRow[];
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
                <Link to={`/instance/${row.uuid}`} className="compare-ranking-name">
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
      {rows.length === 0 && <div className="compare-chart-empty">暂无排行数据</div>}
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
  const initialMetric = isComparisonMetricKey(metricParam)
    ? metricParam
    : DEFAULT_METRIC;
  const initialHours = Number.parseInt(searchParams.get("hours") || "", 10);
  const initialView = isCompareView(viewParam) ? viewParam : "trend";
  const [selectedUuids, setSelectedUuids] = useState(() =>
    parseSelectedNodes(searchParams.get("nodes")),
  );
  const [metricKey, setMetricKey] = useState<ComparisonMetricKey>(initialMetric);
  const [hours, setHours] = useState(Number.isFinite(initialHours) && initialHours > 0 ? initialHours : DEFAULT_HOURS);
  const [view, setView] = useState<CompareView>(initialView);
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
  const filteredNodes = useMemo(() => {
    const query = nodeSearch.trim().toLowerCase();
    if (!query) return nodeOptions;
    return nodeOptions.filter((node) => compareSearchText(node).includes(query));
  }, [nodeOptions, nodeSearch]);

  const canQuery = selectedNodes.length > 0;
  const loadQuery = useQuery({
    queryKey: ["compare", "load", selectedKey, activeHours, metricKey],
    queryFn: () =>
      getComparisonLoadRecords({
        uuids: selectedNodes.map((node) => node.uuid),
        hours: activeHours,
        loadType: getSelectedMetricLoadType(metricKey),
      }),
    enabled: canQuery && metric.source === "load",
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const pingQuery = useQuery({
    queryKey: ["compare", "ping", selectedKey, activeHours],
    queryFn: () =>
      getComparisonPingRecords({
        uuids: selectedNodes.map((node) => node.uuid),
        hours: activeHours,
      }),
    enabled: canQuery && metric.source === "ping",
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const series = useMemo(
    () =>
      buildComparisonSeries({
        metricKey,
        nodes: compareNodes,
        loadRecords: loadQuery.data ?? {},
        pingRecords: pingQuery.data?.records ?? [],
      }),
    [compareNodes, loadQuery.data, metricKey, pingQuery.data?.records],
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
    setHours(nextHours);
    setSearchParams(updateParams(searchParams, { metric: next, hours: nextHours }), { replace: true });
  };

  const commitHours = (next: number) => {
    setHours(next);
    setSearchParams(updateParams(searchParams, { hours: next }), { replace: true });
  };

  const commitView = (next: CompareView) => {
    setView(next);
    setSearchParams(updateParams(searchParams, { view: next }), { replace: true });
  };

  const refresh = () => {
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
    downloadText(`vps-compare-${metricKey}-${activeHours}h.csv`, csv, "text/csv;charset=utf-8");
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
        <div className="compare-segmented" aria-label="选择时间区间">
          {rangeOptions.map((range) => (
            <button
              key={range.value}
              type="button"
              data-active={activeHours === range.value ? "true" : "false"}
              onClick={() => commitHours(range.value)}
            >
              {range.label}
            </button>
          ))}
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
          <small>不限数量</small>
        </div>
        <div className="compare-summary-card">
          <span>当前指标</span>
          <strong>{metric.shortLabel}</strong>
          <small>{metric.label}</small>
        </div>
        <div className="compare-summary-card">
          <span>样本量</span>
          <strong>{totalSamples}</strong>
          <small>{isFetching ? "刷新中" : `${activeHours} 小时区间`}</small>
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
                : selectedNodes.length === 1
                  ? `正在查看 ${nodeLabel(selectedNodes[0])} 的 ${metric.label}。`
                  : `正在比较 ${selectedNodes.length} 台 VPS 的 ${metric.label}。`}
            </p>
          </div>
          <div className="compare-stage-actions">
            <button type="button" className="compare-action-button" onClick={refresh} disabled={!canQuery}>
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
        {exportStatus && <div className="compare-export-status">{exportStatus}</div>}
        {view === "trend" ? (
          <ComparisonTrendChart
            metricKey={metricKey}
            hours={activeHours}
            series={series}
            loading={canQuery && isLoading}
            selectedCount={selectedNodes.length}
          />
        ) : (
          <RankingTable metricKey={metricKey} rows={rankingRows} />
        )}
      </section>

      <section className="compare-ranking-preview">
        <header>
          <h2>区间排行</h2>
          <p>按 P95 和平均值排序，适合快速定位压力最大的 VPS。</p>
        </header>
        <div className="compare-rank-cards">
          {rankingRows.slice(0, 4).map((row, index) => (
            <Link
              key={row.uuid}
              to={`/instance/${row.uuid}`}
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
          ))}
        </div>
      </section>
    </div>
  );
}
