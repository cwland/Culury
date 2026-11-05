import { useState } from "react";
import { api } from "../api";
import { useSession, type User } from "../session";
import { Card, Notice, Toggle } from "./settingsUi";

// Settings › Recipes › Cooking: how amounts show to start with, and whether Cook mode keeps the
// screen awake. Each person's own; saved as you change them.
export default function CookingPrefs() {
  const { user, setUser } = useSession();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (change: Partial<Pick<User, "units" | "keepAwake">>) => {
    setMsg(null);
    try {
      setUser(await api<User>("PATCH", "/api/profile", change));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const units = user.units ?? "original";
  const choice = (value: "original" | "metric" | "us", title: string, hint: string) => (
    <label className={`flex cursor-pointer flex-col rounded-xl border-2 px-3 py-2 ${units === value ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
      <input type="radio" name="cooking-units" aria-label={`${title}: ${hint}`} checked={units === value} onChange={() => void save({ units: value })} className="sr-only" />
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-subtle">{hint}</span>
    </label>
  );
  return (
    <Card title="Cooking" description="How recipes open for you.">
      <p className="mt-3 text-sm font-semibold text-subtle">Measurements</p>
      <div role="radiogroup" aria-label="Measurements" className="mt-1 grid max-w-lg grid-cols-3 gap-2">
        {choice("original", "As is", "The way it was written")}
        {choice("metric", "Metric", "Grams, millilitres, °C")}
        {choice("us", "US", "Cups, ounces, °F")}
      </div>
      <div className="mt-4 flex items-start justify-between gap-6">
        <p className="text-sm">
          <span className="font-semibold">Keep the screen awake in Cook mode</span>
          <span className="block text-subtle">Your phone or tablet won't go to sleep while you cook step by step (on https:// addresses).</span>
        </p>
        <Toggle label="Keep the screen awake in Cook mode" checked={user.keepAwake ?? true} onChange={(v) => void save({ keepAwake: v })} />
      </div>
      <p className="mt-2">
        <Notice msg={msg} />
      </p>
    </Card>
  );
}
