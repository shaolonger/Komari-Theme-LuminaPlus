import { describe, expect, it } from "vitest";
import {
  buildComparisonCsv,
  buildComparisonMarkdown,
  buildComparisonRanking,
  buildComparisonSeries,
  formatComparisonValue,
  prepareComparisonTrendData,
  type ComparisonNode,
  type ComparisonSeries,
} from "@/utils/vpsCompare";
import type { ComparisonLoadRecords } from "@/services/api";
import type { LoadRecord, PingRecord } from "@/types/komari";

const nodes: ComparisonNode[] = [
  { uuid: "a", name: "alpha", group: "edge", region: "US" },
  { uuid: "b", name: "beta", group: "edge", region: "JP" },
];

function loadRecord(partial: Partial<LoadRecord>): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time: 0,
    client: "",
    ...partial,
  };
}

describe("buildComparisonSeries", () => {
  it("extracts load metrics and ranks by p95 pressure", () => {
    const loadRecords: ComparisonLoadRecords = {
      a: [
        loadRecord({ client: "a", time: 1000, cpu: 10 }),
        loadRecord({ client: "a", time: 2000, cpu: 20 }),
      ],
      b: [
        loadRecord({ client: "b", time: 1000, cpu: 30 }),
        loadRecord({ client: "b", time: 2000, cpu: 40 }),
      ],
    };

    const series = buildComparisonSeries({ metricKey: "cpu", nodes, loadRecords });
    const ranking = buildComparisonRanking(series);

    expect(series[0].points.map((point) => point.value)).toEqual([10, 20]);
    expect(ranking.map((row) => row.uuid)).toEqual(["b", "a"]);
    expect(ranking[0].average).toBe(35);
  });

  it("derives memory percentage from used and total bytes", () => {
    const loadRecords: ComparisonLoadRecords = {
      a: [loadRecord({ client: "a", time: 1000, ram: 512, ram_total: 1024 })],
    };

    const series = buildComparisonSeries({ metricKey: "ram", nodes: nodes.slice(0, 1), loadRecords });

    expect(series[0].points[0].value).toBe(50);
  });

  it("aggregates ping latency and loss separately", () => {
    const pingRecords: PingRecord[] = [
      { client: "a", task_id: 1, time: 1000, value: 20 },
      { client: "a", task_id: 2, time: 1000, value: 40 },
      { client: "a", task_id: 1, time: 2000, value: -1 },
      { client: "b", task_id: 1, time: 1000, value: -1 },
      { client: "b", task_id: 2, time: 1000, value: 10 },
    ];

    const latency = buildComparisonSeries({ metricKey: "ping_latency", nodes, pingRecords });
    const loss = buildComparisonSeries({ metricKey: "ping_loss", nodes, pingRecords });

    expect(latency[0].points.map((point) => point.value)).toEqual([30]);
    expect(loss[0].points.map((point) => point.value)).toEqual([0, 100]);
    expect(loss[1].points.map((point) => point.value)).toEqual([50]);
  });
});

describe("prepareComparisonTrendData", () => {
  const trendSeries: ComparisonSeries[] = [
    {
      uuid: "a",
      name: "alpha",
      group: "edge",
      region: "US",
      points: [
        { time: 0, value: 20 },
        { time: 60, value: 24 },
      ],
    },
    {
      uuid: "b",
      name: "beta",
      group: "edge",
      region: "JP",
      points: [
        { time: 30, value: 120 },
        { time: 90, value: 128 },
      ],
    },
  ];

  it("buckets off-phase ping samples onto a shared time grid", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: trendSeries,
      hours: 1,
      start: 0,
      end: 120,
    });

    expect(trend.bucketSeconds).toBe(60);
    expect(trend.times).toEqual([0, 60, 120]);
    expect(trend.valuesBySeries[0]).toEqual([20, 24, undefined]);
    expect(trend.valuesBySeries[1]).toEqual([120, 128, undefined]);
  });

  it("keeps real long ping gaps as chart breaks", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: [
        {
          uuid: "a",
          name: "alpha",
          group: "",
          region: "",
          points: [
            { time: 0, value: 20 },
            { time: 60, value: 21 },
            { time: 600, value: 30 },
          ],
        },
      ],
      hours: 1,
      start: 0,
      end: 660,
    });

    expect(trend.valuesBySeries[0]).toContain(null);
  });

  it("lightly smooths dense ping jitter without changing raw ranking samples", () => {
    const trend = prepareComparisonTrendData({
      metricKey: "ping_latency",
      series: [
        {
          uuid: "a",
          name: "alpha",
          group: "",
          region: "",
          points: [
            { time: 0, value: 200 },
            { time: 60, value: 320 },
            { time: 120, value: 210 },
            { time: 180, value: 310 },
            { time: 240, value: 205 },
          ],
        },
      ],
      hours: 1,
      start: 0,
      end: 300,
    });

    expect(trend.smoothWindow).toBeGreaterThan(1);
    expect(trend.rawSamples).toBe(5);
    expect(trend.valuesBySeries[0][1]).toBeLessThan(320);
  });
});

describe("comparison export helpers", () => {
  it("formats values for display and exports ranking rows", () => {
    const rows = [
      {
        uuid: "a",
        name: "alpha, one",
        group: "edge",
        region: "US",
        samples: 2,
        average: 12.3456,
        min: 10,
        max: 20,
        p95: 19.5,
        latest: 20,
      },
    ];

    expect(formatComparisonValue("cpu", 12.3456)).toBe("12.3%");
    expect(buildComparisonCsv(rows, "cpu")).toContain('"alpha, one"');
    expect(buildComparisonMarkdown(rows, "cpu")).toContain("VPS 对比 - CPU 使用率");
  });
});
