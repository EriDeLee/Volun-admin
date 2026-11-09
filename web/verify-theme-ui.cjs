const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

(async () => {
  const output = path.join(os.tmpdir(), "volun-theme-ui");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    let authenticated = true;
    const user = { username: "admin", name: "平台管理员", id: "00001", groups: ["super_admin"], status: "active", has_password: true };
    await context.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname.endsWith("/auth/me")) {
        if (!authenticated) return route.fulfill({ status: 401, json: { errcode: 200001, message: "请先登录", data: null } });
        data = { user };
      } else if (url.pathname.endsWith("/admin/users")) data = { items: [user, { ...user, username: "student", name: "测试成员", id: "00123", groups: ["formal_user"] }], total: 2, page: 1, page_size: 20, summary: { user_count: 2, active_count: 2, disabled_count: 0, manager_count: 1 } };
      else throw new Error(`Unexpected API: ${url.pathname}`);
      await route.fulfill({ json: { errcode: 0, data } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const shot = async (name) => {
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow: ${name}`);
    };
    const theme = () => page.getAttribute("html", "data-theme");
    await page.goto("http://127.0.0.1:5173/users");
    await page.getByText("测试成员", { exact: true }).waitFor();
    assert.equal(await theme(), "dark");
    assert.equal(await page.getByRole("combobox", { name: "外观模式" }).inputValue(), "system");
    await shot("users-dark-desktop");
    await page.getByRole("button", { name: "添加成员", exact: true }).click();
    await shot("modal-dark-desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await shot("modal-dark-mobile");
    await page.getByRole("button", { name: "关闭弹窗" }).click();
    await shot("users-dark-mobile");
    await page.getByRole("combobox", { name: "外观模式" }).selectOption("light");
    assert.equal(await theme(), "light");
    await shot("users-light-mobile");
    await page.reload();
    await page.getByText("测试成员", { exact: true }).waitFor();
    assert.equal(await theme(), "light");
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await theme(), "light");
    await page.getByRole("combobox", { name: "外观模式" }).selectOption("system");
    assert.equal(await theme(), "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.getByRole("combobox", { name: "外观模式" }).selectOption("dark");
    const other = await context.newPage();
    await other.goto("http://127.0.0.1:5173/users");
    await other.getByText("测试成员", { exact: true }).waitFor();
    assert.equal(await other.getAttribute("html", "data-theme"), "dark");
    await other.getByRole("combobox", { name: "外观模式" }).selectOption("light");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await other.close();
    authenticated = false;
    await page.goto("http://127.0.0.1:5173/login");
    await page.getByRole("button", { name: "登录平台", exact: true }).waitFor();
    await page.getByRole("combobox", { name: "外观模式" }).selectOption("dark");
    await shot("login-dark-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot("login-dark-desktop");
    await page.goto("http://127.0.0.1:5173/signup?preview=1");
    await page.getByRole("button", { name: "完成填写预览", exact: true }).waitFor();
    await shot("signup-dark-desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await shot("signup-dark-mobile");
    assert.deepEqual(errors, []);
    console.log(`Verified appearance persistence, system changes, cross-tab synchronization, login, directory, modal and public form. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
