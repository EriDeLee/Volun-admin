const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { launchBrowser } = require("./browser-options.cjs");
const { checkComponents } = require("./check-components.cjs");

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4175";
const output = path.join(__dirname, "browser-check");

async function startServer() {
  if (process.env.BASE_URL) return null;
  const server = spawn(
    process.execPath,
    [
      path.join(
        path.dirname(require.resolve("vite/package.json")),
        "bin/vite.js",
      ),
      "--host",
      "127.0.0.1",
      "--port",
      "4175",
      "--strictPort",
    ],
    { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  server.stdout.on("data", (data) => {
    log += data;
  });
  server.stderr.on("data", (data) => {
    log += data;
  });
  let failure;
  server.on("error", (error) => {
    failure = error;
  });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      if (server.exitCode !== null) throw new Error(`Vite exited: ${log}`);
      try {
        if ((await fetch(baseURL, { signal: AbortSignal.timeout(500) })).ok)
          return server;
      } catch {
        /* Vite is still starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Vite did not become ready: ${log}`);
  } catch (error) {
    server.kill();
    throw error;
  }
}

async function checkWorkspace(browser) {
  await fs.mkdir(output, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const projects = [
    { id: "p1", name: "校园开放日志愿引导", status: "招募" },
    { id: "p2", name: "图书馆周末服务", status: "进行" },
    {
      id: "p3",
      name: "社区科普活动与志愿服务协作项目（长名称换行检查）",
      status: "立项",
    },
  ].map((project, index) => ({
    ...project,
    code: `ZY-20261115-00${index}`,
    department: "校团委",
    owner_name: "李同学",
    starts_on: "2026-11-15",
    ends_on: "2026-11-16",
    location: "学院路校区志愿服务中心",
    approval: "approved",
  }));
  const summary = {
    project_count: 3,
    recruiting_count: 1,
    pending_count: 2,
    recognized_hours: null,
  };
  let failNext = false;
  let holdNext = false;
  let release;
  await context.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data;
    if (url.pathname.endsWith("/auth/me")) {
      data = {
        user: {
          name: "平台管理员",
          username: "admin",
          id: "00001",
          phone: "13800138000",
          groups: ["super_admin"],
        },
      };
    } else if (url.pathname.endsWith("/projects")) {
      if (failNext) {
        failNext = false;
        return route.fulfill({
          status: 503,
          json: { errcode: 500001, message: "暂时无法连接服务，请重试。" },
        });
      }
      if (holdNext) {
        holdNext = false;
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      const query = url.searchParams.get("q") || "";
      const status = url.searchParams.get("status");
      const items = projects.filter(
        (p) => p.name.includes(query) && (!status || p.status === status),
      );
      data = {
        items,
        summary,
        total: items.length,
        page: 1,
        page_size: 20,
        departments: ["校团委"],
      };
    } else if (url.pathname.endsWith("/dashboard")) {
      data = { summary, tasks: [], stages: [], recent_projects: projects };
    } else {
      throw new Error(`Unexpected API: ${url.pathname}`);
    }
    await route.fulfill({ json: { errcode: 0, data } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const shot = async (name) => {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Page overflow: ${name}`,
    );
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  };
  const project = () =>
    page.getByRole("button", { name: projects[0].name, exact: true });
  const all = () =>
    page.getByRole("checkbox", { name: "选择当前页全部项目", exact: true });
  const exportButton = () =>
    page.getByRole("button", { name: /^导出所选/ }).first();

  holdNext = true;
  await page.goto(`${baseURL}/projects`);
  await page.getByText("正在读取项目台账…", { exact: true }).waitFor();
  assert.equal(await page.getByText("共 0 个项目", { exact: true }).count(), 0);
  await shot("ledger-loading");
  release();
  await project().waitFor();
  assert.equal(await exportButton().isDisabled(), true);
  await page
    .getByRole("checkbox", { name: `选择${projects[0].name}`, exact: true })
    .check();
  assert.equal(await all().evaluate((input) => input.indeterminate), true);
  const downloadEvent = page.waitForEvent("download");
  await exportButton().click();
  const download = await downloadEvent;
  const csv = await fs.readFile(await download.path(), "utf8");
  assert.ok(csv.includes(projects[0].name));
  assert.ok(!csv.includes(projects[1].name));
  await shot("ledger-desktop-light");

  await page
    .getByRole("textbox", { name: "搜索项目名称或编号" })
    .fill("无匹配");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.getByRole("heading", { name: "没有符合条件的项目" }).waitFor();
  assert.equal(await exportButton().isDisabled(), true);
  await shot("ledger-filter-empty");
  await page
    .getByRole("button", { name: "清除筛选", exact: true })
    .last()
    .click();
  await project().waitFor();
  assert.equal(
    await page
      .getByRole("textbox", { name: "搜索项目名称或编号" })
      .inputValue(),
    "",
  );

  failNext = true;
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await page.getByRole("heading", { name: "台账暂时无法读取" }).waitFor();
  await shot("ledger-error");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await project().waitFor();

  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await project().waitFor();
    if (width <= 760) {
      await page.getByRole("list", { name: "项目列表" }).waitFor();
      assert.equal(
        await page.getByRole("list", { name: "项目列表" }).count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "详情", exact: true })
          .first()
          .isVisible(),
        true,
      );
    }
    await shot(`ledger-light-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "展开导航" });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "主导航", exact: true });
  await drawer.waitFor();
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  assert.equal(
    await drawer.evaluate(
      (element) => getComputedStyle(element, "::backdrop").overscrollBehavior,
    ),
    "contain",
  );
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await drawer.evaluate(
        (element) =>
          element.contains(document.activeElement) ||
          document.activeElement === document.body,
      ),
      true,
    );
  }
  await shot("navigation-mobile");
  await page.keyboard.press("Escape");
  assert.equal(
    await menu.evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await menu.click();
  await drawer.getByRole("link", { name: "工作台", exact: true }).click();
  await page
    .getByRole("heading", { name: "活动管理工作台", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("dialog", { name: "主导航" }).count(), 0);
  await shot("dashboard-mobile");

  await menu.click();
  await page
    .getByRole("dialog", { name: "主导航" })
    .getByRole("link", { name: "个人信息", exact: true })
    .click();
  await page.getByRole("heading", { name: "个人信息", exact: true }).waitFor();
  await shot("profile-mobile");
  await page.goto(`${baseURL}/projects`);
  await project().waitFor();
  await page.getByRole("combobox", { name: "外观模式" }).selectOption("dark");
  await shot("ledger-mobile-dark");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("table", { name: "项目台账", exact: true }).waitFor();
  await shot("ledger-desktop-dark");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "新建志愿服务项目" });
  await modal.waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await modal.count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await launchBrowser();
    await checkWorkspace(browser);
    await checkComponents(browser, baseURL, output);
    console.log(`Workspace checks passed. Mock API screenshots: ${output}`);
  } finally {
    await browser?.close();
    if (server) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
