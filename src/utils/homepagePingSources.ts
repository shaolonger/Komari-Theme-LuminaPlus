import type { PingOverviewItem, PingOverviewTaskSummary } from "@/types/komari";
import type { HomepagePingTaskGroups } from "@/utils/homepagePingSettings";

export interface HomepagePingSourceRow {
  taskId: number;
  name: string;
  group: string;
  target: string;
  latencyLabel: string;
  lossLabel: string;
  status: "ok" | "warning" | "critical" | "empty";
}

function sourceStatus(summary: PingOverviewTaskSummary): HomepagePingSourceRow["status"] {
  if (!summary.hasSamples) return "empty";
  if ((summary.loss ?? 0) >= 20 || (summary.lastValue ?? 0) >= 1000) return "critical";
  if ((summary.loss ?? 0) >= 5 || (summary.lastValue ?? 0) >= 300) return "warning";
  return "ok";
}

function latencyLabel(value: number | null) {
  return value != null ? `${Math.round(value)} ms` : "无有效延迟";
}

function lossLabel(value: number | null) {
  return value != null ? `${value.toFixed(1)}%` : "未知";
}

export function buildHomepagePingSourceRows(
  ping: Pick<PingOverviewItem, "taskSummaries">,
  taskGroups: HomepagePingTaskGroups = {},
): HomepagePingSourceRow[] {
  return (ping.taskSummaries ?? []).map((summary) => ({
    taskId: summary.taskId,
    name: summary.name,
    group: taskGroups[String(summary.taskId)] ?? "",
    target: summary.target,
    latencyLabel: latencyLabel(summary.lastValue),
    lossLabel: lossLabel(summary.loss),
    status: sourceStatus(summary),
  }));
}

export function buildHomepagePingCompareUrl(uuid: string, taskIds: number[]) {
  const params = new URLSearchParams({
    nodes: uuid,
    metric: "ping_latency",
    hours: "4",
    tab: "trend",
  });
  const normalizedTaskIds = Array.from(new Set(taskIds))
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
    .sort((left, right) => left - right);
  if (normalizedTaskIds.length > 0) {
    params.set("pingTasks", normalizedTaskIds.join(","));
  }
  return `/compare?${params.toString()}`;
}
