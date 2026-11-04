import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookingPrefs from "./CookingPrefs";
import { SessionContext, type User } from "../session";
import { fakeServer } from "../test/fakeServer";

// Settings › Profile › Cooking: measurements and keeping the screen awake, saved as you change them
const user = { id: 1, username: "cory", displayName: "Cory", email: null, role: "owner", units: "original", keepAwake: true } as User;

describe("cooking preferences", () => {
  it("measurements and Keep the screen awake save straight away", async () => {
    const s = fakeServer({ "PATCH /api/profile": (b: any) => ({ ...user, ...b }) });
    const setUser = vi.fn();
    const u = userEvent.setup();
    render(
      <SessionContext.Provider value={{ user, setUser, replaceToken: () => {}, signOut: () => {}, signOutEverywhere: async () => {} }}>
        <CookingPrefs />
      </SessionContext.Provider>,
    );
    await u.click(screen.getByRole("radio", { name: /Metric/ }));
    await waitFor(() => expect(s.writes().at(-1)).toMatchObject({ path: "/api/profile", body: { units: "metric" } }));
    await u.click(screen.getByRole("switch", { name: /Keep the screen awake/ }));
    await waitFor(() => expect(s.writes().at(-1)?.body).toEqual({ keepAwake: false }));
    expect(setUser).toHaveBeenLastCalledWith(expect.objectContaining({ keepAwake: false }));
  });
});
