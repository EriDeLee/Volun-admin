import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
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
const reply = (data: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => ({ errcode: status === 200 ? 0 : 200001, data }),
});
function server() {
  return vi.fn(async (url, options = {}) => {
    const u = new URL(url, "http://localhost");
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

test("restores deep project route and does not reveal internal subject", async () => {
  history.replaceState(null, "", "/projects/p1?tab=recruit");
  render(<App />);
  await screen.findByRole("heading", { name: "志愿者名单" });
  expect(location.pathname + location.search).toBe("/projects/p1?tab=recruit");
  expect(document.body.textContent).not.toContain(session.user.sub);
  await userEvent.click(
    screen.getByRole<HTMLButtonElement>("tab", { name: "录入与审核" }),
  );
  expect(await screen.findByText("暂无可读取的复核快照")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "通过" })).toBeNull();
});

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

test("recruit drafts flow into integer hours and logout clears drafts", async () => {
  const user = userEvent.setup();
  history.replaceState(null, "", "/projects/p1");
  render(<App />);
  await screen.findByRole("button", { name: "添加场次草稿" });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "添加场次草稿" }),
  );
  let dialog = screen.getByRole<HTMLButtonElement>("dialog");
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("场次名称 *"),
    "第一场",
  );
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("岗位安排 *"),
    "现场引导",
  );
  fireEvent.change(
    within(dialog).getByLabelText<HTMLInputElement>("开始时间 *"),
    {
      target: { value: "2026-11-08T08:00" },
    },
  );
  fireEvent.change(
    within(dialog).getByLabelText<HTMLInputElement>("结束时间 *"),
    {
      target: { value: "2026-11-08T12:00" },
    },
  );
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("计划人数 *"),
    "10",
  );
  await user.click(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "添加场次草稿",
    }),
  );
  await user.click(
    screen.getByRole<HTMLButtonElement>("tab", { name: "招募登记" }),
  );
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "添加志愿者" }),
  );
  dialog = screen.getByRole<HTMLButtonElement>("dialog");
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("姓名 *"),
    "草稿同学",
  );
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("学号 / 人员编号 *"),
    "001234",
  );
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("学院 / 部门 *"),
    "测试学院",
  );
  await user.type(
    within(dialog).getByLabelText<HTMLInputElement>("服务岗位 *"),
    "现场引导",
  );
  await user.selectOptions(
    within(dialog).getByLabelText<HTMLInputElement>("参与场次"),
    within(dialog).getByRole<HTMLButtonElement>("option", { name: "第一场" })
      .value,
  );
  await user.click(
    within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "添加到草稿",
    }),
  );
  expect(await screen.findByText("001234")).toBeTruthy();
  await user.click(
    screen.getByRole<HTMLButtonElement>("tab", { name: "计时与时长" }),
  );
  const input = await screen.findByLabelText("草稿同学的拟计时长");
  fireEvent.change(input, { target: { value: "1.5" } });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "保留会话草稿" }),
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.change(input, { target: { value: "5" } });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "保留会话草稿" }),
  );
  expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input, { target: { value: "4" } });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "保留会话草稿" }),
  );
  await screen.findByText(/时长草稿已保留在本次会话中/);
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "提交数据复核（待开放）",
    }).disabled,
  ).toBe(true);
  expect(
    fetch.mock.calls.filter(([, opts]) => opts?.method === "POST"),
  ).toHaveLength(0);
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "退出登录" }),
  );
  await screen.findByRole("button", { name: "登录平台" });
  await user.type(screen.getByLabelText<HTMLInputElement>("账号"), "manager");
  await user.type(
    screen.getByLabelText<HTMLInputElement>("密码", { exact: true }),
    "test-password",
  );
  fetch.mockImplementationOnce(async () => reply(session));
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "登录平台" }),
  );
  await screen.findByRole("heading", { name: "活动管理工作台" });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: project.name }),
  );
  await screen.findByRole("button", { name: "添加场次草稿" });
  expect(screen.queryByText("第一场")).toBeNull();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

test("batch preflight rejects duplicate numbers before writing drafts", async () => {
  history.replaceState(null, "", "/projects/p1?tab=recruit");
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "批量粘贴" }));
  fireEvent.change(screen.getByLabelText<HTMLInputElement>("批量名单"), {
    target: { value: "甲\t001\t学院\t引导\n乙\t001\t学院\t接待" },
  });
  expect(screen.getByText("编号重复，请核对")).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "录入本次会话草稿" })
      .disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText<HTMLInputElement>("批量名单"), {
    target: { value: "甲\t001\t学院\t引导\n乙\t002\t学院\t接待" },
  });
  await user.click(
    screen.getByRole<HTMLButtonElement>("button", { name: "录入本次会话草稿" }),
  );
  expect(await screen.findByText("001")).toBeTruthy();
  expect(screen.getByText("002")).toBeTruthy();
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
