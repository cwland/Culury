import { describe, expect, it } from "vitest";
import { parseMinutes, parseServings } from "./recipes";

describe("editor numbers", () => {
  it("servings", () => {
    expect(["4", "4.5", "2-3", "2 to 3", "four", "Serves 6", "", "lots"].map(parseServings)).toEqual([4, 5, 2, 2, 4, 6, null, undefined]);
  });
  it("minutes", () => {
    expect(["90", "1 hr", "1 hour 15 min", "1:30", "1.5 hours", "45m", "an hour", "an hour and a half", "2h 10m", "", "soon"].map(parseMinutes)).toEqual([90, 60, 75, 90, 90, 45, 60, 90, 130, null, undefined]);
  });
});

describe("times as recipe cards write them", () => {
  it("fractions of an hour", () => {
    expect(parseMinutes("1 1/2 hours")).toBe(90);
    expect(parseMinutes("1½ hours")).toBe(90);
    expect(parseMinutes("3/4 hour")).toBe(45);
  });
  it("a range plans for the longer time", () => {
    expect(parseMinutes("30-40 minutes")).toBe(40);
    expect(parseMinutes("1 to 2 hours")).toBe(120);
  });
  it("plural abbreviations", () => {
    expect(parseMinutes("2 hrs 30 mins")).toBe(150);
  });
  it("words that aren't an amount of time are pointed out, not saved as nothing", () => {
    expect(parseMinutes("overnight")).toBeUndefined();
    expect(parseMinutes("until golden")).toBeUndefined();
  });
});
