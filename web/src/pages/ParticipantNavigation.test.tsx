import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App.tsx";

const session = {
  user: {
    username: "manager",
    name: "测试负责人",
    id: "00123",
    phone: "13800000001",
    groups: ["activity_admin"],
  },
  password_setup_required: false,
};
const record = {
  project: "校园开放日志愿引导",
  member: {
    id: "m1",
    name: "测试负责人",
    number: "00123",
    phone: "13800000001",
    department: "学院",
    session_id: "s1",
    position_id: "pos1",
    intent: "未填写",
    platform: "",
    identity_verified: true,
  },
  sessions: [
    { id: "s1", name: "第一场", positions: [{ id: "pos1", name: "现场服务" }] },
  ],
  attendance: [],
  hours: [],
};

function mockServer(signedIn = true) {
  const reply = (data: unknown, status = 200) => ({
    ok: status === 200,
    status,
    json: async () => ({ errcode: status === 200 ? 0 : 200001, data }),
  });
  const fetch = vi.fn(async (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path.endsWith("/auth/me"))
      return signedIn ? reply(session) : reply({}, 401);
    if (path.endsWith("/auth/logout")) {
      signedIn = false;
      return reply({});
    }
    if (path === "/api/v1/public/projects/p1/me") return reply(record);
    if (path.includes("/forms/"))
      return reply({
        project: record.project,
        kind: path.endsWith("/intent") ? "intent" : "recruit",
        form: { id: "f1", title: "报名", description: "", published: true },
        sessions: record.sessions,
      });
    if (path.includes("/scan"))
      return reply({
        project: record.project,
        session_id: "s1",
        action: "checkin",
        member: record.member,
      });
    if (path === "/api/v1/activity/projects")
      return reply({
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
        departments: [],
        summary: {
          project_count: 0,
          recruiting_count: 0,
          pending_count: 0,
          recognized_hours: null,
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  history.replaceState(null, "", "/");
});

test.each([
  ["报名记录", ""],
  ["报名表", "&form=recruit"],
  ["时长意向", "&form=intent"],
  ["现场签到", "&attendance=s1&token=test"],
])(
  "%s retains main navigation and can return to the project list without logging in again",
  async (_, query) => {
    history.replaceState(null, "", `/signup?project=p1${query}`);
    mockServer();
    render(<App />);
    await screen.findByRole("heading", { name: record.project });
    const nav = screen.getByRole("navigation", { name: "页面导航" });
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "工作台" })).toBeTruthy();
    expect(within(nav).queryByRole("link", { name: "成员管理" })).toBeNull();
    expect(
      within(nav)
        .getByRole("link", { name: "我的服务" })
        .getAttribute("aria-current"),
    ).toBe("page");
    await userEvent.click(within(nav).getByRole("link", { name: "项目台账" }));
    await screen.findByRole("heading", { name: "项目台账" });
    expect(location.pathname).toBe("/projects");
    expect(screen.queryByLabelText("账号")).toBeNull();
    await act(async () => {
      history.back();
      await new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
    });
    await screen.findByRole("heading", { name: record.project });
    expect(screen.getByRole("link", { name: "项目台账" })).toBeTruthy();
  },
);

test("the mobile menu opens and closes on a participant deep link and after selecting a page", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 760px)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
  history.replaceState(null, "", "/signup?project=p1");
  mockServer();
  render(<App />);
  await screen.findByRole("heading", { name: record.project });
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "展开导航" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.click(trigger);
  const drawer = screen.getByRole<HTMLDialogElement>("dialog", {
    name: "主导航",
  });
  expect(trigger.getAttribute("aria-controls")).toBe(drawer.id);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await user.click(within(drawer).getByRole("button", { name: "收起导航" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(trigger);
  act(() => drawer.close());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.click(trigger);
  await user.click(within(drawer).getByRole("link", { name: "项目台账" }));
  await screen.findByRole("heading", { name: "项目台账" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a guest with a personal record link keeps navigation without an invented account or admin links", async () => {
  history.replaceState(null, "", "/signup?project=p1");
  mockServer(false);
  render(<App />);
  await screen.findByRole("heading", { name: record.project });
  const nav = screen.getByRole("navigation", { name: "页面导航" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["招募活动", "我的服务", "个人信息"]);
  expect(document.querySelector(".sidebar-user")).toBeNull();
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  await userEvent.click(screen.getByRole("link", { name: "登录平台" }));
  expect(location.pathname).toBe("/login");
  expect(screen.getByLabelText("账号")).toBeTruthy();
});

test("logging out from a participant page clears the app session", async () => {
  history.replaceState(null, "", "/signup?project=p1");
  const fetch = mockServer();
  render(<App />);
  await screen.findByRole("heading", { name: record.project });
  await userEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() => expect(location.pathname).toBe("/login"));
  expect(screen.getByLabelText("账号")).toBeTruthy();
  expect(fetch).toHaveBeenCalledWith(
    "/api/v1/auth/logout",
    expect.objectContaining({ method: "POST" }),
  );
});
