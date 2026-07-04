import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, ChevronLeft, Network, X } from "lucide-react";
import { Fleet3DScene } from "@/components/fleet3d/Fleet3DScene";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview, usePingMiniMap } from "@/hooks/usePingMini";
import {
  buildCompareHref,
  buildFleet3DModel,
  filterFleet3DNodes,
  type Fleet3DFilter,
  type Fleet3DNode,
  type Fleet3DStatus,
} from "@/utils/fleet3d";
import { formatBytes, formatByteRateLabel } from "@/utils/format";

const MAX_COMPARE_NODES = 8;

const STATUS_LABELS: Record<Fleet3DStatus, string> = {
  online: "在线",
  offline: "离线",
  unknown: "未知",
};

const FILTERS: Array<{ value: Fleet3DFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "online", label: "在线" },
  { value: "offline", label: "离线" },
  { value: "unknown", label: "未知" },
];

function uniqueLimited(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, MAX_COMPARE_NODES);
}

function countForFilter(filter: Fleet3DFilter, model: ReturnType<typeof buildFleet3DModel>) {
  if (filter === "all") return model.nodes.length;
  return model[filter];
}

function statusClass(status: Fleet3DStatus) {
  return `is-${status}`;
}

function formatSyncTime(timestamp: number) {
  if (!timestamp) return "等待同步";
  const elapsedMs = Date.now() - timestamp;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "刚刚";
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatPingLatency(node: Fleet3DNode) {
  if (!node.ping.assigned) return "未绑定";
  if (node.ping.latency == null) return "等待样本";
  return `${node.ping.latency.toFixed(0)} ms`;
}

function formatPingLoss(node: Fleet3DNode) {
  if (!node.ping.assigned) return "未绑定";
  if (node.ping.loss == null) return "—";
  return `${node.ping.loss.toFixed(1)}%`;
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: Fleet3DStatus;
}) {
  return (
    <div className={`fleet3d-stat-pill ${tone ? statusClass(tone) : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Inspector({
  node,
  inCompare,
  onToggleCompare,
}: {
  node: Fleet3DNode | null;
  inCompare: boolean;
  onToggleCompare: (uuid: string) => void;
}) {
  if (!node) {
    return (
      <aside className="fleet3d-inspector" aria-label="节点检查器">
        <p className="fleet3d-eyebrow">节点检查器</p>
        <h2>选择一台 VPS</h2>
        <p className="fleet3d-muted">点选星图节点后查看实时带宽、流量、分组与同步状态。</p>
      </aside>
    );
  }

  return (
    <aside className="fleet3d-inspector" aria-label={`${node.name} 节点检查器`}>
      <div className="fleet3d-inspector-heading">
        <div>
          <p className="fleet3d-eyebrow">{node.group}</p>
          <h2>{node.name}</h2>
        </div>
        <span className={`fleet3d-node-status ${statusClass(node.status)}`}>
          {STATUS_LABELS[node.status]}
        </span>
      </div>
      <dl className="fleet3d-node-metrics">
        <div>
          <dt>地区</dt>
          <dd>{node.region}</dd>
        </div>
        <div>
          <dt>实时带宽</dt>
          <dd>{formatByteRateLabel(node.netRate)}</dd>
        </div>
        <div>
          <dt>累计流量</dt>
          <dd>{formatBytes(node.trafficTotal)}</dd>
        </div>
        <div>
          <dt>同步</dt>
          <dd>{formatSyncTime(node.updatedAt)}</dd>
        </div>
        <div>
          <dt>Ping 延迟</dt>
          <dd>{formatPingLatency(node)}</dd>
        </div>
        <div>
          <dt>Ping 丢包</dt>
          <dd>{formatPingLoss(node)}</dd>
        </div>
      </dl>
      <div className="fleet3d-inspector-actions">
        <button type="button" onClick={() => onToggleCompare(node.uuid)}>
          <BarChart3 size={15} aria-hidden="true" />
          <span>{inCompare ? "移出对比" : "加入对比"}</span>
        </button>
        <Link to={`/instance/${node.uuid}`}>
          <Network size={15} aria-hidden="true" />
          <span>详情</span>
        </Link>
      </div>
    </aside>
  );
}

export function Fleet3D() {
  const allNodes = useAllNodeMeta();
  const summaries = useHomeNodeSummaries();
  useHomepagePingOverview();
  const [filter, setFilter] = useState<Fleet3DFilter>("all");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [compareUuids, setCompareUuids] = useState<string[]>([]);

  const visibleUuids = useMemo(
    () => allNodes.filter((node) => !node.hidden).map((node) => node.uuid),
    [allNodes],
  );
  const pingByUuid = usePingMiniMap(visibleUuids);
  const model = useMemo(
    () => buildFleet3DModel(allNodes, summaries, pingByUuid),
    [allNodes, pingByUuid, summaries],
  );
  const visibleNodes = useMemo(
    () => filterFleet3DNodes(model.nodes, filter),
    [filter, model.nodes],
  );
  const selectedNode = useMemo(
    () => model.nodes.find((node) => node.uuid === selectedUuid) ?? null,
    [model.nodes, selectedUuid],
  );
  const compareNodes = useMemo(
    () =>
      compareUuids
        .map((uuid) => model.nodes.find((node) => node.uuid === uuid))
        .filter((node): node is Fleet3DNode => Boolean(node)),
    [compareUuids, model.nodes],
  );
  const compareHref = useMemo(() => buildCompareHref(compareUuids), [compareUuids]);

  const toggleCompare = useCallback((uuid: string) => {
    setCompareUuids((current) => {
      if (current.includes(uuid)) return current.filter((item) => item !== uuid);
      return uniqueLimited([...current, uuid]);
    });
  }, []);

  const handleMarqueeSelect = useCallback((uuids: string[]) => {
    setCompareUuids(uniqueLimited(uuids));
    if (uuids[0]) setSelectedUuid(uuids[0]);
  }, []);

  const handleSelectNode = useCallback((uuid: string | null) => {
    setSelectedUuid(uuid);
  }, []);

  return (
    <section className="fleet3d-page" aria-label="VPS 3D 星图">
      <Fleet3DScene
        nodes={visibleNodes}
        orbits={model.orbits}
        selectedUuid={selectedUuid}
        compareUuids={compareUuids}
        onSelectNode={handleSelectNode}
        onMarqueeSelect={handleMarqueeSelect}
      />

      <header className="fleet3d-topbar">
        <div className="fleet3d-titlebar">
          <Link to="/" className="fleet3d-icon-button" aria-label="返回主页">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <div>
            <p className="fleet3d-eyebrow">LuminaPlus</p>
            <h1>VPS 3D 星图</h1>
          </div>
        </div>
        <div className="fleet3d-status-strip" aria-label="舰队状态">
          <StatPill label="总数" value={model.nodes.length} />
          <StatPill label="在线" value={model.online} tone="online" />
          <StatPill label="离线" value={model.offline} tone="offline" />
          <StatPill label="未知" value={model.unknown} tone="unknown" />
        </div>
        <Link to={compareHref} className="fleet3d-compare-button">
          <BarChart3 size={16} aria-hidden="true" />
          <span>对比</span>
          <strong>{compareUuids.length}</strong>
        </Link>
      </header>

      <nav className="fleet3d-filterbar" aria-label="星图筛选">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "is-active" : ""}
            onClick={() => setFilter(item.value)}
          >
            <span>{item.label}</span>
            <strong>{countForFilter(item.value, model)}</strong>
          </button>
        ))}
      </nav>

      {model.nodes.length === 0 && (
        <div className="fleet3d-empty-state">
          <p className="fleet3d-eyebrow">暂无节点</p>
          <h2>星图等待第一台 VPS</h2>
          <Link to="/">返回主页</Link>
        </div>
      )}

      <Inspector
        node={selectedNode}
        inCompare={selectedNode ? compareUuids.includes(selectedNode.uuid) : false}
        onToggleCompare={toggleCompare}
      />

      <div className="fleet3d-compare-tray" aria-label="对比托盘">
        <div>
          <p className="fleet3d-eyebrow">对比托盘</p>
          <strong>{compareUuids.length < 2 ? "至少选择 2 台 VPS" : `${compareUuids.length} 台 VPS`}</strong>
        </div>
        <div className="fleet3d-compare-nodes">
          {compareNodes.length === 0 ? (
            <span>框选或在检查器中加入节点</span>
          ) : (
            compareNodes.map((node) => (
              <button
                key={node.uuid}
                type="button"
                onClick={() => toggleCompare(node.uuid)}
                title={`移出 ${node.name}`}
              >
                <span>{node.name}</span>
                <X size={12} aria-hidden="true" />
              </button>
            ))
          )}
        </div>
        <Link
          to={compareHref}
          className={`fleet3d-tray-action ${compareUuids.length < 2 ? "is-disabled" : ""}`}
          aria-disabled={compareUuids.length < 2}
        >
          <BarChart3 size={15} aria-hidden="true" />
          <span>打开对比</span>
        </Link>
      </div>
    </section>
  );
}
