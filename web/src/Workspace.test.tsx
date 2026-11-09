import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.tsx";
import { csvCell } from "./lib/drafts.tsx";
import { materialHTML } from "./pages/MaterialsPage.tsx";

const session = {
  user: {
    name: "测试负责人",
    username: "manager",
    sub: "private-user-sub",
    id: "00123",
    groups: ["activity_admin"],
  },
  password_setup_required: false,
};
const project = {
  id: "p1",
  code: "ZY-TEST",
  name: "校园引导服务",
  department: "学院团委",
  owner_name: "测试负责人",
  starts_on: "2026-11-08",
  ends_on: "2026-11-09",
  location: "校内广场",
  description: "来访接待与引导",
  status: "立项",
};
const summary = {
  project_count: 1,
  recruiting_count: 0,
  pending_count: 1,
  recognized_hours: null,
};
const workflow = {
  project: { ...project, status: "进行" },
  version: 3,
  approval: "approved",
  capabilities: [
    "read",
    "members.read",
    "basics.edit",
    "attendance.manage",
    "materials.read",
  ],
  state: {
    basics: {
      ...project,
      sessions: [
        {
          id: "s1",
          name: "第一场",
          start: "2026-11-08T08:00:00+08:00",
          end: "2026-11-08T12:00:00+08:00",
          positions: [{ id: "pos1", name: "引导", capacity: 10 }],
        },
      ],
    },
    applications: [],
    members: [],
    windows: [],
    attendance: [],
    hours: [],
    form: {},
    intent_form: {},
    review: {},
    material: { guarantees: [] },
  },
};
const reply = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => ({ errcode: status === 200 ? 0 : 200001, data }),
});
function server() {
  return vi.fn(async (url, options = {}) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname.endsWith("/projects/p1/workflow")) return reply(workflow);
    if (u.pathname.endsWith("/projects/p1/history"))
      return reply({ events: [], materials: [] });
    if (u.pathname.endsWith("/auth/me")) return reply(session);
    if (u.pathname.endsWith("/auth/logout")) return reply({});
    if (u.pathname.endsWith("/projects/p1")) return reply(project);
    if (u.pathname.endsWith("/projects")) {
      if (options.method === "POST") return reply(project);
      const q = u.searchParams.get("q");
      const items =
        q && !project.name.includes(q) && !project.code.includes(q)
          ? []
          : [project];
      return reply({
        items,
        total: items.length,
        summary,
        page: Number(u.searchParams.get("page") || 1),
        page_size: 20,
        departments: [project.department],
      });
    }
    if (u.pathname.startsWith("/api/v1/admin/users")) {
      const adminUser = {
        username: "manager",
        name: "测试负责人",
        id: "00123",
        groups: ["super_admin"],
        status: "active",
        password_setup_required: false,
        has_password: true,
        updated_at: "2026-11-09T08:00:00Z",
      };
      if (options.method === "PATCH") return reply(adminUser);
      return reply({
        items: [adminUser],
        total: 1,
        page: 1,
        page_size: 20,
        summary: {
          user_count: 1,
          active_count: 1,
          disabled_count: 0,
          manager_count: 1,
        },
      });
    }
    if (u.pathname.endsWith("/dashboard"))
      return reply({
        summary,
        tasks: [],
        stages: [],
        recent_projects: [project],
        generated_at: new Date().toISOString(),
      });
    throw new Error("Unexpected request: " + url);
  });
}
const fetch =
  vi.fn<
    (url: string, options?: RequestInit) => Promise<ReturnType<typeof reply>>
  >();
beforeEach(() => {
  fetch.mockReset();
  history.replaceState(null, "", "/projects");
  fetch.mockImplementation(server());
  vi.stubGlobal("fetch", fetch);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("data administrator can open the approval queue directly and inspect a pending change", async () => {
  history.replaceState(null, "", "/approvals");
  fetch.mockImplementation(async (url) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname.endsWith("/auth/me"))
      return reply({
        ...session,
        user: { ...session.user, groups: ["data_admin"] },
      });
    if (u.pathname.endsWith("/approvals"))
      return reply({
        items: [
          {
            project,
            application: {
              id: "app1",
              kind: "change",
              basics: workflow.state.basics,
              applicant: "申请人",
              reason: "变更地点",
              created_at: "2026-11-09T08:00:00Z",
            },
          },
        ],
        total: 1,
        page_size: 20,
      });
    if (u.pathname.endsWith("/workflow")) return reply(workflow);
    if (u.pathname.endsWith("/history"))
      return reply({ events: [], materials: [] });
    throw new Error(`unexpected route: ${url}`);
  });
  render(<App />);
  await screen.findByRole("heading", { name: "项目审批" });
  expect(await screen.findByText(/变更地点/)).toBeTruthy();
  await userEvent.click(screen.getByRole("link", { name: "查看并审批" }));
  await screen.findByText("立项与变更记录");
  expect(location.pathname).toBe("/projects/p1");
});

test("super admin manages user groups and status without exposing sub", async () => {
  history.replaceState(null, "", "/users");
  fetch.mockImplementation(async (url, options = {}) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname.endsWith("/auth/me"))
      return reply({
        ...session,
        user: { ...session.user, username: "manager", groups: ["super_admin"] },
      });
    return server()(url, options);
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "成员管理" });
  expect(await screen.findByText("测试负责人")).toBeTruthy();
  expect(document.body.textContent).not.toContain("private-user-sub");
  await user.click(await screen.findByRole("button", { name: "编辑" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /数据管理员/ }),
  );
  await user.click(within(dialog).getByRole("button", { name: "保存变更" }));
  await screen.findByText("已更新账号 manager。");
  const patch = fetch.mock.calls.find(
    ([, options]) => options?.method === "PATCH",
  );
  expect(patch).toBeTruthy();
  expect(JSON.parse(patch![1]?.body as string).groups).toContain("data_admin");
});

test("super administrator can reach member management from the dashboard and retains navigation on profile", async () => {
  const original = server();
  fetch.mockImplementation(async (url, options = {}) =>
    url.endsWith("/auth/me")
      ? reply({
          ...session,
          user: { ...session.user, groups: ["super_admin"] },
        })
      : original(url, options),
  );
  history.replaceState(null, "", "/activity");
  render(<App />);
  await screen.findByRole("heading", { name: "活动管理工作台" });
  const nav = () => screen.getByRole("navigation", { name: "页面导航" });
  const labels = within(nav())
    .getAllByRole("link")
    .map((link) => link.textContent);
  expect(within(nav()).getByRole("link", { name: "时长管理" })).toBeTruthy();
  expect(within(nav()).getByRole("link", { name: "项目材料" })).toBeTruthy();
  await userEvent.click(within(nav()).getByRole("link", { name: "成员管理" }));
  await screen.findByRole("heading", { name: "成员管理" });
  expect(location.pathname).toBe("/users");
  await userEvent.click(within(nav()).getByRole("link", { name: "个人信息" }));
  await screen.findByRole("heading", { name: "个人信息" });
  expect(
    within(nav())
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(labels);
  expect(
    within(nav())
      .getByRole("link", { name: "个人信息" })
      .getAttribute("aria-current"),
  ).toBe("page");
});

test("restores deep project route and does not reveal internal subject", async () => {
  history.replaceState(null, "", "/projects/p1?tab=recruit");
  render(<App />);
  await screen.findByRole("heading", { name: "成员名单" });
  expect(location.pathname + location.search).toBe("/projects/p1?tab=recruit");
  expect(document.body.textContent).not.toContain(session.user.sub);
  await userEvent.click(
    screen.getByRole<HTMLButtonElement>("tab", { name: "附件3" }),
  );
  expect(await screen.findByText("功能待完善")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "通过" })).toBeNull();
});

test.each([
  ["hours", "时长管理", "计时与时长"],
  ["materials", "项目材料", "附件1"],
])(
  "%s keeps its navigation active when choosing a project",
  async (path, title, heading) => {
    const original = server();
    fetch.mockImplementation(async (url, options = {}) =>
      url.endsWith("/auth/me")
        ? reply({
            ...session,
            user: { ...session.user, groups: ["super_admin"] },
          })
        : original(url, options),
    );
    history.replaceState(null, "", `/${path}`);
    render(<App />);
    await screen.findByRole("heading", { name: title });
    const activeLink = () =>
      within(screen.getByRole("navigation", { name: "页面导航" })).getByRole(
        "link",
        { name: title },
      );
    expect(activeLink().getAttribute("aria-current")).toBe("page");
    await userEvent.click(
      await screen.findByRole("button", { name: project.name }),
    );
    await screen.findByRole("heading", { name: heading });
    expect(location.pathname + location.search).toBe(`/${path}?project=p1`);
    expect(activeLink().getAttribute("aria-current")).toBe("page");
  },
);

test("ledger search and reset fetch the full paginated list", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: project.name });
  await user.type(
    screen.getByLabelText<HTMLInputElement>("搜索项目名称或编号"),
    "无匹配",
  );
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "查询" }),
  );
  await screen.findByText("没有符合条件的项目");
  expect(
    fetch.mock.calls.some(
      ([url]) =>
        new URL(url, "http://localhost").searchParams.get("q") === "无匹配",
    ),
  ).toBe(true);
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "重置" }),
  );
  await screen.findByRole("button", { name: project.name });
  const last = new URL(fetch.mock.calls.at(-1)![0], "http://localhost");
  expect(last.searchParams.has("q")).toBe(false);
  expect(last.searchParams.get("page")).toBe("1");
});

test("protected deep links enforce first SSO password setup before requesting projects", async () => {
  fetch.mockImplementation(async () =>
    reply({ ...session, password_setup_required: true }),
  );
  history.replaceState(null, "", "/projects/p1");
  render(<App />);
  await screen.findByRole("heading", { name: "请设置登录密码" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(location.pathname).toBe("/set-password");
});

test("public form needs no authentication and clearly completes only a local preview", async () => {
  history.replaceState(null, "", "/signup?preview=1");
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByLabelText<HTMLInputElement>("姓名 *"), "示例甲");
  await user.type(
    screen.getByLabelText<HTMLInputElement>("学号 / 人员编号 *"),
    "0007",
  );
  await user.type(
    screen.getByLabelText<HTMLInputElement>("学院 / 部门 *"),
    "示例学院",
  );
  await user.selectOptions(
    screen.getByLabelText<HTMLInputElement>("意向岗位 *"),
    "现场引导（示例）",
  );
  await user.selectOptions(
    screen.getByLabelText<HTMLInputElement>("参与场次 *"),
    "第一场（仅版式示例）",
  );
  await user.click(screen.getByRole<HTMLButtonElement>("checkbox"));
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "完成填写预览" }),
  );
  await screen.findByRole("heading", { name: "填写预览已完成" });
  expect(fetch).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "修改本次预览" }),
  );
  expect(
    screen.getByLabelText<HTMLInputElement>("学号 / 人员编号 *").value,
  ).toBe("0007");
});

test("activity administrator can view members but cannot recruit or maintain hours", async () => {
  history.replaceState(null, "", "/projects/p1?tab=recruit");
  render(<App />);
  await screen.findByRole("heading", { name: "成员名单" });
  expect(screen.queryByRole("button", { name: "保存成员" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "招募问卷与二维码" })).toBeNull();
  expect(screen.queryByRole("link", { name: "时长管理" })).toBeNull();
  await userEvent.click(screen.getByRole("tab", { name: "现场出勤" }));
  expect(
    screen.getByRole("button", { name: "保存窗口并更新二维码" }),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "计时与时长" }));
  expect(
    screen.queryByRole("button", { name: "保存时长 / 批量补录" }),
  ).toBeNull();
});

test("data administrator persists questionnaire changes with the current workflow version", async () => {
  const original = server();
  fetch.mockImplementation(async (url, options = {}) => {
    if (url.endsWith("/auth/me"))
      return reply({
        ...session,
        user: { ...session.user, groups: ["data_admin"] },
      });
    if (url.endsWith("/workflow"))
      return reply({
        ...workflow,
        capabilities: [...workflow.capabilities, "forms.write"],
      });
    if (url.endsWith("/forms"))
      return reply({
        ...workflow,
        version: 4,
        capabilities: [...workflow.capabilities, "forms.write"],
      });
    return original(url, options);
  });
  history.replaceState(null, "", "/projects/p1?tab=forms");
  render(<App />);
  await screen.findByRole("heading", { name: "问卷与二维码" });
  await userEvent.click(screen.getByRole("button", { name: "保存问卷" }));
  await screen.findByText("已保存到服务器。");
  const call = fetch.mock.calls.find(([url]) => url.endsWith("/forms"));
  expect(call?.[1]?.method).toBe("PUT");
  expect(new Headers(call?.[1]?.headers).get("X-Workflow-Version")).toBe("3");
  expect(JSON.parse(call?.[1]?.body as string).kind).toBe("recruit");
});

test("material export escapes editable HTML and spreadsheet export neutralizes formulas", () => {
  const html = materialHTML({
    name: '<script>alert("x")</script>',
    department: "学院",
    owner: "甲",
    start: "2026-11-08",
    end: "2026-11-09",
    location: "校园",
    audience: ["师生"],
    description: "<img src=x onerror=alert(1)>",
    safety: "安全措施",
  });
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;script&gt;");
  expect(csvCell('=HYPERLINK("url")')).toBe('"\'=HYPERLINK(""url"")"');
  expect(csvCell("001234")).toBe('"001234"');
});

test("expired session on a project request returns to login", async () => {
  fetch.mockImplementation(async (url) =>
    url.endsWith("/auth/me") ? reply(session) : reply(null, 401),
  );
  history.replaceState(null, "", "/projects/p1");
  render(<App />);
  await screen.findByRole("button", { name: "登录平台" });
  await waitFor(() => expect(location.pathname).toBe("/login"));
  expect(screen.getByRole<HTMLButtonElement>("alert").textContent).toBe(
    "登录已失效，请重新登录。",
  );
});
