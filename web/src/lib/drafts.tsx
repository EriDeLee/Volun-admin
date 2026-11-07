import type { ProjectDraft, DraftChange } from "../types.ts";
import React, { createContext, useContext, useState } from "react";

interface DraftStore {
  drafts: Record<string, ProjectDraft>;
  update: (id: string, change: DraftChange) => void;
  reset: () => void;
}
const DraftContext = createContext<DraftStore | null>(null);
export const emptyDraft: ProjectDraft = {
  people: [],
  sessions: [],
  hours: {},
  material: null,
  saved: false,
};

// Deliberately scoped to the authenticated React tree; logout clears all drafts.
export function DraftProvider({ children }: { children: React.ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, ProjectDraft>>({});
  const update = (id: string, change: DraftChange) => {
    setDrafts((all) => {
      const previous = all[id] || emptyDraft;
      return {
        ...all,
        [id]:
          typeof change === "function"
            ? change(previous)
            : { ...previous, ...change },
      };
    });
  };
  return (
    <DraftContext.Provider
      value={{ drafts, update, reset: () => setDrafts({}) }}
    >
      {children}
    </DraftContext.Provider>
  );
}

export const useDraftStore = () => {
  const context = useContext(DraftContext);
  if (!context) throw new Error("DraftProvider is required");
  return context;
};

export function useDraft(
  id?: string | null,
): [ProjectDraft, (change: DraftChange) => void] {
  const context = useContext(DraftContext);
  if (!context) throw new Error("DraftProvider is required");
  return [
    (id ? context.drafts[id] : undefined) || emptyDraft,
    (change) => {
      if (id) context.update(id, change);
    },
  ];
}

export function downloadText(
  name: string,
  content: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(value: unknown) {
  const text = String(value ?? "");
  // Spreadsheet clients interpret formula prefixes even in quoted CSV cells.
  const safe = /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function exportCSV(name: string, rows: unknown[][]) {
  downloadText(
    name,
    "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
    "text/csv;charset=utf-8",
  );
}

export function escapeHTML(value: unknown) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      (
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }) as Record<string, string>
      )[c],
  );
}
