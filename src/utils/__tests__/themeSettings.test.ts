import { describe, expect, it } from "vitest";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
  it("defaults desktop and mobile node cards to the compact scanning view", () => {
    expect(normalizeThemeSettings({}).desktopNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({}).mobileNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({ desktopNodeViewMode: "large" }).desktopNodeViewMode).toBe(
      "large",
    );
  });

  it("defaults overview ratings on unless explicitly disabled", () => {
    expect(normalizeThemeSettings({}).showOverviewRatings).toBe(true);
    expect(normalizeThemeSettings({ showOverviewRatings: false }).showOverviewRatings).toBe(false);
  });

  it("keeps a node bound to multiple homepage Ping tasks", () => {
    expect(
      normalizeThemeSettings({
        homepagePingBindings: {
          7: ["node-a", "node-b"],
          3: ["node-a"],
          bad: ["ignored"],
        },
      }).homepagePingBindings,
    ).toEqual({
      3: ["node-a"],
      7: ["node-a", "node-b"],
    });
  });

  it("normalizes advanced homepage Ping settings safely", () => {
    const settings = normalizeThemeSettings({
      homepagePingBindings: {
        7: ["node-a", "node-b"],
        3: ["node-a"],
      },
      homepagePingAggregationStrategy: "primary",
      homepagePingPrimaryTasks: {
        "node-a": 3,
        "node-b": 3,
        "node-c": 7,
      },
      homepagePingTaskGroups: {
        3: " 全球 ",
        7: "美国",
        bad: "ignored",
      },
    });

    expect(settings.homepagePingAggregationStrategy).toBe("primary");
    expect(settings.homepagePingPrimaryTasks).toEqual({ "node-a": 3 });
    expect(settings.homepagePingTaskGroups).toEqual({ 3: "全球", 7: "美国" });
  });

  it("defaults invalid homepage Ping strategy back to worst-first", () => {
    expect(
      normalizeThemeSettings({ homepagePingAggregationStrategy: "fastest" as never })
        .homepagePingAggregationStrategy,
    ).toBe("worst");
  });
});
