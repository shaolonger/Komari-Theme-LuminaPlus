import type { ComparisonLoadRecords, ComparisonLoadType } from "@/services/api";
import type { LoadRecord, NodeInfo, PingRecord, PingTask } from "@/types/komari";
import { formatTrafficRateLabel, trimFixed } from "@/utils/format";

export type ComparisonMetricKey =
  | "cpu"
  | "ram"
  | "disk"
  | "load"
  | "net_in"
  | "net_out"
  | "connections"
  | "ping_latency"
  | "ping_loss";

export type ComparisonMetricSource = "load" | "ping";
export type ComparisonAxisKind = "percent" | "network" | "count" | "latency" | "default";

export interface ComparisonMetricDefinition {
  key: ComparisonMetricKey;
  label: string;
  shortLabel: string;
  source: ComparisonMetricSource;
  axisKind: ComparisonAxisKind;
  unit: string;
  loadType?: ComparisonLoadType;
  higherIsRisk: boolean;
}

export interface ComparisonNode {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
}

export interface ComparisonPoint {
  time: number;
  value: number;
}

export interface ComparisonSeries {
  uuid: string;
  name: string;
  group: string;
  region: string;
  points: ComparisonPoint[];
}

export interface ComparisonTrendData {
  series: ComparisonSeries[];
  times: number[];
  valuesBySeries: Array<Array<number | null | undefined>>;
  bucketSeconds: number | null;
  smoothWindow: number;
  rawSamples: number;
}

export interface ComparisonRequestWindowInput {
  presetHours: number;
  customStart?: number | null;
  customEnd?: number | null;
  nowSeconds?: number;
  maxHours?: number | null;
}

export interface ComparisonStats {
  samples: number;
  average: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
  latest: number | null;
}

export interface ComparisonRankingRow extends ComparisonStats {
  uuid: string;
  name: string;
  group: string;
  region: string;
}

export const COMPARISON_METRICS: ComparisonMetricDefinition[] = [
  {
    key: "cpu",
    label: "CPU 使用率",
    shortLabel: "CPU",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "cpu",
    higherIsRisk: true,
  },
  {
    key: "ram",
    label: "内存使用率",
    shortLabel: "内存",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "ram",
    higherIsRisk: true,
  },
  {
    key: "disk",
    label: "磁盘使用率",
    shortLabel: "磁盘",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "disk",
    higherIsRisk: true,
  },
  {
    key: "load",
    label: "系统负载",
    shortLabel: "负载",
    source: "load",
    axisKind: "default",
    unit: "",
    loadType: "load",
    higherIsRisk: true,
  },
  {
    key: "net_in",
    label: "下行速率",
    shortLabel: "下行",
    source: "load",
    axisKind: "network",
    unit: "B/s",
    loadType: "network",
    higherIsRisk: true,
  },
  {
    key: "net_out",
    label: "上行速率",
    shortLabel: "上行",
    source: "load",
    axisKind: "network",
    unit: "B/s",
    loadType: "network",
    higherIsRisk: true,
  },
  {
    key: "connections",
    label: "连接数",
    shortLabel: "连接",
    source: "load",
    axisKind: "count",
    unit: "",
    loadType: "connections",
    higherIsRisk: true,
  },
  {
    key: "ping_latency",
    label: "Ping 延迟",
    shortLabel: "延迟",
    source: "ping",
    axisKind: "latency",
    unit: "ms",
    higherIsRisk: true,
  },
  {
    key: "ping_loss",
    label: "Ping 丢包率",
    shortLabel: "丢包",
    source: "ping",
    axisKind: "percent",
    unit: "%",
    higherIsRisk: true,
  },
];

const METRIC_BY_KEY = new Map(COMPARISON_METRICS.map((metric) => [metric.key, metric]));
const COMPARISON_PING_TARGET_POINTS = 220;
const COMPARISON_LONG_GAP_BUCKETS = 3;
const COMPARISON_BUCKET_STEPS = [
  30,
  60,
  120,
  300,
  600,
  900,
  1_800,
  3_600,
  7_200,
  14_400,
  21_600,
  43_200,
  86_400,
] as const;

export function getComparisonMetric(key: ComparisonMetricKey) {
  const metric = METRIC_BY_KEY.get(key);
  if (!metric) {
    throw new Error(`Unknown comparison metric: ${key}`);
  }
  return metric;
}

export function toComparisonSeconds(value: string | number): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function aggregateTrendBucket(metricKey: ComparisonMetricKey, values: number[]) {
  if (metricKey === "ping_latency") return median(values);
  return average(values);
}

function chooseComparisonBucketSeconds(metric: ComparisonMetricDefinition, rangeSeconds: number) {
  if (metric.source !== "ping") return null;
  const safeRange = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? rangeSeconds : 3_600;
  const desired = Math.max(60, Math.ceil(safeRange / COMPARISON_PING_TARGET_POINTS));
  return COMPARISON_BUCKET_STEPS.find((step) => step >= desired) ?? 86_400;
}

function chooseComparisonSmoothWindow(metricKey: ComparisonMetricKey, bucketSeconds: number | null) {
  if (bucketSeconds == null) return 1;
  if (metricKey === "ping_latency") return bucketSeconds <= 60 ? 5 : 3;
  if (metricKey === "ping_loss") return bucketSeconds <= 120 ? 3 : 1;
  return 1;
}

function smoothTrendValues(
  values: Array<number | null | undefined>,
  windowPoints: number,
): Array<number | null | undefined> {
  if (windowPoints <= 1) return values;
  const numericCount = values.filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  if (numericCount < Math.max(3, windowPoints)) return values;
  const half = Math.floor(windowPoints / 2);
  return values.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    let sum = 0;
    let count = 0;
    for (
      let pointer = Math.max(0, index - half);
      pointer <= Math.min(values.length - 1, index + half);
      pointer += 1
    ) {
      const nearby = values[pointer];
      if (typeof nearby === "number" && Number.isFinite(nearby)) {
        sum += nearby;
        count += 1;
      }
    }
    return count > 0 ? sum / count : value;
  });
}

function breakLongTrendGaps(
  values: Array<number | null | undefined>,
): Array<number | null | undefined> {
  const out = values.slice();
  let previousNumericIndex = -1;
  for (let index = 0; index < out.length; index += 1) {
    const value = out[index];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (previousNumericIndex >= 0 && index - previousNumericIndex > COMPARISON_LONG_GAP_BUCKETS) {
      const breakIndex = previousNumericIndex + 1;
      if (out[breakIndex] === undefined) out[breakIndex] = null;
    }
    previousNumericIndex = index;
  }
  return out;
}

export function isValidComparisonCustomRange(
  start: number | null | undefined,
  end: number | null | undefined,
) {
  return (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
  );
}

export function getComparisonRequestHours({
  presetHours,
  customStart,
  customEnd,
  nowSeconds = Date.now() / 1000,
  maxHours,
}: ComparisonRequestWindowInput) {
  const maxSafeHours =
    typeof maxHours === "number" && Number.isFinite(maxHours) && maxHours > 0
      ? Math.floor(maxHours)
      : null;
  const clampToMax = (hours: number) =>
    maxSafeHours == null ? hours : Math.min(hours, maxSafeHours);

  if (!isValidComparisonCustomRange(customStart, customEnd)) {
    return clampToMax(Math.max(1, Math.ceil(presetHours)));
  }

  const safeNow = Number.isFinite(nowSeconds) ? nowSeconds : Date.now() / 1000;
  const rangeStart = Number(customStart);
  const spanFromNow = Math.max(1, safeNow - rangeStart);
  return clampToMax(Math.max(1, Math.ceil(spanFromNow / 3_600)));
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

function getLoadMetricValue(metric: ComparisonMetricKey, record: LoadRecord) {
  switch (metric) {
    case "cpu":
      return normalizeNumber(record.cpu);
    case "ram":
      return percent(record.ram, record.ram_total);
    case "disk":
      return percent(record.disk, record.disk_total);
    case "load":
      return normalizeNumber(record.load);
    case "net_in":
      return normalizeNumber(record.net_in);
    case "net_out":
      return normalizeNumber(record.net_out);
    case "connections":
      return normalizeNumber((record.connections ?? 0) + (record.connections_udp ?? 0));
    default:
      return null;
  }
}

function buildLoadSeries(
  metric: ComparisonMetricDefinition,
  nodes: ComparisonNode[],
  recordsByUuid: ComparisonLoadRecords,
): ComparisonSeries[] {
  return nodes.map((node) => {
    const points = (recordsByUuid[node.uuid] ?? [])
      .map((record) => ({
        time: toComparisonSeconds(record.time),
        value: getLoadMetricValue(metric.key, record),
      }))
      .filter((point): point is ComparisonPoint =>
        point.time > 0 && point.value != null && Number.isFinite(point.value),
      )
      .sort((a, b) => a.time - b.time);

    return {
      uuid: node.uuid,
      name: node.name || node.uuid,
      group: String(node.group || ""),
      region: String(node.region || ""),
      points,
    };
  });
}

function buildPingPoints(metric: ComparisonMetricDefinition, records: PingRecord[]) {
  const buckets = new Map<number, { total: number; lost: number; latencySum: number; latencyCount: number }>();
  for (const record of records) {
    const time = toComparisonSeconds(record.time);
    if (time <= 0) continue;
    const bucket = buckets.get(time) ?? {
      total: 0,
      lost: 0,
      latencySum: 0,
      latencyCount: 0,
    };
    bucket.total += 1;
    if (record.value < 0) {
      bucket.lost += 1;
    } else {
      bucket.latencySum += record.value;
      bucket.latencyCount += 1;
    }
    buckets.set(time, bucket);
  }

  return Array.from(buckets.entries())
    .map(([time, bucket]) => {
      const value =
        metric.key === "ping_loss"
          ? (bucket.lost / Math.max(1, bucket.total)) * 100
          : bucket.latencyCount > 0
            ? bucket.latencySum / bucket.latencyCount
            : null;
      return { time, value };
    })
    .filter((point): point is ComparisonPoint =>
      point.value != null && Number.isFinite(point.value),
    )
    .sort((a, b) => a.time - b.time);
}

function buildPingSeries(
  metric: ComparisonMetricDefinition,
  nodes: ComparisonNode[],
  records: PingRecord[],
): ComparisonSeries[] {
  const recordsByUuid = new Map<string, PingRecord[]>();
  for (const record of records) {
    if (!record.client) continue;
    const list = recordsByUuid.get(record.client) ?? [];
    list.push(record);
    recordsByUuid.set(record.client, list);
  }

  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name || node.uuid,
    group: String(node.group || ""),
    region: String(node.region || ""),
    points: buildPingPoints(metric, recordsByUuid.get(node.uuid) ?? []),
  }));
}

export function buildPingTaskComparisonSeries({
  metricKey,
  node,
  records,
  tasks,
  taskIds,
}: {
  metricKey: ComparisonMetricKey;
  node: ComparisonNode;
  records: PingRecord[];
  tasks: PingTask[];
  taskIds: number[];
}): ComparisonSeries[] {
  const metric = getComparisonMetric(metricKey);
  if (metric.source !== "ping") return [];

  const normalizedTaskIds = Array.from(new Set(taskIds))
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
    .sort((left, right) => left - right);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const recordsByTask = new Map<number, PingRecord[]>();
  for (const record of records) {
    if (record.client && record.client !== node.uuid) continue;
    if (!normalizedTaskIds.includes(record.task_id)) continue;
    const list = recordsByTask.get(record.task_id) ?? [];
    list.push(record);
    recordsByTask.set(record.task_id, list);
  }

  return normalizedTaskIds.map((taskId) => {
    const task = taskById.get(taskId);
    const target = task?.target?.trim() ?? "";
    return {
      uuid: `${node.uuid}:ping:${taskId}`,
      name: task?.name?.trim() || `任务 #${taskId}`,
      group: node.name || node.uuid,
      region: target || String(taskId),
      points: buildPingPoints(metric, recordsByTask.get(taskId) ?? []),
    };
  });
}

export function buildComparisonSeries({
  metricKey,
  nodes,
  loadRecords = {},
  pingRecords = [],
}: {
  metricKey: ComparisonMetricKey;
  nodes: ComparisonNode[];
  loadRecords?: ComparisonLoadRecords;
  pingRecords?: PingRecord[];
}): ComparisonSeries[] {
  const metric = getComparisonMetric(metricKey);
  return metric.source === "load"
    ? buildLoadSeries(metric, nodes, loadRecords)
    : buildPingSeries(metric, nodes, pingRecords);
}

function filterComparisonPoints(
  points: ComparisonPoint[],
  start: number | null | undefined,
  end: number | null | undefined,
) {
  return points.filter((point) => {
    if (start != null && point.time < start) return false;
    if (end != null && point.time > end) return false;
    return true;
  });
}

export function trimComparisonSeriesToRange(
  series: ComparisonSeries[],
  range?: { start?: number | null; end?: number | null },
): ComparisonSeries[] {
  if (!range || (range.start == null && range.end == null)) return series;
  return series.map((item) => ({
    ...item,
    points: filterComparisonPoints(item.points, range.start, range.end),
  }));
}

function alignExactComparisonSeries(series: ComparisonSeries[]): ComparisonTrendData {
  const times = Array.from(
    new Set(series.flatMap((item) => item.points.map((point) => point.time))),
  ).sort((a, b) => a - b);
  const valueMaps = series.map(
    (item) => new Map(item.points.map((point) => [point.time, point.value])),
  );
  return {
    series,
    times,
    valuesBySeries: valueMaps.map((map) => times.map((time) => map.get(time) ?? null)),
    bucketSeconds: null,
    smoothWindow: 1,
    rawSamples: series.reduce((total, item) => total + item.points.length, 0),
  };
}

function resolveTrendExtent({
  series,
  hours,
  start,
  end,
}: {
  series: ComparisonSeries[];
  hours: number;
  start?: number | null;
  end?: number | null;
}) {
  const allTimes = series.flatMap((item) => item.points.map((point) => point.time));
  const minTime = allTimes.length ? Math.min(...allTimes) : null;
  const maxTime = allTimes.length ? Math.max(...allTimes) : null;
  const resolvedEnd = end ?? maxTime;
  if (resolvedEnd == null || !Number.isFinite(resolvedEnd)) return null;

  const fallbackStart = resolvedEnd - Math.max(1, hours) * 3_600;
  const resolvedStart = start ?? (minTime == null ? fallbackStart : Math.max(fallbackStart, minTime));
  if (!Number.isFinite(resolvedStart) || resolvedStart >= resolvedEnd) return null;
  return { start: resolvedStart, end: resolvedEnd };
}

export function prepareComparisonTrendData({
  metricKey,
  series,
  hours,
  start,
  end,
}: {
  metricKey: ComparisonMetricKey;
  series: ComparisonSeries[];
  hours: number;
  start?: number | null;
  end?: number | null;
}): ComparisonTrendData {
  const metric = getComparisonMetric(metricKey);
  const rangedSeries = trimComparisonSeriesToRange(series, { start, end });
  const rawSamples = rangedSeries.reduce((total, item) => total + item.points.length, 0);
  if (metric.source !== "ping") {
    return alignExactComparisonSeries(rangedSeries);
  }

  const extent = resolveTrendExtent({ series: rangedSeries, hours, start, end });
  if (!extent) {
    return {
      series: rangedSeries,
      times: [],
      valuesBySeries: rangedSeries.map(() => []),
      bucketSeconds: chooseComparisonBucketSeconds(metric, Math.max(1, hours) * 3_600),
      smoothWindow: 1,
      rawSamples,
    };
  }

  const bucketSeconds = chooseComparisonBucketSeconds(metric, extent.end - extent.start) ?? 60;
  const smoothWindow = chooseComparisonSmoothWindow(metricKey, bucketSeconds);
  const bucketStart = Math.floor(extent.start / bucketSeconds) * bucketSeconds;
  const bucketEnd = Math.ceil(extent.end / bucketSeconds) * bucketSeconds;
  const bucketCount = Math.max(1, Math.floor((bucketEnd - bucketStart) / bucketSeconds) + 1);
  const times = Array.from(
    { length: bucketCount },
    (_, index) => bucketStart + index * bucketSeconds,
  );

  const valuesBySeries = rangedSeries.map((item) => {
    const buckets = new Map<number, number[]>();
    for (const point of item.points) {
      if (point.time < extent.start || point.time > extent.end) continue;
      const index = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((point.time - bucketStart) / bucketSeconds)),
      );
      const bucket = buckets.get(index) ?? [];
      bucket.push(point.value);
      buckets.set(index, bucket);
    }

    const bucketed = times.map((_, index) => {
      const values = buckets.get(index);
      return values ? aggregateTrendBucket(metricKey, values) : undefined;
    });
    return smoothTrendValues(breakLongTrendGaps(bucketed), smoothWindow);
  });

  return {
    series: rangedSeries,
    times,
    valuesBySeries,
    bucketSeconds,
    smoothWindow,
    rawSamples,
  };
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];

  const weight = position - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

export function getComparisonStats(points: ComparisonPoint[]): ComparisonStats {
  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return {
      samples: 0,
      average: null,
      min: null,
      max: null,
      p95: null,
      latest: null,
    };
  }

  const sum = values.reduce((total, value) => total + value, 0);
  const latest = points
    .slice()
    .reverse()
    .find((point) => Number.isFinite(point.value))?.value ?? null;

  return {
    samples: values.length,
    average: sum / values.length,
    min: values[0],
    max: values[values.length - 1],
    p95: percentile(values, 0.95),
    latest,
  };
}

export function buildComparisonRanking(series: ComparisonSeries[]): ComparisonRankingRow[] {
  return series
    .map((item) => ({
      uuid: item.uuid,
      name: item.name,
      group: item.group,
      region: item.region,
      ...getComparisonStats(item.points),
    }))
    .sort((a, b) => {
      const av = a.p95 ?? a.average ?? -Infinity;
      const bv = b.p95 ?? b.average ?? -Infinity;
      return bv - av;
    });
}

export function formatComparisonValue(
  metricKey: ComparisonMetricKey,
  value: number | null | undefined,
) {
  if (value == null || !Number.isFinite(value)) return "--";
  const metric = getComparisonMetric(metricKey);
  if (metric.axisKind === "network") return formatTrafficRateLabel(value);
  if (metric.axisKind === "percent") return `${trimFixed(value, value >= 10 ? 1 : 2)}%`;
  if (metric.axisKind === "count") return `${Math.round(value)}`;
  if (metric.axisKind === "latency") return `${Math.round(value)} ms`;
  if (metric.key === "load") return trimFixed(value, 2);
  return trimFixed(value, 2);
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rawValue(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : trimFixed(value, 4);
}

export function buildComparisonCsv(
  rows: ComparisonRankingRow[],
  metricKey: ComparisonMetricKey,
) {
  const metric = getComparisonMetric(metricKey);
  const headers = [
    "metric",
    "name",
    "uuid",
    "group",
    "region",
    "samples",
    "average",
    "p95",
    "max",
    "latest",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        metric.label,
        row.name,
        row.uuid,
        row.group,
        row.region,
        row.samples,
        rawValue(row.average),
        rawValue(row.p95),
        rawValue(row.max),
        rawValue(row.latest),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}

export function buildComparisonMarkdown(
  rows: ComparisonRankingRow[],
  metricKey: ComparisonMetricKey,
) {
  const metric = getComparisonMetric(metricKey);
  const lines = [
    `## VPS 对比 - ${metric.label}`,
    "",
    "| VPS | 分组 | 地区 | 样本 | 平均 | P95 | 峰值 | 最新 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      [
        row.name,
        row.group || "-",
        row.region || "-",
        row.samples,
        formatComparisonValue(metricKey, row.average),
        formatComparisonValue(metricKey, row.p95),
        formatComparisonValue(metricKey, row.max),
        formatComparisonValue(metricKey, row.latest),
      ].join(" | "),
    ).map((line) => `| ${line} |`),
  ];
  return lines.join("\n");
}

export function nodesToComparisonNodes(nodes: NodeInfo[]): ComparisonNode[] {
  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name,
    group: node.group,
    region: node.region,
  }));
}
