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
