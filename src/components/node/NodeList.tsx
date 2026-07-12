import { memo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Clock3, Database, Unplug } from "lucide-react";
import { clsx } from "clsx";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { formatLoadValue, formatMetricPercent } from "@/utils/format";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";

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

export function NodeList({ uuids }: { uuids: string[] }) {
  return (
    <div className="node-list" role="table" aria-label="VPS 列表">
      <div className="node-list-head" role="row">
        <span role="columnheader">VPS</span>
        <span role="columnheader">资源</span>
        <span role="columnheader">实时网络</span>
        <span role="columnheader">流量额度</span>
        <span role="columnheader">Ping / 丢包</span>
        <span role="columnheader">运行 / 到期</span>
        <span aria-hidden />
      </div>
      <div className="node-list-body" role="rowgroup">
        {uuids.map((uuid) => <MemoNodeListRow key={uuid} uuid={uuid} />)}
      </div>
    </div>
  );
}
