import { describe, expect, it } from "vitest";
import {
  buildCompareHref,
  buildFleet3DModel,
  buildFleet3DReplayState,
  detectFleet3DRendererCapability,
  filterFleet3DNodes,
  getFleet3DFocusOptions,
  resolveFleet3DFocus,
} from "@/utils/fleet3d";
import type { HomeNodeSummary } from "@/services/wsStore";
import type { LoadRecord, NodeInfo, PingOverviewItem } from "@/types/komari";

function node(partial: Partial<NodeInfo>): NodeInfo {
  return {
    uuid: "node-a",
    name: "alpha",
    group: "",
    region: "",
    hidden: false,
    cpu_name: "",
    cpu_cores: 1,
    arch: "",
    virtualization: "",
    os: "",
    kernel_version: "",
    version: "",
    ipv4: "",
    ipv6: "",
    capability_ping: null,
    capability_private_ping_targets: null,
    gpu_name: "",
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 0,
    billing_cycle: "",
    auto_renewal: false,
    currency: "",
    expired_at: "",
    tags: "",
    public_remark: "",
    traffic_limit: 0,
    traffic_limit_type: "",
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

function summary(partial: Partial<HomeNodeSummary>): HomeNodeSummary {
  return {
    uuid: "node-a",
    group: "",
    region: "",
    hidden: false,
    weight: 0,
    online: true,
    trafficUp: 0,
    trafficDown: 0,
    netUp: 0,
    netDown: 0,
    updatedAt: 0,
    ...partial,
  };
}

function ping(partial: Partial<PingOverviewItem>): PingOverviewItem {
  return {
    client: "node-a",
    isAssigned: true,
    lastValue: 20,
    values: [20],
    samples: [{ time: Date.now(), value: 20 }],
    max: 20,
    loss: 0,
    ...partial,
  };
}

function loadRecord(partial: Partial<LoadRecord>): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 100,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 100,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time: 0,
    client: "",
    ...partial,
  };
}

describe("buildFleet3DModel", () => {
  it("builds deterministic positions and status counts", () => {
    const nodes = [
      node({ uuid: "a", name: "alpha", group: "edge", region: "US" }),
      node({ uuid: "b", name: "beta", group: "edge", region: "JP" }),
      node({ uuid: "c", name: "gamma", group: "core", region: "DE" }),
    ];
    const summaries = [
      summary({ uuid: "a", online: true, netUp: 1200, netDown: 5000 }),
      summary({ uuid: "b", online: false }),
    ];

    const first = buildFleet3DModel(nodes, summaries);
    const second = buildFleet3DModel(nodes, summaries);

    expect(first.online).toBe(1);
    expect(first.offline).toBe(1);
    expect(first.unknown).toBe(1);
    expect(first.nodes.map((item) => item.position)).toEqual(
      second.nodes.map((item) => item.position),
    );
    expect(first.orbits.map((item) => item.group)).toEqual(["core", "edge"]);
    expect(first.nodes.find((item) => item.uuid === "a")).toMatchObject({
      netUp: 1200,
      netDown: 5000,
      netRate: 6200,
    });
  });

  it("filters hidden nodes out of the 3D model", () => {
    const model = buildFleet3DModel([
      node({ uuid: "visible", hidden: false }),
      node({ uuid: "hidden", hidden: true }),
    ], []);

    expect(model.nodes.map((item) => item.uuid)).toEqual(["visible"]);
  });

  it("derives ping halo pressure from latency and loss", () => {
    const model = buildFleet3DModel(
      [node({ uuid: "laggy" })],
      [summary({ uuid: "laggy" })],
      new Map([
        [
          "laggy",
          ping({
            client: "laggy",
            lastValue: 1280,
            loss: 23,
          }),
        ],
      ]),
    );

    expect(model.nodes[0]?.ping).toMatchObject({
      assigned: true,
      latency: 1280,
      loss: 23,
      tone: "critical",
    });
    expect(model.nodes[0]?.ping.radius).toBeGreaterThan(0.4);
    expect(model.nodes[0]?.ping.fragmentation).toBeGreaterThan(0.5);
  });

  it("derives risk scan signals from operational risks and completeness", () => {
    const model = buildFleet3DModel(
      [
        node({
          uuid: "offline",
          region: "US",
          group: "edge",
          price: 5,
          billing_cycle: "month",
          expired_at: "2000-01-01T00:00:00Z",
          traffic_limit: 1024,
        }),
      ],
      [summary({ uuid: "offline", online: false })],
    );

    expect(model.riskCritical).toBe(1);
    expect(model.nodes[0]?.risk.tone).toBe("critical");
    expect(model.nodes[0]?.risk.issues).toContain("节点离线");
    expect(model.nodes[0]?.risk.score).toBeGreaterThan(0.5);
  });
});

describe("fleet 3D helpers", () => {
  it("filters by node status", () => {
    const model = buildFleet3DModel(
      [node({ uuid: "a" }), node({ uuid: "b" })],
      [summary({ uuid: "a", online: true }), summary({ uuid: "b", online: false })],
    );

    expect(filterFleet3DNodes(model.nodes, "offline").map((item) => item.uuid)).toEqual(["b"]);
    expect(filterFleet3DNodes(model.nodes, "all")).toHaveLength(2);
  });

  it("builds compare deep links from selected nodes", () => {
    expect(buildCompareHref(["a"])).toBe("/compare");
    expect(buildCompareHref(["a", "b", "a"])).toBe("/compare?nodes=a%2Cb");
  });

  it("keeps renderer detection safe outside the browser", () => {
    expect(detectFleet3DRendererCapability()).toMatchObject({
      mode: "unavailable",
      webgpu: false,
      webgl2: false,
      webgl1: false,
    });
  });

  it("maps historical records into replay pressure", () => {
    const model = buildFleet3DModel([node({ uuid: "a" })], [summary({ uuid: "a" })]);
    const replay = buildFleet3DReplayState(
      model.nodes,
      {
        a: [
          loadRecord({ time: 1000, cpu: 5, ram: 10, ram_total: 100 }),
          loadRecord({
            time: 2000,
            cpu: 96,
            ram: 90,
            ram_total: 100,
            disk: 88,
            disk_total: 100,
            net_in: 1024 * 1024,
            net_out: 1024 * 1024,
          }),
        ],
      },
      1,
    );

    expect(replay.sampleCount).toBe(2);
    expect(replay.timestamp).toBe(2000 * 1000);
    expect(replay.nodes[0]?.replay?.active).toBe(true);
    expect(replay.nodes[0]?.replay?.pressure).toBeGreaterThan(0.7);
    expect(replay.nodes[0]?.color).toBe("#ff6678");
  });

  it("resolves group focus targets and centers", () => {
    const model = buildFleet3DModel([
      node({ uuid: "a", group: "edge" }),
      node({ uuid: "b", group: "edge" }),
      node({ uuid: "c", group: "core" }),
    ], []);

    expect(getFleet3DFocusOptions(model.nodes, "group")).toEqual(["core", "edge"]);
    const focus = resolveFleet3DFocus(model.nodes, "group", "edge");

    expect(focus.uuids).toEqual(["a", "b"]);
    expect(focus.center).not.toBeNull();
    expect(focus.label).toBe("edge");
  });
});
