import { useState, type FormEvent } from "react";
import { api, downloadFile, getToken } from "../../api";
import { Popup } from "../Popup";

// Open a server page (with the sign-in) in a new tab and print it: the print dialog's
// "Save as PDF" makes the PDF. The tab is opened first, so the click isn't treated as a pop-up.
export async function printPage(path: string) {
  const w = window.open("", "_blank");
  const token = getToken();
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const html = await res.text();
  if (!w) throw new Error("Allow pop-ups for this site to print");
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => (w.focus(), w.print());
  if (w.document.readyState === "complete") setTimeout(go, 300);
  else w.addEventListener("load", () => setTimeout(go, 100));
}

export default function ShareDialog({ recipe, onClose }: { recipe: { id: number; title: string }; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ sent: number }>("POST", `/api/recipes/${recipe.id}/email`, { to, ...(note.trim() ? { note } : {}) });
      setMsg({ ok: true, text: `Sent to ${r.sent === 1 ? to.trim() : `${r.sent} people`}.` });
      setTo("");
      setNote("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action focus:ring-2 focus:ring-action/15";
  const other = "flex flex-col items-start gap-0.5 rounded-xl border border-line px-4 py-3 text-left hover:bg-pressed";
  return (
    <Popup title={`Share ${recipe.title}`} onClose={onClose}>
      <div className="flex flex-col gap-5 p-5">
        <form onSubmit={send} className="flex flex-col gap-3">
          <h3 className="font-bold">Email it</h3>
          <label className="text-sm font-semibold text-subtle">
            To
            <input type="text" inputMode="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="mom@example.com (commas for more)" className={field} />
          </label>
          <label className="text-sm font-semibold text-subtle">
            Note <span className="font-normal">(optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="We loved this one!" className={field} />
          </label>
          <button type="submit" disabled={busy || !to.trim()} className="self-start rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
            {busy ? "Sending…" : "Send"}
          </button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-error"}>{msg.text}</p>}
        </form>
        <div className="grid gap-2 border-t border-line pt-4 sm:grid-cols-2">
          <button type="button" className={other} onClick={() => void printPage(`/api/recipes/${recipe.id}/print`).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}>
            <strong>Print or save as PDF</strong>
            <span className="text-sm text-subtle">A clean page; choose “Save as PDF” to keep a file</span>
          </button>
          <button type="button" className={other} onClick={() => void downloadFile(`/api/recipes/${recipe.id}/jsonld`).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}>
            <strong>Download recipe file</strong>
            <span className="text-sm text-subtle">schema.org JSON-LD, which other recipe apps import</span>
          </button>
        </div>
      </div>
    </Popup>
  );
}
