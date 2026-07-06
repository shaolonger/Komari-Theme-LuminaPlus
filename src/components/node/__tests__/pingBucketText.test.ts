import { describe, expect, it } from "vitest";
import type { PingOverviewBucket } from "@/types/komari";
import { formatHealthBucketTooltip, formatPingBucketWindow } from "@/components/node/pingBucketText";

function bucket(partial: Partial<PingOverviewBucket> = {}): PingOverviewBucket {
  return {
    index: 0,
    value: 42,
    loss: 0,
    total: 4,
    lost: 0,
    startAt: 0,
    endAt: 3_600_000,
    ...partial,
  };
}

describe("ping bucket time labels", () => {
  it("formats bucket windows with the selected display time zone", () => {
    expect(formatPingBucketWindow(bucket(), "UTC")).toBe("00:00 - 01:00");
    expect(formatPingBucketWindow(bucket(), "Asia/Shanghai")).toBe("08:00 - 09:00");
  });

  it("includes the selected display time zone in health tooltips", () => {
    expect(formatHealthBucketTooltip(bucket({ value: null, total: 1, lost: 1 }), "latency", "Asia/Shanghai")).toBe(
      "08:00 - 09:00 · 失败",
    );
  });
});
