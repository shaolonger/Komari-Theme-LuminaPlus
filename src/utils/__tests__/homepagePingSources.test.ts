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
        taskId: 5,
        group: "海外",
        latencyMs: 420,
        lossPercent: 6,
        latencyLabel: "420 ms",
        latencyShortLabel: "420",
        lossLabel: "6.0%",
        lossShortLabel: "6.0",
        lossDotCount: 4,
        status: "warning",
      }),
      expect.objectContaining({
        taskId: 2,
        latencyMs: 42,
        lossPercent: 0,
        latencyLabel: "42 ms",
        latencyShortLabel: "42",
        lossLabel: "0.0%",
        lossShortLabel: "0.0",
        lossDotCount: 0,
        status: "ok",
      }),
    ]);
    expect(rows[0].attentionScore).toBeGreaterThan(rows[1].attentionScore);
    expect(rows[0].latencyRatio).toBeGreaterThan(rows[1].latencyRatio);
    expect(rows[0].title).toContain("Los Angeles · 海外");
  });

  it("keeps same-attention rows in source order and models empty sources", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [
        {
          taskId: 7,
          name: "No samples",
          target: "",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
        {
          taskId: 8,
          name: "Also empty",
          target: "",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
      ],
    });

    expect(rows.map((row) => row.taskId)).toEqual([7, 8]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        latencyLabel: "无有效延迟",
        latencyShortLabel: "—",
        lossLabel: "未知",
        lossShortLabel: "—",
        latencyRatio: 0,
        lossDotCount: 0,
        status: "empty",
      }),
    );
  });

  it("builds a compare URL for single-VPS multi-task trends", () => {
    expect(buildHomepagePingCompareUrl("node-a", [5, 2, 2])).toBe(
      "/compare?nodes=node-a&metric=ping_latency&hours=4&tab=trend&pingTasks=2%2C5",
    );
  });
});
