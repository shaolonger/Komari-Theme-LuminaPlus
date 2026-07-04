import { describe, expect, it } from "vitest";
import { buildCompareHref, buildFleet3DModel, filterFleet3DNodes } from "@/utils/fleet3d";
import type { HomeNodeSummary } from "@/services/wsStore";
import type { NodeInfo } from "@/types/komari";

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

describe("buildFleet3DModel", () => {
  it("builds deterministic positions and status counts", () => {
    const nodes = [
      node({ uuid: "a", name: "alpha", group: "edge", region: "US" }),
      node({ uuid: "b", name: "beta", group: "edge", region: "JP" }),
      node({ uuid: "c", name: "gamma", group: "core", region: "DE" }),
    ];
    const summaries = [
      summary({ uuid: "a", online: true, netDown: 5000 }),
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
  });

  it("filters hidden nodes out of the 3D model", () => {
    const model = buildFleet3DModel([
      node({ uuid: "visible", hidden: false }),
      node({ uuid: "hidden", hidden: true }),
    ], []);

    expect(model.nodes.map((item) => item.uuid)).toEqual(["visible"]);
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
});
