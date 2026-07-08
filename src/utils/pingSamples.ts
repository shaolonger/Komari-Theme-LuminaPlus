/**
 * Ping samples only have a usable RTT when the probe receives a reply.
 * Komari's historical records use non-positive values as timeout/loss sentinels,
 * so zero is not a valid latency sample here.
 */
export function isValidPingLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isLostPingSample(value: unknown): boolean {
  return !isValidPingLatency(value);
}
