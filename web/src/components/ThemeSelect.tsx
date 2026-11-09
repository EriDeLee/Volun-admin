import { useTheme, type ThemePreference } from "../lib/theme.ts";

export default function ThemeSelect({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { mode, resolved, setMode } = useTheme();
  return (
    <label
      className={`theme-select${standalone ? " theme-standalone" : ""}`}
      title="外观：亮色、暗色或跟随系统"
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        {mode === "system" ? (
          <>
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8m-4-4v4" />
          </>
        ) : resolved === "dark" ? (
          <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        )}
      </svg>
      <select
        aria-label="外观模式"
        value={mode}
        onChange={(e) => setMode(e.target.value as ThemePreference)}
      >
        <option value="light">亮色</option>
        <option value="dark">暗色</option>
        <option value="system">跟随系统</option>
      </select>
    </label>
  );
}
