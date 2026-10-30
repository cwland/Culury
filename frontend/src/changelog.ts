// "What's new": one entry per version, newest first. Add an entry (and bump "version" in
// package.json) with each release; everyone sees it once after signing in, and any time from the
// version number in the bottom left.
export interface Release {
  version: string;
  date: string; // YYYY-MM-DD
  title?: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.1.0",
    date: "2026-10-30",
    title: "First version",
    changes: [
      "Culury's foundation: sign in with a password, passkeys (Touch ID, Face ID, Windows Hello) or OAuth / OpenID Connect (Authentik, Authelia, Google, GitHub…).",
      "Signed-in devices with per-device sign out, sign-in history, and password reset by email or from the server.",
      "API keys with an access type: Read only, Write only, Recipe push, Grocery list write or Full admin.",
      "AI services (OpenAI, Claude, Gemini, OpenRouter, or a home AI like Ollama), with backups that take over when one is down.",
      "Email (SMTP) settings with a test email, Logs, daily backups with restore, and a bar when a new version is out.",
      "Five color themes and light or dark mode, in Settings › Profile › Appearance.",
      "Recipes, the meal plan, grocery lists and the pantry are coming next.",
    ],
  },
];

// "0.10.0" > "0.9.2"
export function isNewer(a: string, b: string | null | undefined) {
  if (!b) return true;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
