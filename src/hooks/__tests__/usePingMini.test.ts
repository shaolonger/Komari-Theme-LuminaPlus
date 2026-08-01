import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", () => ({
	getPingOverviewForNodes: vi.fn(),
}));

import { buildHomepagePingOverviewMap } from "@/hooks/usePingMini";
import { getPingOverviewForNodes } from "@/services/api";

const mockedGetPingOverview = vi.mocked(getPingOverviewForNodes);

describe("buildHomepagePingOverviewMap", () => {
  beforeEach(() => {
    mockedGetPingOverview.mockReset();
  });

  it("drops a deleted task when its response contains retained records but no task metadata", async () => {
    mockedGetPingOverview.mockResolvedValue({
	  from: 1_000,
	  to: 2_000,
      tasks: [],
	  stats: { "node-a": { "20": { name: "deleted", total: 1, lost: 0, latest: 279, avg: 279, tail: 0, loss: 0, min: 279, max: 279 } } },
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
	  from: 1_000,
	  to: 2_000,
      tasks: [
        {
          id: 3,
          name: "Cloudflare",
          type: "icmp",
          interval: 60,
        },
      ],
	  stats: { "node-a": { "3": { name: "Cloudflare", total: 60, lost: 3, latest: 42, avg: 40, tail: 0.2, loss: 5, min: 30, max: 80 } } },
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
