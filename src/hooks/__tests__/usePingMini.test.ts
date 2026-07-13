import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", () => ({
  getPingOverview: vi.fn(),
}));

import { buildHomepagePingOverviewMap } from "@/hooks/usePingMini";
import { getPingOverview } from "@/services/api";

const mockedGetPingOverview = vi.mocked(getPingOverview);

describe("buildHomepagePingOverviewMap", () => {
  beforeEach(() => {
    mockedGetPingOverview.mockReset();
  });

  it("drops a deleted task when its response contains retained records but no task metadata", async () => {
    mockedGetPingOverview.mockResolvedValue({
      count: 1,
      records: [{ task_id: 20, client: "node-a", time: 1_000, value: 279 }],
      tasks: [],
      basicInfo: [],
    });

    const result = await buildHomepagePingOverviewMap(
      1,
      ["node-a"],
      { 20: ["node-a"] },
      "worst",
      {},
    );

    expect(result.assignmentKey).toBe("");
    expect(result.items.size).toBe(0);
  });

  it("keeps an active task with its real metadata", async () => {
    mockedGetPingOverview.mockResolvedValue({
      count: 1,
      records: [{ task_id: 3, client: "node-a", time: 1_000, value: 42 }],
      tasks: [
        {
          id: 3,
          name: "Cloudflare",
          type: "icmp",
          interval: 60,
          clients: ["node-a"],
          target: "1.1.1.1",
          loss: 0,
          weight: 0,
        },
      ],
      basicInfo: [],
    });

    const result = await buildHomepagePingOverviewMap(
      1,
      ["node-a"],
      { 3: ["node-a"] },
      "worst",
      {},
    );

    expect(result.assignmentKey).toBe("node-a:3");
    expect(result.items.get("node-a")).toMatchObject({
      taskIds: [3],
      lastValue: 42,
      taskSummaries: [expect.objectContaining({ name: "Cloudflare" })],
    });
  });
});
