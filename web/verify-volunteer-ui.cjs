const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const output = path.join(os.tmpdir(), "volun-volunteer-ui");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const user = { name: "测试同学", id: "001234", username: "student", phone: "", groups: ["formal_user"] };
    const project = { id: "p1", code: "ZY-001", name: "校园开放日志愿服务", department: "校团委", starts_on: "2026-11-12", ends_on: "2026-11-13", location: "学院路校区", description: "为来访师生提供咨询与引导，一起让校园更有温度。", status: "招募" };
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname.endsWith("/auth/me")) data = { user };
      else if (url.pathname.endsWith("/volunteer/projects")) data = { items: [
        { project, form_id: "f1", deadline: "2026-11-11T18:00:00+08:00", registered: false, participated: false, recognized_hours: null },
        { project: { ...project, id: "p2", name: "图书馆整理服务" }, form_id: "", deadline: "", registered: true, participated: true, recognized_hours: 3 },
        { project: { ...project, id: "p3", name: "社区便民服务" }, form_id: "f3", deadline: "", registered: true, participated: false, recognized_hours: null },
      ] };
      else if (url.pathname.endsWith("/auth/phone")) { user.phone = route.request().postDataJSON().phone; data = { user }; }
      else if (url.pathname.endsWith("/forms/f1")) data = { project: project.name, kind: "recruit", form: { id: "f1", published: true, description: "选择参加场次和岗位。" }, sessions: [] };
      else if (url.pathname.endsWith("/me")) return route.fulfill({ status: 403, json: { errcode: 200002, message: "尚未报名", data: null } });
      else throw new Error(`Unexpected API ${url.pathname}`);
      return route.fulfill({ json: { errcode: 0, data } });
    });
    const shot = async (name) => {
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
    };
    await page.goto("http://127.0.0.1:5173/recruitment");
    await page.getByRole("heading", { name: project.name }).waitFor();
    await shot("recruitment-desktop");
    await page.getByRole("button", { name: "完善资料后报名" }).click();
    await page.getByRole("heading", { name: "个人信息", exact: true }).waitFor();
    await page.getByLabel("绑定手机号", { exact: true }).fill("13800138000");
    await page.getByRole("button", { name: "绑定手机号", exact: true }).click();
    await page.getByRole("button", { name: "继续报名", exact: true }).click();
    await page.getByRole("button", { name: "提交报名", exact: true }).waitFor();
    assert.match(page.url(), /signup\?project=p1&form=f1/);
    await page.goto("http://127.0.0.1:5173/my-services");
    await page.getByRole("heading", { name: "图书馆整理服务" }).waitFor();
    await page.getByLabel("服务记录").selectOption("已参加");
    assert.equal(await page.getByRole("heading", { name: "社区便民服务" }).count(), 0);
    await shot("services-desktop");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "外观模式" }).selectOption(theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(`services-mobile-${theme}`);
      await page.goto("http://127.0.0.1:5173/recruitment");
      await page.getByRole("heading", { name: project.name }).waitFor();
      await shot(`recruitment-mobile-${theme}`);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("http://127.0.0.1:5173/my-services");
      await page.getByRole("heading", { name: "图书馆整理服务" }).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(`Volunteer browser checks passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
