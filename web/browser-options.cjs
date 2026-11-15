const { chromium } = require("playwright-core");
const { existsSync } = require("node:fs");
const path = require("node:path");

const baseURL = process.env.BASE_URL || "http://127.0.0.1:5173";

async function launchBrowser() {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH;
  if (executablePath) {
    if (!existsSync(executablePath)) {
      throw new Error(
        `BROWSER_EXECUTABLE_PATH does not exist: ${executablePath}`,
      );
    }
    return chromium.launch({ executablePath, headless: true });
  }
  if (process.env.BROWSER_CHANNEL) {
    return chromium.launch({
      channel: process.env.BROWSER_CHANNEL,
      headless: true,
    });
  }
  const candidates = [
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...[
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]
      .filter(Boolean)
      .flatMap((directory) => [
        path.join(directory, "Microsoft/Edge/Application/msedge.exe"),
        path.join(directory, "Google/Chrome/Application/chrome.exe"),
      ]),
  ];
  const installed = candidates.find((candidate) => existsSync(candidate));
  if (!installed) {
    throw new Error(
      "No Chromium browser found. Set BROWSER_EXECUTABLE_PATH or BROWSER_CHANNEL, or run: yarn exec playwright-core install chromium",
    );
  }
  return chromium.launch({ executablePath: installed, headless: true });
}

module.exports = { baseURL, launchBrowser };
