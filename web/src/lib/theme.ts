import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
const storageKey = "volun.theme";
const changeEvent = "volun-theme-change";

function preference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* The theme also works when browser storage is unavailable. */
  }
  return "system";
}

function systemTheme(): "light" | "dark" {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme() {
  const mode = currentPreference();
  const resolved = mode === "system" ? systemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#101722" : "#f5f7fb");
  return `${mode}:${resolved}`;
}

// A shared subscription keeps every header in sync, including other browser tabs.
function subscribe(onChange: () => void) {
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  const update = () => {
    applyTheme();
    onChange();
  };
  applyTheme();
  media?.addEventListener("change", update);
  globalThis.addEventListener("storage", update);
  globalThis.addEventListener(changeEvent, update);
  return () => {
    media?.removeEventListener("change", update);
    globalThis.removeEventListener("storage", update);
    globalThis.removeEventListener(changeEvent, update);
  };
}

let memoryPreference: ThemePreference | undefined;
function currentPreference() {
  return memoryPreference ?? preference();
}

function snapshot() {
  const mode = currentPreference();
  return `${mode}:${mode === "system" ? systemTheme() : mode}`;
}

export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot);
  const [mode, resolved] = value.split(":") as [
    ThemePreference,
    "light" | "dark",
  ];
  return {
    mode,
    resolved,
    setMode: (next: ThemePreference) => {
      try {
        localStorage.setItem(storageKey, next);
        memoryPreference = undefined;
      } catch {
        memoryPreference = next;
      }
      const resolved = next === "system" ? systemTheme() : next;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      globalThis.dispatchEvent(new Event(changeEvent));
    },
  };
}
