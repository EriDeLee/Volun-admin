const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

(async () => {
  const darkMode = process.argv.includes("--dark");
  const output = path.join(os.tmpdir(), darkMode ? "volun-recruitment-ui-dark" : "volun-recruitment-ui");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    if (darkMode) await page.addInitScript(() => localStorage.setItem("volun.theme", "dark"));
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const user = { username: "data-admin", name: "数据管理员", id: "00001", groups: ["data_admin"], status: "active", password_setup_required: false, has_password: true };
    const sessions = ["上午场", "下午场"].map((name, i) => ({ id: `s${i + 1}`, name, start: "2026-11-12T08:00:00+08:00", end: "2026-11-12T12:00:00+08:00", positions: [{ id: `p${i + 1}`, name: i ? "服务保障" : "现场引导", capacity: 20, description: "协助现场秩序与咨询", hours: null }] }));
    const basics = { name: "校园开放日志愿服务", department: "校团委", starts_on: "2026-11-12", ends_on: "2026-11-13", location: "学院路校区", description: "", sessions };
    const project = { ...basics, id: "p", code: "ZY-TEST-001", status: "招募", owner_name: "测试负责人", approval: "approved" };
    const form = { id: "f", published: true, title: "志愿者报名", description: "请选择可以参加的场次与岗位，可多选。", deadline: "" };
    const member = { id: "m", name: "测试成员", number: "00123", department: "测试学院", phone: "13800000000", session_id: "s1", position_id: "p1", assignments: [{ session_id: "s1", position_id: "p1" }, { session_id: "s2", position_id: "p2" }], source: "questionnaire", intent: "未填写", platform: "", notes: "可协助提前布场" };
    let workflow = { project, version: 1, approval: "approved", capabilities: ["read", "members.read", "members.write", "forms.write", "export", "attendance.manage", "workflow.write", "hours.write"], state: { basics, draft: null, applications: [], members: [member], windows: [], attendance: [], hours: [], form, intent_form: { id: "", published: false, title: "", description: "", deadline: "" }, material: { guarantees: [] }, review: { published: false }, legacy: false } };
    const writes = [];
    let registered = false, submitted;
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(), url = new URL(req.url());
      let data;
      if (url.pathname.endsWith("/auth/me")) {
        if (new URL(page.url()).pathname === "/signup") return route.fulfill({ status: 401, json: { errcode: 200001, message: "未登录", data: null } });
        data = { user };
      }
      else if (url.pathname.endsWith("/admin/users")) data = { items: [user, { ...user, username: "student", name: "测试成员", id: "00123", groups: ["formal_user"] }], total: 2, page: 1, page_size: 20, summary: { user_count: 2, active_count: 2, disabled_count: 0, manager_count: 1 } };
      else if (url.pathname.endsWith("/workflow")) data = workflow;
      else if (url.pathname.endsWith("/members/candidates")) data = { items: [{ username: "student", name: "待选志愿者", number: "00124", phone: "13000000001" }] };
      else if (url.pathname.endsWith("/history")) data = { events: [], materials: [{ id: "file", filename: "synthetic-附件1.docx", version: 1, created_at: "2026-11-09T08:00:00Z" }] };
      else if (url.pathname.endsWith("/transition")) {
        const body = req.postDataJSON();
        assert.equal(body.status, "进行");
        workflow = { ...workflow, version: workflow.version + 1, project: { ...workflow.project, status: "进行" } };
        data = workflow;
      }
      else if (url.pathname.endsWith("/projects/p/forms") && req.method() === "PUT") {
        writes.push(req.postDataJSON());
        workflow = { ...workflow, version: workflow.version + 1, state: { ...workflow.state, form: { ...workflow.state.form, ...req.postDataJSON() } } };
        data = workflow;
      } else if (url.pathname.endsWith("/public/projects/p/forms/f")) data = { project: project.name, kind: "recruit", form, sessions };
      else if (url.pathname.endsWith("/public/projects/p/me")) {
        if (!registered) return route.fulfill({ status: 403, json: { errcode: 200002, message: "未报名", data: null } });
        data = { project: project.name, member: { ...member, ...submitted.member }, sessions, attendance: [], hours: [] };
      } else if (url.pathname.endsWith("/responses")) {
        submitted = req.postDataJSON(); registered = true;
        data = { member: { ...member, ...submitted.member }, credential: "synthetic-test-credential" };
      } else throw new Error(`Unexpected API: ${req.method()} ${url.pathname}`);
      await route.fulfill({ json: { errcode: 0, data } });
    });
    const shot = async (name) => {
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow: ${name}`);
    };
    await page.goto("http://127.0.0.1:5173/projects/p?tab=recruit");
    await page.getByRole("button", { name: /分享报名问卷/ }).waitFor();
    assert.equal(await page.locator('a[href="/users"]').count(), 0);
    await page.getByRole("button", { name: "查询志愿者账号", exact: true }).waitFor();
    await page.getByLabel("姓名、学号或账号", { exact: true }).fill("00124");
    await page.getByRole("button", { name: "查询志愿者账号", exact: true }).click();
    await page.getByRole("button", { name: /选择 待选志愿者/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "姓名", exact: true }).inputValue(), "待选志愿者");
    await page.getByRole("button", { name: "改为手动填写", exact: true }).click();
    assert.deepEqual(await page.getByRole("tab").evaluateAll((tabs) => tabs.map((t) => t.getAttribute("aria-label"))), ["立项", "招募问卷与二维码", "成员名单", "附件1", "现场出勤", "计时与时长", "附件3", "操作记录"]);
    assert.equal(await page.getByRole("tab", { name: "现场出勤", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("tab", { name: "计时与时长", exact: true }).isDisabled(), true);
    await page.getByRole("columnheader", { name: "备注", exact: true }).waitFor();
    await shot("recruit-desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await shot("recruit-mobile");
    workflow.capabilities.push("materials.write");
    workflow.state.material = { ...workflow.state.material, contact_name: "测试联系人", contact_phone: "010-00000000", contact_mobile: "13000000001", contact_email: "test@example.test" };
    await page.goto("http://127.0.0.1:5173/projects/p?tab=materials");
    await page.getByRole("combobox", { name: "打卡规则", exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 11);
    assert.equal(await page.locator(".material-option-grid label").first().evaluate((element) => getComputedStyle(element).display), "flex");
    assert.equal(await page.getByRole("textbox", { name: "联系人姓名", exact: true }).inputValue(), "测试联系人");
    assert.equal(await page.getByRole("textbox", { name: "联系人姓名", exact: true }).getAttribute("readonly"), "");
    await page.getByRole("combobox", { name: "打卡规则", exact: true }).selectOption("定位扫码");
    await page.getByRole("combobox", { name: "志愿者招募范围", exact: true }).selectOption("定向招募");
    await page.getByRole("checkbox", { name: "提供饮水", exact: true }).check();
    await shot("attachment1-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot("attachment1-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("tab", { name: "附件3", exact: true }).click();
    await page.getByText("功能待完善", { exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "目标阶段" }).count(), 0);
    await shot("attachment3-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot("attachment3-desktop");
    await page.getByRole("tab", { name: "成员名单", exact: true }).click();
    await page.getByRole("button", { name: "确认准备完成，开放现场出勤", exact: true }).click();
    await page.getByRole("heading", { name: "现场出勤", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "计时与时长", exact: true }).isDisabled(), true);
    await shot("attendance-open-desktop");
    await page.clock.install({ time: new Date("2026-11-12T03:59:59Z") });
    await page.goto("http://127.0.0.1:5173/projects/p?tab=hours");
    await page.getByRole("heading", { name: "计时与时长尚未开放", exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); await shot("hours-locked-mobile");
    await page.clock.fastForward(1100);
    await page.getByRole("heading", { name: "计时与时长", exact: true }).waitFor();
    assert.equal(await page.getByRole("tab", { name: "计时与时长", exact: true }).isDisabled(), false);
    await shot("hours-open-mobile");
    workflow = { ...workflow, project: { ...workflow.project, status: "招募" } };
    await page.goto("http://127.0.0.1:5173/projects/p?tab=recruit");
    await page.getByRole("button", { name: /分享报名问卷/ }).click();
    await page.getByRole("textbox", { name: "标题", exact: true }).fill("我的报名问卷");
    workflow = { ...workflow, version: workflow.version + 1, state: { ...workflow.state, form: { ...form, title: "另一管理员的标题" } } };
    await page.getByRole("button", { name: "保存问卷", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "填写内容已保留" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "标题", exact: true }).inputValue(), "我的报名问卷");
    assert.equal(writes.length, 0);
    await shot("form-conflict-mobile");
    await page.goto("http://127.0.0.1:5173/signup?project=p&form=f");
    await page.getByRole("button", { name: "学校 SSO 登录", exact: true }).waitFor();
    await shot("identity-options-desktop");
    await page.setViewportSize({ width: 390, height: 844 }); await shot("identity-options-mobile");
    await page.getByRole("button", { name: "手动填写", exact: true }).click();
    await page.getByRole("textbox", { name: "姓名", exact: true }).fill("测试报名者");
    await page.getByRole("textbox", { name: "学号", exact: true }).fill("00124");
    await page.getByRole("textbox", { name: "联系电话", exact: true }).fill("13800000001");
    await page.getByRole("checkbox", { name: /现场引导/ }).check();
    await page.getByRole("checkbox", { name: /服务保障/ }).check();
    await page.getByRole("textbox", { name: "其他备注", exact: true }).fill("可协助提前布场");
    await shot("questionnaire-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot("questionnaire-desktop");
    await page.getByRole("button", { name: "提交报名", exact: true }).click();
    await page.getByRole("heading", { name: "本人报名记录", exact: true }).waitFor();
    assert.equal(submitted.member.assignments.length, 2);
    assert.equal(submitted.member.notes, "可协助提前布场");
    assert.deepEqual(errors, []);
    console.log(`Verified workflow order, preparation confirmation, timed hours opening, attachment3 placeholder, read-only directory and registration. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
