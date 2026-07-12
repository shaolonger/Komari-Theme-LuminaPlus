import { memo, type CSSProperties, type FocusEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock3, Database, Unplug } from "lucide-react";
import { clsx } from "clsx";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { formatLoadValue, formatMetricPercent } from "@/utils/format";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import {
  VPS_LIST_SORT_LABELS,
  type VpsListSortCondition,
  type VpsListSortKey,
} from "@/utils/vpsListSort";

const DIRECT_SORT_GROUPS: Array<Array<{ key: VpsListSortKey; label: string }>> = [
  [{ key: "status", label: "状态" }, { key: "name", label: "名称" }],
  [{ key: "cpu", label: "CPU" }, { key: "memory", label: "内存" }, { key: "disk", label: "磁盘" }, { key: "load", label: "负载" }],
  [{ key: "upload", label: "上传" }, { key: "download", label: "下载" }],
  [{ key: "trafficUsage", label: "流量" }],
  [{ key: "latency", label: "延迟" }, { key: "loss", label: "丢包" }],
  [{ key: "uptime", label: "在线" }, { key: "expiry", label: "到期" }, { key: "price", label: "费用" }],
];

function SortHeaderButton({
  sortKey,
  label,
  sorts,
  onSort,
}: {
  sortKey: VpsListSortKey;
  label: string;
  sorts: VpsListSortCondition[];
  onSort: (key: VpsListSortKey, additive: boolean) => void;
}) {
  const index = sorts.findIndex((condition) => condition.key === sortKey);
  const condition = index >= 0 ? sorts[index] : null;
  const directionLabel = condition?.direction === "asc" ? "升序" : condition ? "降序" : "未排序";
  return (
    <button
      type="button"
      className="node-list-sort-head-button"
      data-active={condition ? "true" : "false"}
      aria-label={`${VPS_LIST_SORT_LABELS[sortKey]}，${directionLabel}${condition ? `，优先级 ${index + 1}` : ""}`}
      title={`按${VPS_LIST_SORT_LABELS[sortKey]}排序；Shift 点击追加多级排序`}
      onClick={(event) => onSort(sortKey, event.shiftKey)}
    >
      <span>{label}</span>
      {condition?.direction === "asc" ? <ChevronUp size={11} /> : condition?.direction === "desc" ? <ChevronDown size={11} /> : null}
      {condition && sorts.length > 1 && <sup>{index + 1}</sup>}
    </button>
  );
}

function SortHeaderGroup({
  children,
  sorts,
  onSort,
}: {
  children: Array<{ key: VpsListSortKey; label: string }>;
  sorts: VpsListSortCondition[];
  onSort: (key: VpsListSortKey, additive: boolean) => void;
}) {
  return (
    <span className="node-list-sort-head-group" role="columnheader">
      {children.map((item) => <SortHeaderButton key={item.key} sortKey={item.key} label={item.label} sorts={sorts} onSort={onSort} />)}
    </span>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function ResourceMetric({
  label,
  value,
  fraction,
  color,
}: {
  label: string;
  value: string;
  fraction: number;
  color: string;
}) {
  return (
    <span
      className="node-list-resource"
      style={{
        "--node-list-meter": `${clampPercent(fraction * 100)}%`,
        "--node-list-meter-color": color,
      } as CSSProperties}
      title={`${label} ${value}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <i aria-hidden />
    </span>
  );
}

function NodeListRow({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);

  if (!model.node) {
    return <div className="node-list-row is-loading" role="row" aria-busy />;
  }

  const {
    node,
    traffic,
    ping,
    upRate,
    downRate,
    uptime,
    expire,
    expireColor,
    renewalPrice,
    loadFraction,
    isOffline,
    latencyColor,
    lossColor,
  } = model;
  const metadata = [node.region, node.group, node.provider]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  const uptimeLabel = uptime.value === "—" ? "—" : `${uptime.value}${uptime.unit}`;
  const expireLabel = expire.value === "—" ? "未设置" : `${expire.value}${expire.unit}`;
  const trafficTitle = `流量 ${traffic.typeLabel} · ${traffic.detail} · 剩余 ${traffic.remainingLabel}`;

  return (
    <div className={clsx("node-list-row", isOffline && "is-offline")} role="row">
      <div className="node-list-cell node-list-node" role="cell">
        <span className="node-list-status" data-online={node.online === true ? "true" : node.online === false ? "false" : "pending"} title={node.online === true ? "在线" : node.online === false ? "离线" : "等待上报"} />
        <Flag region={node.region} size={15} />
        <span className="node-list-identity">
          <Link to={`/instance/${node.uuid}`} title={node.name}>{node.name}</Link>
          <small title={metadata || node.uuid}>{metadata || node.uuid}</small>
        </span>
        <OsLogo value={node.os} size={16} />
      </div>

      <div className="node-list-cell node-list-resources" role="cell" aria-label="资源状态">
        <ResourceMetric label="CPU" value={formatMetricPercent(node.cpuPct)} fraction={node.cpuPct / 100} color="var(--progress-cpu)" />
        <ResourceMetric label="内存" value={formatMetricPercent(node.ramPct)} fraction={node.ramPct / 100} color="var(--progress-memory)" />
        <ResourceMetric label="磁盘" value={formatMetricPercent(node.diskPct)} fraction={node.diskPct / 100} color="var(--progress-disk)" />
        <ResourceMetric label="负载" value={formatLoadValue(node.load1)} fraction={loadFraction} color="var(--progress-network)" />
      </div>

      <div className="node-list-cell node-list-network" role="cell" aria-label="实时网络">
        <span><ArrowUp size={11} aria-hidden /><strong>{upRate.value}</strong><small>{upRate.unit}</small></span>
        <span><ArrowDown size={11} aria-hidden /><strong>{downRate.value}</strong><small>{downRate.unit}</small></span>
      </div>

      <div className="node-list-cell node-list-traffic" role="cell" title={trafficTitle}>
        <span><Database size={11} aria-hidden />流量</span>
        <strong>{traffic.detail}</strong>
        <i style={{ "--node-list-traffic": `${traffic.fraction * 100}%` } as CSSProperties} aria-hidden />
      </div>

      <div className="node-list-cell node-list-ping" role="cell" aria-label="网络质量">
        <span title="Ping 延迟"><Clock3 size={11} aria-hidden /><strong style={{ color: latencyColor }}>{ping.lastValue != null ? `${ping.lastValue.toFixed(2)}ms` : "—"}</strong></span>
        <span title="丢包率"><Unplug size={11} aria-hidden /><strong style={{ color: lossColor }}>{ping.loss != null ? `${ping.loss.toFixed(2)}%` : "—"}</strong></span>
      </div>

      <div className="node-list-cell node-list-lifecycle" role="cell" aria-label="运行与续费">
        <span title="在线时长"><Clock3 size={11} aria-hidden />{uptimeLabel}</span>
        <span title="到期时间" style={{ color: expireColor }}><CalendarDays size={11} aria-hidden />{expireLabel}</span>
        <strong title="续费价格">{renewalPrice || "未填价格"}</strong>
      </div>

      <Link className="node-list-detail" to={`/instance/${node.uuid}`} aria-label={`查看 ${node.name} 详情`} title="查看详情">
        <ChevronRight size={16} aria-hidden />
      </Link>
    </div>
  );
}

const MemoNodeListRow = memo(NodeListRow);

export function NodeList({
  uuids,
  sorts,
  onSort,
  onInteractionChange,
}: {
  uuids: string[];
  sorts: VpsListSortCondition[];
  onSort: (key: VpsListSortKey, additive: boolean) => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) onInteractionChange(false);
  };
  return (
    <div
      className="node-list"
      role="table"
      aria-label="VPS 列表"
      onPointerEnter={() => onInteractionChange(true)}
      onPointerLeave={() => onInteractionChange(false)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={handleBlur}
      onTouchStart={() => onInteractionChange(true)}
      onTouchEnd={() => onInteractionChange(false)}
      onTouchCancel={() => onInteractionChange(false)}
    >
      <div className="node-list-head" role="row">
        {DIRECT_SORT_GROUPS.map((group, index) => <SortHeaderGroup key={index} sorts={sorts} onSort={onSort}>{group}</SortHeaderGroup>)}
        <span aria-hidden />
      </div>
      <div className="node-list-body" role="rowgroup">
        {uuids.map((uuid) => <MemoNodeListRow key={uuid} uuid={uuid} />)}
      </div>
    </div>
  );
}
