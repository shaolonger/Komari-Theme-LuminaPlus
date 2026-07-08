import { describe, expect, it } from "vitest";
import { isLostPingSample, isValidPingLatency } from "@/utils/pingSamples";

describe("ping sample predicates", () => {
  it("only treats finite positive RTT values as successful ping latency", () => {
    expect(isValidPingLatency(0.1)).toBe(true);
    expect(isValidPingLatency(1)).toBe(true);
    expect(isValidPingLatency(0)).toBe(false);
    expect(isValidPingLatency(-1)).toBe(false);
    expect(isValidPingLatency(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidPingLatency(null)).toBe(false);
  });

  it("treats zero, negative and non-finite samples as packet loss", () => {
    expect(isLostPingSample(0)).toBe(true);
    expect(isLostPingSample(-1)).toBe(true);
    expect(isLostPingSample(Number.NaN)).toBe(true);
    expect(isLostPingSample(12)).toBe(false);
  });
});
