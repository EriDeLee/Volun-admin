// Optional isolated browser check. PLAYWRIGHT_MODULE and EDGE_PATH allow local tooling.
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const output =
  process.env.WORKSPACE_CHECK_OUTPUT || path.join(__dirname, "browser-check");
const origin = process.env.WORKSPACE_CHECK_ORIGIN || "http://localhost:5173";
const session = {
  user: {
    name: "测试负责人",
    username: "manager",
    id: "001234",
    sub: "private-browser-sub",
    groups: ["activity_admin"],
  },
  auth_method: "session",
};
const p = {
  id: "p1",
  code: "ZY-20261108-TEST",
  name: "校园开放日志愿服务",
  department: "校青年志愿者协会",
  owner_name: "测试负责人",
  starts_on: "2026-11-08",
  ends_on: "2026-11-09",
  status: "立项",
  location: "沙河校区 · 主楼及校园开放区域",
  description:
    "为来访人员提供校园参观引导、现场接待和咨询服务，活动后人工核对实际服务情况。",
  created_at: "2026-11-08T00:00:00Z",
  updated_at: "2026-11-08T00:00:00Z",
};
const summary = {
  project_count: 2,
  recruiting_count: 1,
  pending_count: 2,
  recognized_hours: null,
};
const projects = [
  p,
  {
    ...p,
    id: "p2",
    code: "ZY-20261108-TEST02",
    name: "社区数字助老行动",
    status: "招募",
    department: "计算机学院",
  },
];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath:
      process.env.EDGE_PATH ||
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/v1/**", async (route) => {
      const u = new URL(route.request().url());
      let data;
      if (u.pathname.endsWith("/auth/me") || u.pathname.endsWith("/auth/login"))
        data = session;
      else if (u.pathname.endsWith("/auth/logout")) data = {};
      else if (u.pathname.endsWith("/dashboard"))
        data = {
          summary,
          recent_projects: projects,
          tasks: [
            {
              project_id: "p1",
              project_name: p.name,
              status: "立项",
              instruction: "核对基础信息，准备立项申请材料。",
            },
          ],
          stages: [
            { status: "立项", count: 1 },
            { status: "招募", count: 1 },
          ],
          generated_at: new Date().toISOString(),
        };
      else if (u.pathname.endsWith("/projects")) {
        if (route.request().method() === "POST")
          data = { ...p, ...route.request().postDataJSON() };
        else {
          const q = u.searchParams.get("q") || "";
          const items = projects.filter((item) =>
            `${item.name}${item.code}`.includes(q),
          );
          data = {
            summary,
            items,
            total: items.length,
            page: 1,
            page_size: 20,
            departments: projects.map((item) => item.department),
          };
        }
      } else if (/\/projects\/p[12]$/.test(u.pathname))
        data = projects.find((item) => u.pathname.endsWith(item.id));
      else throw new Error("Unexpected API: " + u.pathname);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errcode: 0,
          data,
          message: "ok",
          request_id: "isolated-browser-test",
        }),
      });
    });

    const layouts = [];
    for (const [name, url, heading] of [
      ["dashboard", "/activity", "活动管理工作台"],
      ["ledger", "/projects", "项目台账"],
      ["detail", "/projects/p1", p.name],
      ["recruit", "/projects/p1?tab=recruit", "志愿者名单"],
      ["hours-empty", "/hours?project=p1", "时长登记"],
      ["materials", "/materials?project=p1", "项目材料"],
      ["signup", "/signup?preview=1", "填写报名信息"],
    ]) {
      await page.goto(origin + url);
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      // Wait for async selected project information rather than checking the initial empty shell.
      if (["hours-empty", "materials"].includes(name))
        await page
          .getByText(p.name + " ·", { exact: false })
          .first()
          .waitFor();
      for (const width of [1440, 1024, 768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(
          dimensions.scroll <= dimensions.width,
          `${name}: ${JSON.stringify(dimensions)}`,
        );
        await page.screenshot({
          path: path.join(output, `${name}-${width}.png`),
          fullPage: true,
        });
        layouts.push({ page: name, ...dimensions });
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/projects/p1");
    await page.getByRole("button", { name: "添加场次草稿" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("场次名称").fill("开放日 · 第一场");
    await dialog.getByLabel("岗位安排").fill("现场引导 / 来访接待");
    await dialog.getByLabel("开始时间").fill("2026-11-08T08:00");
    await dialog.getByLabel("结束时间").fill("2026-11-08T12:00");
    await dialog.getByLabel("计划人数").fill("24");
    await dialog.getByRole("button", { name: "添加场次草稿" }).click();
    await page.getByRole("tab", { name: "招募登记", exact: true }).click();
    await page.getByRole("button", { name: "添加志愿者", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("姓名").fill("测试志愿者");
    await dialog.getByLabel("学号 / 人员编号").fill("001234");
    await dialog.getByLabel("学院 / 部门").fill("计算机学院");
    await dialog.getByLabel("服务岗位").fill("现场引导");
    await dialog
      .getByLabel("参与场次")
      .selectOption({ label: "开放日 · 第一场" });
    await dialog.getByRole("button", { name: "添加到草稿" }).click();
    await page.getByRole("tab", { name: "计时与时长" }).click();
    await page.getByLabel("测试志愿者的拟计时长").fill("4");
    await page.getByRole("button", { name: "保留会话草稿" }).click();
    await page
      .getByText("时长草稿已保留在本次会话中", { exact: false })
      .waitFor();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: path.join(output, `hours-filled-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "返回项目详情" }).click();
    await page.getByRole("tab", { name: "材料", exact: true }).click();
    await page.getByLabel("活动负责人").fill("测试负责人");
    await page.getByRole("checkbox", { name: "校内师生" }).check();
    await page
      .getByLabel("组织保障与安全措施")
      .fill("开展岗位培训，设置现场联络点与应急处置安排。");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载版式草稿" }).click();
    const download = await downloading;
    const file = path.join(output, "material-draft.html");
    await download.saveAs(file);
    assert(fs.readFileSync(file, "utf8").includes("测试负责人"));
    await page.getByRole("button", { name: "展开导航" }).click();
    await page.getByRole("link", { name: "项目台账", exact: true }).click();
    await page
      .getByRole("heading", { name: "项目台账", exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "收起导航" }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          layouts,
          errors,
          interactions: [
            "session restore",
            "mobile menu",
            "session/recruit/hour draft",
            "material download",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      `Passed ${layouts.length} page/viewport checks, draft flow, mobile navigation and HTML export. Screenshots: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
