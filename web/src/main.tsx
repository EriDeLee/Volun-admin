import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applyTheme } from "./lib/theme.ts";

applyTheme();
createRoot(document.getElementById("root")!).render(<App />);
