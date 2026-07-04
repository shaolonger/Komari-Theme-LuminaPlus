import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo, PingOverviewItem } from "@/types/komari";
import type { ComparisonLoadRecords } from "@/services/api";
import { getConfigCompleteness } from "@/utils/vpsWorkbench";
import { getVpsOperationalRisks, strongestRiskSeverity } from "@/utils/vpsRisk";

export type Fleet3DStatus = "online" | "offline" | "unknown";
export type Fleet3DFilter = "all" | Fleet3DStatus;
export type Fleet3DFocusKind = "all" | "group" | "region";
export type Fleet3DCameraPreset = "overview" | "close" | "wide";
export type Fleet3DQuality = "high" | "balanced" | "eco";
export type Fleet3DPingTone = "none" | "good" | "warning" | "critical";
export type Fleet3DRiskTone = "none" | "warning" | "critical";
export type Fleet3DRendererMode = "webgpu" | "webgl2" | "webgl1" | "unavailable";

export interface Fleet3DPingSignal {
  assigned: boolean;
  latency: number | null;
  loss: number | null;
  tone: Fleet3DPingTone;
  radius: number;
  fragmentation: number;
  pulse: number;
}

export interface Fleet3DRiskSignal {
  tone: Fleet3DRiskTone;
  score: number;
  issues: string[];
  completenessRatio: number;
}

export interface Fleet3DReplaySignal {
  active: boolean;
  timestamp: number;
  pressure: number;
  cpuPct: number;
  ramPct: number;
  diskPct: number;
  netRate: number;
}

export interface Fleet3DNode {
  uuid: string;
  name: string;
  group: string;
  region: string;
  status: Fleet3DStatus;
  color: string;
  glowColor: string;
  scale: number;
  orbitIndex: number;
  orbitRadius: number;
  position: [number, number, number];
  netUp: number;
  netDown: number;
  netRate: number;
  trafficTotal: number;
  updatedAt: number;
  ping: Fleet3DPingSignal;
  risk: Fleet3DRiskSignal;
  replay?: Fleet3DReplaySignal;
}

export interface Fleet3DOrbit {
  group: string;
  index: number;
  radius: number;
  y: number;
}

export interface Fleet3DModel {
  nodes: Fleet3DNode[];
  orbits: Fleet3DOrbit[];
  online: number;
  offline: number;
  unknown: number;
  riskCritical: number;
  riskWarning: number;
}

export interface Fleet3DReplayState {
  nodes: Fleet3DNode[];
  timestamp: number;
  sampleCount: number;
}

export interface Fleet3DFocusState {
  kind: Fleet3DFocusKind;
  value: string;
  label: string;
  uuids: string[];
  center: [number, number, number] | null;
}

export interface Fleet3DCruiseTarget {
  id: string;
  label: string;
  detail: string;
  uuids: string[];
  center: [number, number, number] | null;
  cameraPreset: Fleet3DCameraPreset;
  riskScan: boolean;
  attentionUuid: string | null;
}

export interface Fleet3DRendererCapability {
  mode: Fleet3DRendererMode;
  label: string;
  detail: string;
  webgpu: boolean;
  webgl2: boolean;
  webgl1: boolean;
}

const STATUS_COLORS: Record<Fleet3DStatus, { color: string; glowColor: string }> = {
  online: { color: "#50d890", glowColor: "#8fffc1" },
  offline: { color: "#ff5d73", glowColor: "#ff9aaa" },
  unknown: { color: "#93a4bd", glowColor: "#d7e2f5" },
};
const STATUS_LABELS_FALLBACK: Record<Fleet3DStatus, string> = {
  online: "在线",
  offline: "离线",
  unknown: "未知",
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeGroup(value: string | null | undefined) {
  const group = String(value || "").trim();
  return group || "未分组";
}

function normalizeRegion(value: string | null | undefined) {
  const region = String(value || "").trim();
  return region || "未知地区";
}

function resolveStatus(summary: HomeNodeSummary | undefined): Fleet3DStatus {
  if (!summary || summary.online == null) return "unknown";
  return summary.online ? "online" : "offline";
}

function buildSummaryMap(summaries: HomeNodeSummary[]) {
  return new Map(summaries.map((summary) => [summary.uuid, summary]));
}

function trafficScale(summary: HomeNodeSummary | undefined) {
  if (!summary) return 1;
  const rate = Math.max(0, summary.netUp + summary.netDown);
  return 1 + clamp(Math.log10(rate + 1) / 6, 0, 1) * 1.2;
}

function pingSignal(ping: PingOverviewItem | undefined): Fleet3DPingSignal {
  if (!ping || !ping.isAssigned) {
    return {
      assigned: false,
      latency: null,
      loss: null,
      tone: "none",
      radius: 0,
      fragmentation: 0,
      pulse: 0,
    };
  }

  const latency = ping.lastValue != null && ping.lastValue > 0 ? ping.lastValue : null;
  const loss = ping.loss != null && Number.isFinite(ping.loss) ? Math.max(0, ping.loss) : null;
  const hasSamples = ping.values.length > 0;
  const tone: Fleet3DPingTone =
    (loss != null && loss >= 20) || (latency != null && latency >= 1000)
      ? "critical"
      : (loss != null && loss >= 5) || (latency != null && latency >= 300)
        ? "warning"
        : hasSamples
          ? "good"
          : "none";
  const latencyPressure = latency == null ? 0 : clamp(latency / 1000, 0, 1);
  const lossPressure = loss == null ? 0 : clamp(loss / 25, 0, 1);

  return {
    assigned: true,
    latency,
    loss,
    tone,
    radius: tone === "none" ? 0 : 0.28 + latencyPressure * 0.36 + lossPressure * 0.2,
    fragmentation: loss == null ? 0 : clamp(loss / 35, 0, 1),
    pulse: tone === "critical" ? 0.9 : tone === "warning" ? 0.55 : tone === "good" ? 0.16 : 0,
  };
}

function riskSignal(
  node: NodeInfo,
  summary: HomeNodeSummary | undefined,
  ping: PingOverviewItem | undefined,
): Fleet3DRiskSignal {
  const hasPingBinding = Boolean(ping?.isAssigned);
  const risks = getVpsOperationalRisks({
    uuid: node.uuid,
    online: summary?.online ?? null,
    updatedAt: summary?.updatedAt ?? 0,
    trafficUp: summary?.trafficUp ?? 0,
    trafficDown: summary?.trafficDown ?? 0,
    trafficLimit: node.traffic_limit,
    trafficLimitType: node.traffic_limit_type,
    expiredAt: node.expired_at,
    capabilityPing: node.capability_ping,
    hasPingBinding,
  });
  const completeness = getConfigCompleteness(node, hasPingBinding);
  const issues = risks.map((risk) => risk.title);
  if (completeness.ratio < 1) {
    const missing = completeness.missing.slice(0, 2).map((item) => item.label).join("、");
    issues.push(missing ? `资料待补：${missing}` : "资料待补");
  }

  const riskTone =
    risks.length > 0
      ? strongestRiskSeverity(risks)
      : completeness.ratio < 1
        ? "warning"
        : "none";
  const criticalWeight = risks.filter((risk) => risk.severity === "critical").length * 0.42;
  const warningWeight = risks.filter((risk) => risk.severity === "warning").length * 0.24;
  const completenessWeight = (1 - completeness.ratio) * 0.34;

  return {
    tone: riskTone,
    score: riskTone === "none" ? 0 : clamp(0.28 + criticalWeight + warningWeight + completenessWeight, 0, 1),
    issues: Array.from(new Set(issues)).slice(0, 4),
    completenessRatio: completeness.ratio,
  };
}

function sortNodes(nodes: NodeInfo[]) {
  return [...nodes].sort((a, b) => {
    const groupCompare = normalizeGroup(a.group).localeCompare(normalizeGroup(b.group));
    if (groupCompare !== 0) return groupCompare;
    const weightCompare = (b.weight ?? 0) - (a.weight ?? 0);
    if (weightCompare !== 0) return weightCompare;
    return (a.name || a.uuid).localeCompare(b.name || b.uuid);
  });
}

function toRecordTimestamp(value: string | number) {
  if (typeof value === "number") return value > 1_000_000_000_000 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function percent(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return clamp((part / total) * 100, 0, 100);
}

function replayTone(pressure: number) {
  if (pressure >= 0.82) return { color: "#ff6678", glowColor: "#ff9aaa" };
  if (pressure >= 0.6) return { color: "#ffc857", glowColor: "#ffe0a3" };
  return { color: "#50d890", glowColor: "#8fffc1" };
}

function riskWeight(node: Fleet3DNode) {
  if (node.risk.tone === "critical") return 2 + node.risk.score;
  if (node.risk.tone === "warning") return 1 + node.risk.score;
  return node.status === "offline" ? 0.7 : 0;
}

function centerOfNodes(nodes: Fleet3DNode[]): [number, number, number] | null {
  if (nodes.length === 0) return null;
  const center = nodes.reduce(
    (acc, node) => {
      acc[0] += node.position[0];
      acc[1] += node.position[1];
      acc[2] += node.position[2];
      return acc;
    },
    [0, 0, 0] as [number, number, number],
  );
  center[0] /= nodes.length;
  center[1] /= nodes.length;
  center[2] /= nodes.length;
  return center;
}

function groupByValue(nodes: Fleet3DNode[], key: "group" | "region") {
  const grouped = new Map<string, Fleet3DNode[]>();
  for (const node of nodes) {
    const value = key === "group" ? node.group : node.region;
    grouped.set(value, [...(grouped.get(value) ?? []), node]);
  }
  return grouped;
}

export function buildCompareHref(uuids: string[]) {
  const selected = Array.from(new Set(uuids.filter(Boolean))).slice(0, 8);
  if (selected.length < 2) return "/compare";
  return `/compare?${new URLSearchParams({ nodes: selected.join(",") }).toString()}`;
}

export function detectFleet3DRendererCapability(): Fleet3DRendererCapability {
  if (typeof document === "undefined") {
    return {
      mode: "unavailable",
      label: "等待检测",
      detail: "浏览器环境加载后检测 3D 渲染能力",
      webgpu: false,
      webgl2: false,
      webgl1: false,
    };
  }

  const navigatorWithGpu = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { gpu?: unknown });
  const webgpu = Boolean(navigatorWithGpu?.gpu);
  const canvas = document.createElement("canvas");
  let webgl2 = false;
  let webgl1 = false;

  try {
    webgl2 = Boolean(canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }));
    webgl1 = webgl2
      ? true
      : Boolean(
          canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
            canvas.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false }),
        );
  } catch {
    webgl2 = false;
    webgl1 = false;
  }

  if (webgpu) {
    return {
      mode: "webgpu",
      label: "WebGPU 可用",
      detail: webgl2 ? "当前以 WebGL2 稳定回退渲染，可安全接入 WebGPU 管线" : "浏览器暴露 WebGPU，WebGL 回退能力有限",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  if (webgl2) {
    return {
      mode: "webgl2",
      label: "WebGL2 回退",
      detail: "当前设备使用 WebGL2 稳定渲染 3D 星图",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  if (webgl1) {
    return {
      mode: "webgl1",
      label: "WebGL 回退",
      detail: "当前设备可运行基础 3D 渲染，建议使用省电画质",
      webgpu,
      webgl2,
      webgl1,
    };
  }

  return {
    mode: "unavailable",
    label: "渲染不可用",
    detail: "当前浏览器未提供可用的 3D 图形上下文",
    webgpu,
    webgl2,
    webgl1,
  };
}

export function buildFleet3DModel(
  nodes: NodeInfo[],
  summaries: HomeNodeSummary[],
  pingByUuid: Map<string, PingOverviewItem> = new Map(),
): Fleet3DModel {
  const summaryByUuid = buildSummaryMap(summaries);
  const visibleNodes = sortNodes(nodes.filter((node) => !node.hidden));
  const groups = Array.from(new Set(visibleNodes.map((node) => normalizeGroup(node.group))));
  const groupIndex = new Map(groups.map((group, index) => [group, index]));
  const groupCounts = new Map<string, number>();
  const groupSeen = new Map<string, number>();
  for (const node of visibleNodes) {
    const group = normalizeGroup(node.group);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }

  const orbits: Fleet3DOrbit[] = groups.map((group, index) => ({
    group,
    index,
    radius: 4.2 + index * 1.45,
    y: (index - (groups.length - 1) / 2) * 0.42,
  }));

  let online = 0;
  let offline = 0;
  let unknown = 0;
  let riskCritical = 0;
  let riskWarning = 0;
  const fleetNodes = visibleNodes.map((node) => {
    const group = normalizeGroup(node.group);
    const orbitIndex = groupIndex.get(group) ?? 0;
    const orbit = orbits[orbitIndex] ?? { radius: 4.2, y: 0, index: 0, group };
    const count = groupCounts.get(group) ?? 1;
    const seen = groupSeen.get(group) ?? 0;
    groupSeen.set(group, seen + 1);

    const seed = hashString(node.uuid);
    const jitter = ((seed % 1000) / 1000 - 0.5) * 0.32;
    const angle = ((seen + 0.5) / count) * Math.PI * 2 + jitter;
    const radius = orbit.radius + (((seed >>> 8) % 1000) / 1000 - 0.5) * 0.62;
    const summary = summaryByUuid.get(node.uuid);
    const ping = pingByUuid.get(node.uuid);
    const status = resolveStatus(summary);
    if (status === "online") online += 1;
    else if (status === "offline") offline += 1;
    else unknown += 1;

    const tone = STATUS_COLORS[status];
    const netUp = Math.max(0, summary?.netUp ?? 0);
    const netDown = Math.max(0, summary?.netDown ?? 0);
    const netRate = netUp + netDown;
    const trafficTotal = Math.max(0, (summary?.trafficUp ?? 0) + (summary?.trafficDown ?? 0));
    const risk = riskSignal(node, summary, ping);
    if (risk.tone === "critical") riskCritical += 1;
    else if (risk.tone === "warning") riskWarning += 1;

    return {
      uuid: node.uuid,
      name: node.name || node.uuid,
      group,
      region: normalizeRegion(node.region),
      status,
      color: tone.color,
      glowColor: tone.glowColor,
      scale: trafficScale(summary),
      orbitIndex,
      orbitRadius: orbit.radius,
      position: [
        Math.cos(angle) * radius,
        orbit.y + (((seed >>> 16) % 1000) / 1000 - 0.5) * 0.7,
        Math.sin(angle) * radius,
      ],
      netUp,
      netDown,
      netRate,
      trafficTotal,
      updatedAt: summary?.updatedAt ?? 0,
      ping: pingSignal(ping),
      risk,
    } satisfies Fleet3DNode;
  });

  return {
    nodes: fleetNodes,
    orbits,
    online,
    offline,
    unknown,
    riskCritical,
    riskWarning,
  };
}

export function filterFleet3DNodes(nodes: Fleet3DNode[], filter: Fleet3DFilter) {
  if (filter === "all") return nodes;
  return nodes.filter((node) => node.status === filter);
}

export function buildFleet3DCruiseTargets(nodes: Fleet3DNode[]): Fleet3DCruiseTarget[] {
  if (nodes.length === 0) return [];

  const sortedRiskNodes = [...nodes]
    .filter((node) => node.risk.tone !== "none" || node.status === "offline")
    .sort((left, right) => riskWeight(right) - riskWeight(left) || left.name.localeCompare(right.name, "zh-CN"));
  const riskTargets = sortedRiskNodes.slice(0, 4).map((node) => ({
    id: `attention:${node.uuid}`,
    label: node.name,
    detail: node.risk.issues[0] ?? STATUS_LABELS_FALLBACK[node.status],
    uuids: [node.uuid],
    center: centerOfNodes([node]),
    cameraPreset: "close" as const,
    riskScan: true,
    attentionUuid: node.uuid,
  }));

  const groupTargets = Array.from(groupByValue(nodes, "group").entries())
    .map(([group, groupNodes]) => {
      const topRiskNode = [...groupNodes].sort((left, right) => riskWeight(right) - riskWeight(left))[0] ?? null;
      return {
        id: `group:${group}`,
        label: group,
        detail: `${groupNodes.length} 台 VPS`,
        uuids: groupNodes.map((node) => node.uuid),
        center: centerOfNodes(groupNodes),
        cameraPreset: groupNodes.length > 4 ? ("overview" as const) : ("close" as const),
        riskScan: groupNodes.some((node) => node.risk.tone !== "none"),
        attentionUuid: topRiskNode && riskWeight(topRiskNode) > 0 ? topRiskNode.uuid : null,
      };
    })
    .sort((left, right) => right.uuids.length - left.uuids.length || left.label.localeCompare(right.label, "zh-CN"));

  const regionTargets = Array.from(groupByValue(nodes, "region").entries())
    .filter(([, regionNodes]) => regionNodes.length > 1)
    .map(([region, regionNodes]) => ({
      id: `region:${region}`,
      label: region,
      detail: `${regionNodes.length} 台 VPS`,
      uuids: regionNodes.map((node) => node.uuid),
      center: centerOfNodes(regionNodes),
      cameraPreset: "overview" as const,
      riskScan: regionNodes.some((node) => node.risk.tone !== "none"),
      attentionUuid: null,
    }))
    .sort((left, right) => right.uuids.length - left.uuids.length || left.label.localeCompare(right.label, "zh-CN"))
    .slice(0, 3);

  return [
    ...riskTargets,
    ...groupTargets,
    ...regionTargets,
    {
      id: "fleet:all",
      label: "全局态势",
      detail: `${nodes.length} 台 VPS`,
      uuids: nodes.map((node) => node.uuid),
      center: null,
      cameraPreset: "wide",
      riskScan: sortedRiskNodes.length > 0,
      attentionUuid: sortedRiskNodes[0]?.uuid ?? null,
    },
  ];
}

export function buildFleet3DReplayState(
  nodes: Fleet3DNode[],
  recordsByUuid: ComparisonLoadRecords,
  progress: number,
): Fleet3DReplayState {
  const safeProgress = clamp(progress, 0, 1);
  let timestamp = 0;
  let sampleCount = 0;
  const replayNodes = nodes.map((node) => {
    const records = recordsByUuid[node.uuid] ?? [];
    if (records.length === 0) return node;
    sampleCount += records.length;
    const sorted = [...records].sort(
      (left, right) => toRecordTimestamp(left.time) - toRecordTimestamp(right.time),
    );
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(safeProgress * (sorted.length - 1))));
    const record = sorted[index];
    const recordTimestamp = toRecordTimestamp(record.time);
    if (recordTimestamp > timestamp) timestamp = recordTimestamp;

    const cpuPct = clamp(record.cpu, 0, 100);
    const ramPct = percent(record.ram, record.ram_total);
    const diskPct = percent(record.disk, record.disk_total);
    const netUp = Math.max(0, record.net_out);
    const netDown = Math.max(0, record.net_in);
    const netRate = netUp + netDown;
    const networkPressure = clamp(Math.log10(netRate + 1) / 7, 0, 1);
    const resourcePressure = Math.max(cpuPct, ramPct, diskPct) / 100;
    const pressure = clamp(resourcePressure * 0.68 + networkPressure * 0.32, 0, 1);
    const tone = replayTone(pressure);

    return {
      ...node,
      color: tone.color,
      glowColor: tone.glowColor,
      scale: node.scale * (0.86 + pressure * 0.78),
      netUp,
      netDown,
      netRate,
      replay: {
        active: true,
        timestamp: recordTimestamp,
        pressure,
        cpuPct,
        ramPct,
        diskPct,
        netRate,
      },
    } satisfies Fleet3DNode;
  });

  return {
    nodes: replayNodes,
    timestamp,
    sampleCount,
  };
}

export function getFleet3DFocusOptions(nodes: Fleet3DNode[], kind: Exclude<Fleet3DFocusKind, "all">) {
  return Array.from(new Set(nodes.map((node) => (kind === "group" ? node.group : node.region))))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function resolveFleet3DFocus(
  nodes: Fleet3DNode[],
  kind: Fleet3DFocusKind,
  value: string,
): Fleet3DFocusState {
  if (kind === "all" || !value) {
    return {
      kind: "all",
      value: "",
      label: "全部",
      uuids: nodes.map((node) => node.uuid),
      center: null,
    };
  }

  const focused = nodes.filter((node) => (kind === "group" ? node.group : node.region) === value);
  if (focused.length === 0) {
    return {
      kind: "all",
      value: "",
      label: "全部",
      uuids: nodes.map((node) => node.uuid),
      center: null,
    };
  }

  const center = focused.reduce(
    (acc, node) => {
      acc[0] += node.position[0];
      acc[1] += node.position[1];
      acc[2] += node.position[2];
      return acc;
    },
    [0, 0, 0] as [number, number, number],
  );
  center[0] /= focused.length;
  center[1] /= focused.length;
  center[2] /= focused.length;

  return {
    kind,
    value,
    label: value,
    uuids: focused.map((node) => node.uuid),
    center,
  };
}
