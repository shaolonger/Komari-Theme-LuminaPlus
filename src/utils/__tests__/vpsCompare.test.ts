import { describe, expect, it } from "vitest";
import {
  buildComparisonCsv,
  buildComparisonMarkdown,
  buildComparisonRanking,
  buildComparisonSeries,
  formatComparisonValue,
  type ComparisonNode,
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
