import type { PingOverviewBucket } from "@/types/komari";
import { trimFixed } from "@/utils/format";
import { formatClockTime, type DisplayTimeZone } from "@/utils/timeDisplay";

export function formatPingBucketWindow(
  bucket: PingOverviewBucket | null,
  displayTimeZone?: DisplayTimeZone,
) {
  if (!bucket || bucket.startAt == null || bucket.endAt == null) {
    return null;
  }

  const startText = formatClockTime(bucket.startAt, displayTimeZone);
  const endText = formatClockTime(bucket.endAt, displayTimeZone);
  return `${startText} - ${endText}`;
}

export function formatLatencyBucketSummary(bucket: PingOverviewBucket | null) {
  if (!bucket) return "—";
  if (bucket.value != null) return `${trimFixed(bucket.value, 1)} ms`;
  return bucket.total > 0 ? "失败" : "无样本";
}

export function formatLossBucketSummary(
  bucket: PingOverviewBucket | null,
  separator = " ",
) {
  if (!bucket) return "—";
  if (bucket.total <= 0 || bucket.loss == null) return "无样本";
  return `${trimFixed(bucket.loss, 1)}%${separator}${bucket.lost}/${bucket.total}`;
}

export function formatHealthBucketTooltip(
  bucket: PingOverviewBucket,
  kind: "latency" | "loss",
  displayTimeZone?: DisplayTimeZone,
) {
  const window = formatPingBucketWindow(bucket, displayTimeZone);
  const summary =
    kind === "latency"
      ? formatLatencyBucketSummary(bucket)
      : formatLossBucketSummary(bucket, " · ");
  return window ? `${window} · ${summary}` : summary;
}
