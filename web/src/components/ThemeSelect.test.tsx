import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeSelect from "./ThemeSelect.tsx";

let dark = true;
let changes: EventTarget;
beforeEach(() => {
  localStorage.clear();
  dark = true;
  changes = new EventTarget();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: changes.addEventListener.bind(changes),
    removeEventListener: changes.removeEventListener.bind(changes),
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("color-scheme");
});
const systemChange = (next: boolean) =>
  act(() => {
    dark = next;
    changes.dispatchEvent(new Event("change"));
  });

test("defaults to the system and reacts to system appearance changes without storing a preference", () => {
  render(<ThemeSelect />);
  expect(
    (screen.getByRole("combobox", { name: "外观模式" }) as HTMLSelectElement)
      .value,
  ).toBe("system");
  expect(document.documentElement.dataset.theme).toBe("dark");
  systemChange(false);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.length).toBe(0);
});

test("explicit appearance persists across mounts and takes precedence over the system", async () => {
  const view = render(<ThemeSelect />);
  await userEvent.selectOptions(screen.getByRole("combobox"), "light");
  expect(localStorage.getItem("volun.theme")).toBe("light");
  systemChange(true);
  expect(document.documentElement.dataset.theme).toBe("light");
  view.unmount();
  render(<ThemeSelect />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "light",
  );
  await userEvent.selectOptions(screen.getByRole("combobox"), "dark");
  systemChange(false);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await userEvent.selectOptions(screen.getByRole("combobox"), "system");
  expect(document.documentElement.dataset.theme).toBe("light");
});

test("another tab's preference updates the current page", () => {
  render(<ThemeSelect />);
  act(() => {
    localStorage.setItem("volun.theme", "light");
    globalThis.dispatchEvent(
      new StorageEvent("storage", { key: "volun.theme", newValue: "light" }),
    );
  });
  expect(document.documentElement.dataset.theme).toBe("light");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
    "light",
  );
});

test("storage restrictions still allow switching for the current session", async () => {
  render(<ThemeSelect />);
  const blocked = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("storage unavailable");
    });
  await userEvent.selectOptions(screen.getByRole("combobox"), "dark");
  systemChange(false);
  expect(document.documentElement.dataset.theme).toBe("dark");
  blocked.mockRestore();
  await userEvent.selectOptions(screen.getByRole("combobox"), "system");
  expect(document.documentElement.dataset.theme).toBe("light");
});
