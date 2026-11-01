import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SendToCulury } from "./SendToCulury";

describe("Send to Culury (Settings › Recipes)", () => {
  it("a bookmark to drag to the bookmarks bar, for this Culury, and how to use it", () => {
    render(<SendToCulury />);
    const card = screen.getByRole("region", { name: "Send to Culury" });
    const link = within(card).getByRole("link", { name: "Send to Culury" });
    expect(link.getAttribute("href")).toMatch(/^javascript:/);
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain(`var C="${window.location.origin}"`);
    expect(card).toHaveTextContent("Drag");
    expect(card).toHaveTextContent("security check");
    expect(within(card).getByRole("button", { name: "Copy the bookmark" })).toBeInTheDocument();
  });
});
