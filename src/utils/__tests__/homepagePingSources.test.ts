import { describe, expect, it } from "vitest";
import {
  buildHomepagePingCompareUrl,
  buildHomepagePingSourceRows,
} from "@/utils/homepagePingSources";

describe("homepage Ping source helpers", () => {
  it("formats source rows with groups and status", () => {
    const rows = buildHomepagePingSourceRows(
      {
        taskSummaries: [
          {
            taskId: 2,
            name: "Google",
            target: "8.8.8.8",
            lastValue: 42,
            loss: 0,
            sampleCount: 8,
            hasSamples: true,
          },
          {
            taskId: 5,
            name: "Los Angeles",
            target: "15.253.0.254",
            lastValue: 420,
            loss: 6,
            sampleCount: 8,
            hasSamples: true,
          },
        ],
      },
      { 5: "海外" },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        taskId: 2,
        latencyLabel: "42 ms",
        lossLabel: "0.0%",
        status: "ok",
      }),
      expect.objectContaining({
        taskId: 5,
        group: "海外",
        status: "warning",
      }),
    ]);
  });

  it("builds a compare URL for single-VPS multi-task trends", () => {
    expect(buildHomepagePingCompareUrl("node-a", [5, 2, 2])).toBe(
      "/compare?nodes=node-a&metric=ping_latency&hours=4&tab=trend&pingTasks=2%2C5",
    );
  });
});
