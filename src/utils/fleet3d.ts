import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo } from "@/types/komari";

export type Fleet3DStatus = "online" | "offline" | "unknown";
export type Fleet3DFilter = "all" | Fleet3DStatus;

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
  netRate: number;
  trafficTotal: number;
  updatedAt: number;
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
}

const STATUS_COLORS: Record<Fleet3DStatus, { color: string; glowColor: string }> = {
  online: { color: "#50d890", glowColor: "#8fffc1" },
  offline: { color: "#ff5d73", glowColor: "#ff9aaa" },
  unknown: { color: "#93a4bd", glowColor: "#d7e2f5" },
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

function sortNodes(nodes: NodeInfo[]) {
  return [...nodes].sort((a, b) => {
    const groupCompare = normalizeGroup(a.group).localeCompare(normalizeGroup(b.group));
    if (groupCompare !== 0) return groupCompare;
    const weightCompare = (b.weight ?? 0) - (a.weight ?? 0);
    if (weightCompare !== 0) return weightCompare;
    return (a.name || a.uuid).localeCompare(b.name || b.uuid);
  });
}

export function buildCompareHref(uuids: string[]) {
  const selected = Array.from(new Set(uuids.filter(Boolean))).slice(0, 8);
  if (selected.length < 2) return "/compare";
  return `/compare?${new URLSearchParams({ nodes: selected.join(",") }).toString()}`;
}

export function buildFleet3DModel(
  nodes: NodeInfo[],
  summaries: HomeNodeSummary[],
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
    const status = resolveStatus(summary);
    if (status === "online") online += 1;
    else if (status === "offline") offline += 1;
    else unknown += 1;

    const tone = STATUS_COLORS[status];
    const netRate = Math.max(0, (summary?.netUp ?? 0) + (summary?.netDown ?? 0));
    const trafficTotal = Math.max(0, (summary?.trafficUp ?? 0) + (summary?.trafficDown ?? 0));

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
      netRate,
      trafficTotal,
      updatedAt: summary?.updatedAt ?? 0,
    } satisfies Fleet3DNode;
  });

  return {
    nodes: fleetNodes,
    orbits,
    online,
    offline,
    unknown,
  };
}

export function filterFleet3DNodes(nodes: Fleet3DNode[], filter: Fleet3DFilter) {
  if (filter === "all") return nodes;
  return nodes.filter((node) => node.status === filter);
}
