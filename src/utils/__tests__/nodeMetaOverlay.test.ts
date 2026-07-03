import { describe, expect, it } from "vitest";
import type { AdminClient, NodeInfo } from "@/types/komari";
import {
  overlayAdminClientMeta,
  shouldIncludeAgentVersionCompleteness,
} from "@/utils/nodeMetaOverlay";

function meta(partial: Partial<NodeInfo> = {}): NodeInfo {
  return {
    uuid: "node-a",
    name: "Node A",
    group: "prod",
    region: "HK",
    hidden: false,
    cpu_name: "",
    cpu_cores: 1,
    arch: "amd64",
    virtualization: "",
    os: "linux",
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
    currency: "USD",
    expired_at: "",
    tags: "",
    public_remark: "",
    traffic_limit: 0,
    traffic_limit_type: "max",
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

function admin(partial: Partial<AdminClient> = {}): AdminClient {
  return {
    uuid: "node-a",
    name: "Node A",
    group: "prod",
    region: "HK",
    weight: 0,
    version: "v1.2.6",
    ipv4: "203.0.113.10",
    ipv6: "2001:db8::10",
    capability_ping: true,
    capability_private_ping_targets: false,
    ...partial,
  };
}

describe("overlayAdminClientMeta", () => {
  it("keeps public metadata unchanged without admin data", () => {
    const publicMeta = meta();

    expect(overlayAdminClientMeta(publicMeta, undefined)).toBe(publicMeta);
  });

  it("overlays authenticated agent version and capability metadata", () => {
    const enriched = overlayAdminClientMeta(meta(), admin());

    expect(enriched.version).toBe("v1.2.6");
    expect(enriched.ipv4).toBe("203.0.113.10");
    expect(enriched.capability_ping).toBe(true);
  });
});

describe("shouldIncludeAgentVersionCompleteness", () => {
  it("requires authenticated admin metadata before checking agent version", () => {
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: false,
        adminMetadataReady: true,
      }),
    ).toBe(false);
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: true,
        adminMetadataReady: false,
      }),
    ).toBe(false);
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: true,
        adminMetadataReady: true,
      }),
    ).toBe(true);
  });
});
