const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function checkComponents(browser, baseURL, output) {
  const project = {
    id: "p1",
    code: "ZY-TEST-001",
    name: "校园开放日志愿服务",
    department: "校团委",
    owner_name: "测试负责人",
    starts_on: "2025-11-01",
    ends_on: "2025-11-02",
    location: "学院路校区",
    description: "来访接待与咨询引导",
    status: "进行",
    approval: "approved",
  };
  const user = {
    username: "admin",
    name: "平台管理员",
    id: "00001",
    phone: "13800000001",
    groups: ["super_admin"],
    status: "active",
    has_password: true,
    password_setup_required: false,
  };
  const member = {
    id: "m1",
    name: "测试志愿者",
    number: "00002",
    department: "航空学院",
    phone: "13800000002",
    session_id: "s1",
    position_id: "pos1",
    assignments: [{ session_id: "s1", position_id: "pos1" }],
    source: "manual",
    intent: "未填写",
    platform: "",
    notes: "测试备注",
  };
  const basics = {
    ...project,
    sessions: [
      {
        id: "s1",
        name: "上午场",
        start: "2025-11-01T09:00:00+08:00",
        end: "2025-11-01T12:00:00+08:00",
        positions: [
          {
            id: "pos1",
            name: "现场引导",
            capacity: 20,
            hours: 3,
            description: "咨询接待",
          },
        ],
      },
    ],
    guarantees: [],
  };
  const form = {
    id: "f1",
    published: true,
    title: "志愿者报名",
    description: "请选择参加场次和岗位。",
    deadline: "",
  };
  const material = {
    team: "测试团队",
    audience: "在校学生",
    registration_start: "",
    registration_end: "",
    checkin_rule: "现场签到",
    checkin_start: "",
    checkin_end: "",
    max_daily_hours: 3,
    recruitment: "全校招募",
    password: "",
    guarantees: [],
    other_guarantee: "",
    description: project.description,
    contact_name: "测试联系人",
    contact_phone: "010-00000000",
    contact_mobile: "13800000001",
    contact_email: "demo@example.test",
    notes: "",
    training: "活动前统一培训",
  };
  const workflow = {
    project,
    version: 1,
    approval: "approved",
    capabilities: [
      "read",
      "basics.edit",
      "members.read",
      "members.write",
      "forms.write",
      "attendance.manage",
      "hours.write",
      "materials.write",
      "proposal.review",
      "export",
      "workflow.write",
    ],
    state: {
      basics,
      draft: null,
      applications: [],
      members: [member],
      attendance: [],
      windows: [],
      hours: [],
      form,
      intent_form: { ...form, id: "", published: false },
      material,
      review: {
        external_result: "",
        opinion: "",
        published: false,
        approved_at: null,
      },
      legacy: false,
    },
  };
  const summary = {
    project_count: 1,
    recruiting_count: 0,
    pending_count: 1,
    recognized_hours: null,
  };
  const report = [];
  const errors = [];
  const contexts = [];
  async function setup(options = {}) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...options,
    });
    contexts.push(context);
    let signedIn = true;
    await context.route("**/api/v1/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      let data;
      if (url.pathname.endsWith("/auth/logout")) {
        signedIn = false;
        data = {};
      } else if (url.pathname.endsWith("/auth/me")) {
        if (!signedIn)
          return route.fulfill({
            status: 401,
            json: { errcode: 200001, data: null },
          });
        data = { user };
      } else if (url.pathname.endsWith("/auth/phone"))
        return route.fulfill({
          status: 400,
          json: { errcode: 100001, message: "手机号格式不正确" },
        });
      else if (url.pathname.endsWith("/workflow")) data = workflow;
      else if (url.pathname.endsWith("/history"))
        data = { events: [], materials: [] };
      else if (url.pathname.endsWith("/dashboard"))
        data = {
          summary,
          generated_at: new Date().toISOString(),
          tasks: [],
          stages: [],
          recent_projects: [project],
        };
      else if (url.pathname.endsWith("/activity/projects"))
        data = {
          items: [project],
          total: 1,
          page: 1,
          page_size: 20,
          summary,
          departments: ["校团委"],
        };
      else if (url.pathname.endsWith("/users/import"))
        data = {
          valid: true,
          imported: 0,
          rows: Array.from({ length: 40 }, (_, i) => ({
            line: i + 2,
            username: "student" + i,
            name: "测试成员" + i,
            id: "00" + i,
            error: "",
          })),
        };
      else if (url.pathname.endsWith("/admin/users"))
        data = {
          items: [
            user,
            {
              ...user,
              username: "student",
              name: "测试成员",
              id: "00002",
              groups: ["formal_user"],
            },
          ],
          total: 2,
          page: 1,
          page_size: 20,
          summary: {
            user_count: 2,
            active_count: 2,
            disabled_count: 0,
            manager_count: 1,
          },
        };
      else if (url.pathname.endsWith("/volunteer/projects"))
        data = {
          items: [
            {
              project,
              form_id: "f1",
              deadline: "",
              registered: false,
              participated: false,
              recognized_hours: null,
              guarantees: [],
            },
          ],
        };
      else if (url.pathname.endsWith("/public/projects/p1/forms/f1"))
        data = {
          project: project.name,
          form,
          kind: "recruit",
          sessions: basics.sessions,
          guarantees: [],
        };
      else if (url.pathname.endsWith("/public/projects/p1/me"))
        return route.fulfill({
          status: 403,
          json: { errcode: 200002, data: null },
        });
      else
        throw new Error(
          `Unexpected component API: ${request.method()} ${url.pathname}`,
        );
      await route.fulfill({ json: { errcode: 0, data } });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  }
  async function audit(page, name) {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const result = await page.evaluate(async () => {
      const { violations } = await axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
      return violations.map(({ id, impact, help, nodes }) => ({
        id,
        impact,
        help,
        nodes: nodes.map(({ target, failureSummary }) => ({
          target,
          failureSummary,
        })),
      }));
    });
    report.push({ name, violations: result });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Page overflow: ${name}`,
    );
  }
  async function shot(page, name) {
    await page.screenshot({
      path: path.join(output, `components-${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  try {
    const page = await setup();
    await page.goto(`${baseURL}/users`);
    await page.getByText("测试成员", { exact: true }).waitFor();
    await audit(page, "users-light");
    const width = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    await page.getByRole("button", { name: "添加成员", exact: true }).click();
    const account = page.getByRole("dialog", { name: "添加成员", exact: true });
    await account.waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.clientWidth),
      width,
      "Opening a dialog must not shift the page",
    );
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    const before = await page.evaluate(() => scrollY);
    await page.mouse.move(8, 300);
    await page.mouse.wheel(0, 400);
    // Allow the browser to deliver the wheel gesture before asserting containment.
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => scrollY),
      before,
      "Backdrop scroll must not move the page",
    );
    await audit(page, "account-modal");
    await account
      .getByRole("textbox", { name: "姓名", exact: true })
      .fill("测试成员");
    await account
      .getByRole("textbox", { name: "学号 / 人员编号", exact: true })
      .fill("00123");
    await account
      .getByRole("textbox", { name: "登录账号", exact: true })
      .fill("new-member");
    const password = account.locator('input[name="password"]');
    await password.fill("short");
    await account
      .getByRole("button", { name: "添加成员", exact: true })
      .click();
    assert.equal(await password.getAttribute("aria-invalid"), "true");
    assert.equal(await account.getByRole("alert").count(), 0);
    assert.match(await account.innerText(), /密码太短.*12–72 字节/);
    assert.match(await password.getAttribute("aria-describedby"), /.+/);
    assert.match(
      await password.evaluate(
        (element) =>
          document.getElementById(element.getAttribute("aria-describedby"))
            .textContent,
      ),
      /密码太短/,
    );
    await password.fill("测试密码");
    assert.equal(await password.getAttribute("aria-invalid"), null);
    await password.fill("测".repeat(25));
    assert.equal((await password.inputValue()).length, 25);
    await password.blur();
    assert.equal(await password.getAttribute("aria-invalid"), "true");
    assert.equal(
      await password.evaluate((element) => {
        const reference = document.createElement("span");
        reference.style.color = "var(--danger)";
        element.parentElement.append(reference);
        const expected = getComputedStyle(reference).color;
        reference.remove();
        return getComputedStyle(element).borderTopColor === expected;
      }),
      true,
      "Invalid passwords must visibly have the error border",
    );
    await audit(page, "account-password-error");
    await shot(page, "account-light");
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "account-error-mobile");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.keyboard.press("Escape");
    await account.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "批量导入", exact: true }).click();
    await page
      .getByRole("textbox", { name: "CSV内容" })
      .fill(
        "账号,姓名,学号,初始密码,用户组\nstudent,测试成员,00002,temporary-secret-123,formal_user",
      );
    await page.getByRole("button", { name: "检查名单", exact: true }).click();
    const preview = page.getByRole("region", { name: /成员导入检查/ });
    await preview.waitFor();
    await preview.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      () => document.querySelector(".import-preview").scrollTop > 0,
    );
    await page.getByRole("dialog").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    assert.equal(
      await page
        .getByRole("button", { name: "关闭弹窗" })
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const dialog = element.closest("dialog").getBoundingClientRect();
          return rect.top >= dialog.top && rect.bottom <= innerHeight;
        }),
      true,
      "The close control must stay visible while a long dialog scrolls",
    );
    await audit(page, "import-preview");
    await shot(page, "import-scroll");
    await page.keyboard.press("Escape");
    await page.goto(`${baseURL}/projects/p1`);
    await page.getByRole("tab", { name: "立项", exact: true }).waitFor();
    assert.equal(await page.getByRole("main").count(), 1);
    const tabs = page.getByRole("tablist", { name: "项目功能" });
    await tabs.getByRole("tab", { name: "立项", exact: true }).focus();
    await page.keyboard.press("End");
    assert.equal(
      await tabs
        .getByRole("tab", { name: "操作记录" })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(
      await tabs
        .getByRole("tab", { name: "立项", exact: true })
        .getAttribute("aria-selected"),
      "true",
      "Arrow navigation must not switch a long form before activation",
    );
    await page.keyboard.press("Enter");
    await page
      .getByRole("tabpanel", { name: "操作记录", exact: true })
      .waitFor();
    await tabs.getByRole("tab", { name: "成员名单", exact: true }).click();
    await page.getByText("测试志愿者", { exact: true }).waitFor();
    await page
      .getByLabel("从表格粘贴成员", { exact: true })
      .fill("\t00123\t学院\t\t备注");
    const pastedName = page.getByLabel("姓名，第 1 行", { exact: true });
    assert.equal(await pastedName.getAttribute("aria-invalid"), "true");
    await pastedName.fill("粘贴成员");
    assert.equal(await pastedName.getAttribute("aria-invalid"), null);
    assert.equal(
      await page.getByLabel("编号，第 1 行", { exact: true }).inputValue(),
      "00123",
    );
    await audit(page, "workflow-members");
    await shot(page, "workflow-light");
    await page.getByRole("combobox", { name: "外观模式" }).selectOption("dark");
    await audit(page, "workflow-dark");
    await shot(page, "workflow-dark");
    await page.goto(`${baseURL}/profile`);
    await page
      .getByRole("heading", { name: "个人信息", exact: true })
      .waitFor();
    const phone = page.getByRole("textbox", { name: "绑定手机号" });
    await phone.fill("123");
    await page.getByRole("button", { name: "更新绑定手机号" }).click();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await phone.getAttribute("aria-invalid"), "true");
    await audit(page, "profile-phone-error");
    await page.goto(`${baseURL}/recruitment`);
    await page
      .getByRole("heading", { name: "招募活动", exact: true })
      .waitFor();
    await audit(page, "recruitment-dark");
    await page.goto(`${baseURL}/signup?project=p1&form=f1`);
    await page
      .getByRole("heading", { name: "志愿者报名", exact: true })
      .waitFor();
    await audit(page, "signup-dark");
    const touch = await setup({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await touch.goto(`${baseURL}/projects`);
    await touch
      .getByRole("button", { name: project.name, exact: true })
      .waitFor();
    const filter = touch.getByRole("combobox", { name: "筛选项目状态" });
    assert.equal(
      await filter.evaluate((e) => getComputedStyle(e).fontSize),
      "16px",
    );
    for (const target of [
      touch.getByRole("button", { name: "查询", exact: true }),
      touch.getByRole("button", { name: "展开导航" }),
      touch.getByRole("combobox", { name: "外观模式" }),
    ])
      assert.ok((await target.boundingBox()).height >= 48);
    await audit(touch, "ledger-touch");
    await shot(touch, "touch-light");
    await touch.getByRole("button", { name: "展开导航" }).click();
    await audit(touch, "navigation-touch");
    await touch.keyboard.press("Escape");
    await touch.setViewportSize({ width: 320, height: 844 });
    await audit(touch, "ledger-touch-320");
    await touch
      .getByRole("combobox", { name: "外观模式" })
      .selectOption("dark");
    await shot(touch, "touch-dark");
    await page.goto(`${baseURL}/projects`);
    await page
      .getByRole("button", { name: project.name, exact: true })
      .waitFor();
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollbarColor,
      ),
      "auto",
    );
    await shot(page, "forced-colors");
    await page.emulateMedia({ forcedColors: "none", contrast: "more" });
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollbarWidth,
      ),
      "auto",
    );
    await page.emulateMedia({ contrast: "no-preference" });
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("button", { name: "登录平台", exact: true }).waitFor();
    await audit(page, "login");
    await fs.writeFile(
      path.join(output, "component-accessibility.json"),
      JSON.stringify(report, null, 2),
    );
    const violations = report.filter((r) => r.violations.length);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      violations,
      [],
      `Accessibility issues: ${JSON.stringify(violations)}`,
    );
    console.log(
      `Component checks passed: ${report.length} axe scans; native dialog, scrolling, tabs, field errors, touch and contrast preferences.`,
    );
  } finally {
    for (const context of contexts) await context.close();
  }
}
module.exports = { checkComponents };
