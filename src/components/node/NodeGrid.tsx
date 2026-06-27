import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import {
  formatBytes,
  formatByteRate,
  formatByteRateLabel,
} from "@/utils/format";
import { calculateCostSummary, formatCnyMoney, getExchangeRates } from "@/utils/cost";
import { speedRateColor } from "@/utils/metricTone";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  HOME_ALL_GROUP,
  sortHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";
import {
  getOverviewRating,
  type OverviewRating,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";
import { invertHomepagePingTaskBindings } from "@/utils/pingTasks";
import {
  getVpsOperationalRisks,
  type VpsRisk,
  type VpsRiskKind,
} from "@/utils/vpsRisk";
import { Spinner } from "@/components/ui/Spinner";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";

// 把多个 uuid 拼成单个签名串作为 memo key。逗号安全:uuid 是标准 UUID
// ([0-9a-f-]),永远不含逗号。
const UUID_KEY_SEPARATOR = ",";

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

type HomeRiskFilter = "all" | "attention" | VpsRiskKind;
type HomeRiskItem = VpsRisk & { name: string };

const HOME_RISK_FILTERS: Array<{ value: HomeRiskFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "attention", label: "需处理" },
  { value: "status", label: "上报" },
  { value: "expiry", label: "到期" },
  { value: "traffic", label: "流量" },
  { value: "ping", label: "Ping" },
];

function formatCompactBytes(value: number): string {
  const [amount, unit = "B"] = formatBytes(value).split(" ");
  return `${amount}${unit[0]}`;
}

function countRiskNodes(risks: HomeRiskItem[], filter: HomeRiskFilter) {
  if (filter === "all") return 0;
  const uuids = new Set<string>();
  for (const risk of risks) {
    if (filter === "attention" || risk.kind === filter) {
      uuids.add(risk.uuid);
    }
  }
  return uuids.size;
}

function riskMatchesFilter(risks: HomeRiskItem[] | undefined, filter: HomeRiskFilter) {
  if (filter === "all") return true;
  if (!risks || risks.length === 0) return false;
  return filter === "attention" || risks.some((risk) => risk.kind === filter);
}

function HomeOperationsQueue({
  risks,
  selectedFilter,
  onSelectFilter,
}: {
  risks: HomeRiskItem[];
  selectedFilter: HomeRiskFilter;
  onSelectFilter: (filter: HomeRiskFilter) => void;
}) {
  const topRisks = risks.slice(0, 6);
  const riskNodes = countRiskNodes(risks, "attention");

  return (
    <section className="home-ops-panel" aria-label="VPS 运维事项">
      <div className="home-ops-head">
        <div>
          <h2>运维事项</h2>
          <p>{riskNodes > 0 ? `${riskNodes} 台 VPS 需要关注` : "当前没有高优先级事项"}</p>
        </div>
        <div className="home-ops-filters" role="group" aria-label="运维事项筛选">
          {HOME_RISK_FILTERS.map((filter) => {
            const count = countRiskNodes(risks, filter.value);
            return (
              <button
                key={filter.value}
                type="button"
                data-active={selectedFilter === filter.value ? "true" : "false"}
                onClick={() => onSelectFilter(filter.value)}
              >
                <span>{filter.label}</span>
                {filter.value !== "all" && <strong>{count}</strong>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="home-ops-list">
        {topRisks.length > 0 ? (
          topRisks.map((risk) => (
            <Link
              key={`${risk.uuid}-${risk.kind}-${risk.title}`}
              to={`/instance/${risk.uuid}`}
              className="home-ops-item"
              data-severity={risk.severity}
              title={`${risk.name}: ${risk.detail}`}
            >
              <span className="home-ops-node">{risk.name}</span>
              <span className="home-ops-title">{risk.title}</span>
              <span className="home-ops-detail">{risk.detail}</span>
            </Link>
          ))
        ) : (
          <div className="home-ops-empty">暂无需要处理的 VPS</div>
        )}
      </div>
    </section>
  );
}

function HomeOverviewCards({
  overview,
  costSummary,
  costLoading,
  showOverviewRatings,
  overviewRatingStyle,
  showTrafficRating,
  showBandwidthRating,
  showAssetRating,
  trafficRatingLabels,
  bandwidthRatingLabels,
  assetRatingLabels,
  showDetailButton,
  onOpenCostSummary,
}: {
  overview: HomeOverview;
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  showOverviewRatings: boolean;
  overviewRatingStyle: OverviewRatingStyle;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  showDetailButton: boolean;
  onOpenCostSummary: () => void;
}) {
  const [trafficValue, trafficUnit] = formatBytes(
    overview.trafficUp + overview.trafficDown,
  ).split(" ");
  const rate = formatByteRate(overview.netUp + overview.netDown);
  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const offlinePct =
    overview.totalNodes > 0 ? (overview.offlineNodes / overview.totalNodes) * 100 : 0;
  const remainingValue = costSummary
    ? formatCnyMoney(costSummary.remainingCny)
    : costLoading
      ? "计算中"
      : "—";
  const trafficDetailLabel = `↑ ${formatBytes(overview.trafficUp)} · ↓ ${formatBytes(overview.trafficDown)}`;
  const trafficCompactLabel = `↑${formatCompactBytes(overview.trafficUp)} ↓${formatCompactBytes(overview.trafficDown)}`;
  const bandwidthDetailLabel = `↑ ${formatByteRateLabel(overview.netUp)} · ↓ ${formatByteRateLabel(overview.netDown)}`;
  const bandwidthCompactLabel = `↑${formatCompactBytes(overview.netUp)} ↓${formatCompactBytes(overview.netDown)}`;
  const trafficRating =
    showOverviewRatings && showTrafficRating
      ? getOverviewRating({
          kind: "traffic",
          value: overview.trafficUp + overview.trafficDown,
          style: overviewRatingStyle,
          customLabels: trafficRatingLabels,
        })
      : null;
  const bandwidthRating =
    showOverviewRatings && showBandwidthRating
      ? getOverviewRating({
          kind: "bandwidth",
          value: overview.netUp + overview.netDown,
          style: overviewRatingStyle,
          customLabels: bandwidthRatingLabels,
        })
      : null;
  const assetRating =
    showOverviewRatings && showAssetRating && costSummary
      ? getOverviewRating({
          kind: "asset",
          value: costSummary.remainingCny,
          style: overviewRatingStyle,
          customLabels: assetRatingLabels,
        })
      : null;

  const renderRating = (rating: OverviewRating | null) =>
    rating ? (
      <span className="overview-card-rating" data-rating-level={rating.level} title={rating.label}>
        {rating.label}
      </span>
    ) : null;

  return (
    <section className="home-overview" aria-label="首页总览">
      <article className="overview-card">
        <span className="overview-card-label">在线节点</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {overview.onlineNodes}
            <span className="overview-card-unit">/ {overview.totalNodes}</span>
          </p>
        </div>
        {overview.totalNodes >= 5 && overview.totalNodes <= 10 ? (
          // 节点数 5–10 时改用块状:每台一格,在线格在左、离线格在右、未知格居中,
          // 与条状的「左绿右红」完全同步。颜色复用同一组 token,避免该红却绿。
          <div className="overview-blocks" role="presentation">
            {Array.from({ length: overview.totalNodes }, (_, i) => {
              const cls =
                i < overview.onlineNodes
                  ? "overview-block is-online"
                  : i >= overview.totalNodes - overview.offlineNodes
                    ? "overview-block is-offline"
                    : "overview-block";
              return <span key={i} className={cls} />;
            })}
          </div>
        ) : (
          <div className="overview-bar" role="presentation">
            <span className="overview-bar-online" style={{ width: `${onlinePct}%` }} />
            <span className="overview-bar-offline" style={{ width: `${offlinePct}%` }} />
          </div>
        )}
      </article>

      <article className="overview-card">
        <span className="overview-card-label">累计流量</span>
        <div className="overview-card-main">
          <p className="overview-card-value">
            {trafficValue}
            <span className="overview-card-unit">{trafficUnit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={trafficDetailLabel}>
            <span className="overview-card-sub-full">{trafficDetailLabel}</span>
            <span className="overview-card-sub-compact">{trafficCompactLabel}</span>
          </p>
          {renderRating(trafficRating)}
        </div>
      </article>

      <article className="overview-card">
        <span className="overview-card-label">实时带宽</span>
        <div className="overview-card-main">
          <p className="overview-card-value" style={{ color: speedRateColor(rate.unit) }}>
            {rate.value}
            <span className="overview-card-unit">{rate.unit}</span>
          </p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-sub" title={bandwidthDetailLabel}>
            <span className="overview-card-sub-full">{bandwidthDetailLabel}</span>
            <span className="overview-card-sub-compact">{bandwidthCompactLabel}</span>
          </p>
          {renderRating(bandwidthRating)}
        </div>
      </article>

      <article className="overview-card">
        <div className="overview-card-head">
          <span className="overview-card-label">资产概览</span>
          {showDetailButton && (
            <button
              type="button"
              className="overview-card-action"
              onClick={onOpenCostSummary}
              aria-label="打开资产统计详情"
              title="资产统计"
            >
              <CircleDollarSign size={15} />
            </button>
          )}
        </div>
        <div className="overview-card-main">
          <p className="overview-card-value">{remainingValue}</p>
        </div>
        <div className="overview-card-footer">
          <p className="overview-card-caption">实时汇率计算</p>
          {renderRating(assetRating)}
        </div>
      </article>
    </section>
  );
}

function GroupTabs({
  groups,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  return (
    <div className="home-group-tabs" role="tablist" aria-label="节点分组">
      <button
        type="button"
        role="tab"
        aria-selected={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        全部
      </button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          role="tab"
          aria-selected={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
    </div>
  );
}

export function NodeGrid() {
  const nodes = useHomeNodeSummaries();
  const allMeta = useAllNodeMeta();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<HomeRiskFilter>("all");
  const [costSummaryOpen, setCostSummaryOpen] = useState(false);
  useHomepagePingOverview();

  const visibleNodes = useMemo(
    () => nodes.filter((node) => me?.logged_in === true || !node.hidden),
    [me?.logged_in, nodes],
  );
  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of visibleNodes) {
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes: visibleNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [visibleNodes]);
  const metaByUuid = useMemo(
    () => new Map(allMeta.map((node) => [node.uuid, node])),
    [allMeta],
  );
  const selectedPingTaskByClient = useMemo(
    () =>
      themeSettings.isReady
        ? invertHomepagePingTaskBindings(themeSettings.homepagePingBindings)
        : new Map<string, number>(),
    [themeSettings.homepagePingBindings, themeSettings.isReady],
  );
  const risksByUuid = useMemo(() => {
    const next = new Map<string, HomeRiskItem[]>();
    for (const node of visibleNodes) {
      const meta = metaByUuid.get(node.uuid);
      if (!meta) continue;
      const risks = getVpsOperationalRisks({
        uuid: node.uuid,
        online: node.online,
        updatedAt: node.updatedAt,
        trafficUp: node.trafficUp,
        trafficDown: node.trafficDown,
        trafficLimit: meta.traffic_limit,
        trafficLimitType: meta.traffic_limit_type,
        expiredAt: meta.expired_at,
        capabilityPing: meta.capability_ping,
        hasPingBinding: selectedPingTaskByClient.has(node.uuid),
      }).map((risk) => ({
        ...risk,
        name: meta.name.trim() || node.uuid,
      }));
      if (risks.length > 0) {
        next.set(node.uuid, risks);
      }
    }
    return next;
  }, [metaByUuid, selectedPingTaskByClient, visibleNodes]);
  const operationRisks = useMemo(
    () =>
      Array.from(risksByUuid.values())
        .flat()
        .sort((left, right) => {
          const severityDelta =
            (right.severity === "critical" ? 1 : 0) -
            (left.severity === "critical" ? 1 : 0);
          if (severityDelta !== 0) return severityDelta;
          return left.name.localeCompare(right.name, "zh-CN");
        }),
    [risksByUuid],
  );
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = allMeta.length > 0;
  // 资产概览卡片(剩余价值)始终显示,这样切换花费相关设置不会让整行重排。
  // showCostSummary 控制卡片右上角的详情按钮;悬浮球是兜底入口,只在详情按钮
  // 不显示时出现(总览隐藏或其开关关闭),所以两个入口不会同时出现(都开时卡内
  // 详情按钮优先)。
  const showAssetCard = showHomeOverview && hasNodes;
  const showCostDetailButton =
    showAssetCard && themeSettings.isReady && themeSettings.showCostSummary;
  const showCostFloatingButton =
    themeSettings.isReady &&
    themeSettings.showCostSummaryFloatingButton &&
    hasNodes &&
    !showCostDetailButton;
  // 只要有东西用到花费就计算:常驻的资产卡片,或悬浮球/面板。面板只在能被打开时才挂载。
  const costNeeded = showAssetCard || showCostFloatingButton;
  const shouldRenderCostSummary = showCostDetailButton || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: () => getExchangeRates(themeSettings.costRateApiUrl),
    staleTime: 60 * 60 * 1000,
    enabled: costNeeded,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(allMeta, themeSettings.costIgnoredNodes, rateQuery.data.rates)
        : null,
    [allMeta, themeSettings.costIgnoredNodes, rateQuery.data],
  );
  const costLoading = costNeeded && rateQuery.isLoading;
  useEffect(() => {
    if (!shouldRenderCostSummary && costSummaryOpen) setCostSummaryOpen(false);
  }, [shouldRenderCostSummary, costSummaryOpen]);
  const groupOptions = useMemo(
    () =>
      sortHomeGroupOptions(
        getHomeGroupOptions(visibleNodes),
        themeSettings.isReady ? themeSettings.homeGroupOrder : [],
      ),
    [visibleNodes, themeSettings.homeGroupOrder, themeSettings.isReady],
  );
  const filteredNodes = useMemo(() => {
    const groupFiltered =
      selectedGroup === HOME_ALL_GROUP
        ? visibleNodes
        : visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup);
    const filtered =
      selectedRiskFilter === "all"
        ? groupFiltered
        : groupFiltered.filter((node) =>
            riskMatchesFilter(risksByUuid.get(node.uuid), selectedRiskFilter),
          );
    return sortHomeNodeSummaries(
      filtered,
      themeSettings.isReady && themeSettings.moveOfflineNodesBack,
    );
  }, [
    visibleNodes,
    selectedGroup,
    selectedRiskFilter,
    risksByUuid,
    themeSettings.isReady,
    themeSettings.moveOfflineNodesBack,
  ]);

  useEffect(() => {
    if (selectedGroup !== HOME_ALL_GROUP && !groupOptions.includes(selectedGroup)) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, selectedGroup]);

  useEffect(() => {
    if (
      selectedRiskFilter !== "all" &&
      countRiskNodes(operationRisks, selectedRiskFilter) === 0
    ) {
      setSelectedRiskFilter("all");
    }
  }, [operationRisks, selectedRiskFilter]);

  // summary 对象每隔约 1s tick 就换新引用,导致 filteredNodes(以及直接映射 uuid)
  // 不停重建。改用稳定的 uuid 签名作为卡片列表的 key,这样只有集合或顺序真正变化时
  // 才重渲染——每张卡各自订阅自己的 store 切片、独立更新。
  const uuidsKey = useMemo(
    () => filteredNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [filteredNodes],
  );
  const cards = useMemo(() => {
    const uuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    return uuids.map((uuid) => (
      <div key={uuid} className="min-w-0">
        {mode === "compact" ? <CompactNodeCard uuid={uuid} /> : <NodeCard uuid={uuid} />}
      </div>
    ));
  }, [uuidsKey, mode]);
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  // 分组标签栏和卡片网格共用,让标签栏处在同一网格中、正好占一列卡片宽——
  // 边缘和第一张卡片对齐。
  const gridClassName = mode === "compact" ? "grid gap-3 xl:gap-4" : "grid gap-4 xl:gap-5";
  const gridColumns =
    mode === "compact"
      ? "repeat(auto-fill, minmax(min(100%, 340px), 1fr))"
      : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))";

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <>
        {shouldRenderCostSummary && (
          <CostSummary
            open={costSummaryOpen}
            onOpenChange={setCostSummaryOpen}
            showLauncher={showCostFloatingButton}
          />
        )}
        {showHomeOverview && (
          <HomeOverviewCards
            overview={overview}
            showDetailButton={showCostDetailButton}
            costSummary={costSummary}
            costLoading={costLoading}
            showOverviewRatings={themeSettings.showOverviewRatings}
            overviewRatingStyle={themeSettings.overviewRatingStyle}
            showTrafficRating={themeSettings.showTrafficRating}
            showBandwidthRating={themeSettings.showBandwidthRating}
            showAssetRating={themeSettings.showAssetRating}
            trafficRatingLabels={themeSettings.trafficRatingLabels}
            bandwidthRatingLabels={themeSettings.bandwidthRatingLabels}
            assetRatingLabels={themeSettings.assetRatingLabels}
            onOpenCostSummary={() => setCostSummaryOpen(true)}
          />
        )}
        <HomeOperationsQueue
          risks={operationRisks}
          selectedFilter={selectedRiskFilter}
          onSelectFilter={setSelectedRiskFilter}
        />
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
        </div>
      </>
    );
  }

  return (
    <>
      {shouldRenderCostSummary && (
        <CostSummary
          open={costSummaryOpen}
          onOpenChange={setCostSummaryOpen}
          showLauncher={showCostFloatingButton}
        />
      )}
      {showHomeOverview && (
        <HomeOverviewCards
          overview={overview}
          showDetailButton={showCostDetailButton}
          costSummary={costSummary}
          costLoading={costLoading}
          showOverviewRatings={themeSettings.showOverviewRatings}
          overviewRatingStyle={themeSettings.overviewRatingStyle}
          showTrafficRating={themeSettings.showTrafficRating}
          showBandwidthRating={themeSettings.showBandwidthRating}
          showAssetRating={themeSettings.showAssetRating}
          trafficRatingLabels={themeSettings.trafficRatingLabels}
          bandwidthRatingLabels={themeSettings.bandwidthRatingLabels}
          assetRatingLabels={themeSettings.assetRatingLabels}
          onOpenCostSummary={() => setCostSummaryOpen(true)}
        />
      )}
      <HomeOperationsQueue
        risks={operationRisks}
        selectedFilter={selectedRiskFilter}
        onSelectFilter={setSelectedRiskFilter}
      />
      {showGroupTabs && (
        <div className={`${gridClassName} mb-4`} style={{ gridTemplateColumns: gridColumns }}>
          <GroupTabs
            groups={groupOptions}
            selectedGroup={selectedGroup}
            onSelectGroup={setSelectedGroup}
          />
        </div>
      )}
      <div className={gridClassName} style={{ gridTemplateColumns: gridColumns }}>
        {cards.length > 0 ? (
          cards
        ) : (
          <div className="home-filter-empty">当前筛选下没有匹配的 VPS</div>
        )}
      </div>
    </>
  );
}
