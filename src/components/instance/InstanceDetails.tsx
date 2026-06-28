import { useEffect, useMemo, useRef } from "react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { useHomepagePingOverview, usePingMini } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatBytes, formatExpireDays, formatUptimeDays, trimFixed } from "@/utils/format";
import { formatRenewalPrice } from "@/utils/billing";
import { invertHomepagePingTaskBindings } from "@/utils/pingTasks";
import { resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";
import {
  buildVpsWorkbenchNode,
  type VpsWorkbenchNode,
} from "@/utils/vpsWorkbench";
import { InstancePanel } from "./InstancePanel";

// Intl.DateTimeFormat 构造开销大，复用一个实例，别每次 metrics 更新都重建
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatCapability(value: boolean | null, enabled = "已启用", disabled = "未启用") {
  if (value === true) return enabled;
  if (value === false) return disabled;
  return "未知";
}

function formatIpAddress(value: string) {
  const trimmed = value.trim();
  return trimmed || "—";
}

function formatExpirePressure(node: VpsWorkbenchNode) {
  if (node.expireDays == null) return "到期未知";
  if (node.expireDays < 0) return "已过期";
  if (node.expireDays === 0) return "今日到期";
  return `${node.expireDays} 天后到期`;
}

function formatExhaustIn(seconds: number | null) {
  if (seconds == null) return "当前无明显消耗";
  if (seconds <= 0) return "已耗尽";
  const days = seconds / 86400;
  if (days >= 1) return `约 ${trimFixed(days, days >= 10 ? 0 : 1)} 天耗尽`;
  const hours = seconds / 3600;
  if (hours >= 1) return `约 ${trimFixed(hours, 1)} 小时耗尽`;
  return "不足 1 小时耗尽";
}

function decisionToneFromPing(state: VpsWorkbenchNode["ping"]["state"]) {
  if (state === "critical" || state === "disabled") return "critical";
  if (state === "ok") return "ok";
  return "warning";
}

function decisionToneFromExpiry(bucket: VpsWorkbenchNode["expiryBucket"]) {
  if (bucket === "expired") return "critical";
  if (bucket === "soon" || bucket === "month" || bucket === "unknown") {
    return "warning";
  }
  return "ok";
}

function decisionToneFromTraffic(status: VpsWorkbenchNode["traffic"]["status"]) {
  if (status === "exhausted" || status === "critical") return "critical";
  if (status === "warning") return "warning";
  return "ok";
}

function DecisionSummaryItem({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warning" | "critical";
}) {
  return (
    <div className="instance-decision-item" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const themeSettings = useThemeSettings();
  useHomepagePingOverview();
  const ping = usePingMini(uuid);
  const hasAlignedOnReadyRef = useRef(false);
  const selectedPingTaskByClient = useMemo(
    () =>
      themeSettings.isReady
        ? invertHomepagePingTaskBindings(themeSettings.homepagePingBindings)
        : new Map<string, number>(),
    [themeSettings.homepagePingBindings, themeSettings.isReady],
  );

  useEffect(() => {
    hasAlignedOnReadyRef.current = false;
  }, [uuid]);

  useEffect(() => {
    if (!meta || !metrics || hasAlignedOnReadyRef.current) return;
    hasAlignedOnReadyRef.current = true;
    // 触发一次性对齐，但不接收它返回的 cleanup：调用方 (alignCharts) 返回的是给它自己
    // effect 用的 rAF-cancel，这里若接收，后续 meta/metrics 变化会跑这个 cleanup，
    // 在 scroll-into-view 触发前就把它取消掉。
    onNodeReady?.();
  }, [meta, metrics, onNodeReady]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
  const uptime = formatUptimeDays(metrics.uptime);
  // 按 traffic_limit_type (max/sum/up/down/min) 归并上下行，和卡片、后端保持一致——
  // 对非 "sum" 节点直接把上下行相加是错的。
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    metrics.trafficUp,
    metrics.trafficDown,
    meta.traffic_limit,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? TIME_FORMATTER.format(metrics.updatedAt) : "—";
  const trimmedName = meta.name?.trim();
  const panelTitle = trimmedName ? `${trimmedName} 信息` : "实例信息";
  const expire = formatExpireDays(meta.expired_at);
  const expireLabel = expire.unit ? `${expire.value}${expire.unit}` : expire.value;
  const renewalPrice = formatRenewalPrice(meta) ?? "未填写";
  const trafficLimitLabel =
    meta.traffic_limit > 0 ? formatBytes(meta.traffic_limit) : "不限";
  const workbenchNode = buildVpsWorkbenchNode({
    meta,
    online: metrics.online,
    updatedAt: metrics.updatedAt,
    trafficUp: metrics.trafficUp,
    trafficDown: metrics.trafficDown,
    netUp: metrics.netUp,
    netDown: metrics.netDown,
    hasPingBinding: selectedPingTaskByClient.has(uuid),
    ping,
  });
  const completenessDetail =
    workbenchNode.completeness.missing.length > 0
      ? `缺少 ${workbenchNode.completeness.missing
          .map((item) => item.label)
          .slice(0, 4)
          .join("、")}`
      : "关键资料完整";
  const trafficDecisionValue =
    workbenchNode.traffic.status === "unlimited"
      ? "不限"
      : workbenchNode.traffic.status === "exhausted"
        ? "已耗尽"
        : `${Math.round(workbenchNode.traffic.fraction * 100)}%`;
  const trafficDecisionDetail =
    workbenchNode.traffic.status === "unlimited"
      ? "未设置流量上限"
      : `剩余 ${formatBytes(Math.max(0, workbenchNode.traffic.remaining))} · ${formatExhaustIn(
          workbenchNode.traffic.exhaustInSeconds,
        )}`;

  return (
    <InstancePanel
      title={panelTitle}
      description={
        isOnline ? undefined : "节点当前离线，以下展示最近一次上报的缓存数据。"
      }
    >
      <div className="instance-decision-grid">
        <DecisionSummaryItem
          label="资料完整度"
          value={`${workbenchNode.completeness.complete}/${workbenchNode.completeness.total}`}
          detail={completenessDetail}
          tone={workbenchNode.completeness.ratio < 1 ? "warning" : "ok"}
        />
        <DecisionSummaryItem
          label="续费压力"
          value={formatExpirePressure(workbenchNode)}
          detail={`续费 ${renewalPrice}`}
          tone={decisionToneFromExpiry(workbenchNode.expiryBucket)}
        />
        <DecisionSummaryItem
          label="流量预估"
          value={trafficDecisionValue}
          detail={trafficDecisionDetail}
          tone={decisionToneFromTraffic(workbenchNode.traffic.status)}
        />
        <DecisionSummaryItem
          label="Ping 状态"
          value={workbenchNode.ping.label}
          detail={workbenchNode.ping.detail}
          tone={decisionToneFromPing(workbenchNode.ping.state)}
        />
      </div>
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">系统</div>
          <InfoRow label="状态" value={isOnline ? "在线" : "离线"} />
          <InfoRow
            label="CPU"
            value={`${meta.cpu_name || "—"}${meta.cpu_cores > 0 ? ` (x${meta.cpu_cores})` : ""}`}
          />
          <InfoRow label="架构" value={meta.arch || "—"} />
          <InfoRow label="虚拟化" value={meta.virtualization || "—"} />
          <InfoRow label="操作系统" value={meta.os || "—"} />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">资源</div>
          <InfoRow label="内存" value={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`} />
          <InfoRow
            label="Swap"
            value={
              metrics.swapTotal > 0
                ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                : "无"
            }
          />
          <InfoRow label="磁盘" value={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`} />
          <InfoRow
            label="负载"
            value={`${metrics.load1.toFixed(2)} | ${metrics.load5.toFixed(2)} | ${metrics.load15.toFixed(2)}`}
          />
          <InfoRow
            label="运行时长"
            value={uptime.unit ? `${uptime.value} ${uptime.unit}` : uptime.value}
          />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">网络</div>
          <InfoRow
            label={isOnline ? "实时网络" : "缓存网络"}
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOnline ? "最近更新" : "最后上报"} value={lastUpdated} />
          <div className="instance-info-item is-stack">
            <span className="instance-info-label">总流量</span>
            <div className="instance-info-traffic">
              <span className="instance-info-value">{`↑ ${formatBytes(metrics.trafficUp)} · ↓ ${formatBytes(metrics.trafficDown)}`}</span>
              {meta.traffic_limit > 0 && (
                <>
                  <div className="instance-progress-track" aria-hidden>
                    <span
                      className="instance-progress-fill"
                      style={{ width: `${trafficUsage.fraction * 100}%` }}
                    />
                  </div>
                  <span className="instance-info-note">
                    {`${formatBytes(trafficUsage.used)} / ${formatBytes(meta.traffic_limit)}`}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">Agent</div>
          <InfoRow label="版本" value={meta.version || "未知"} />
          <InfoRow label="内核" value={meta.kernel_version || "—"} />
          <InfoRow label="IPv4" value={formatIpAddress(meta.ipv4)} />
          <InfoRow label="IPv6" value={formatIpAddress(meta.ipv6)} />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">管理</div>
          <InfoRow label="Ping 能力" value={formatCapability(meta.capability_ping)} />
          <InfoRow
            label="私有目标 Ping"
            value={formatCapability(
              meta.capability_private_ping_targets,
              "允许",
              "默认限制",
            )}
          />
          <InfoRow label="续费" value={renewalPrice} />
          <InfoRow label="到期" value={expireLabel} />
          <InfoRow label="流量规则" value={trafficTypeLabel(meta.traffic_limit_type)} />
          <InfoRow label="流量额度" value={trafficLimitLabel} />
        </div>
      </div>
    </InstancePanel>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
