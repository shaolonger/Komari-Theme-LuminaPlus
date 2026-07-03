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
});
