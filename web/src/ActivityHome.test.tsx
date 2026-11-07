import type { Api, ActivityHomeProps } from "./types.ts";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityHome from "./ActivityHome.tsx";

const session = {
  user: { name: "测试负责人", username: "tester", groups: ["activity_admin"] },
};
const empty = {
  scope: "owned",
  generated_at: "2026-11-08T00:00:00Z",
  summary: {
    project_count: 0,
    recruiting_count: 0,
    pending_count: 0,
    recognized_hours: null,
  },
  tasks: [],
  recent_projects: [],
  stages: [],
};
const project = {
  id: "p-1",
  code: "ZY-20261108-TEST",
  name: "校园开放日志愿服务",
  status: "立项",
  department: "学院团委",
  starts_on: "2026-11-08",
  ends_on: "2026-11-09",
  location: "校园广场",
  owner_name: "测试负责人",
  description: "帮助来访学生",
};
const populated = {
  ...empty,
  summary: {
    ...empty.summary,
    project_count: 2,
    recruiting_count: 0,
    pending_count: 1,
  },
  recent_projects: [
    project,
    {
      ...project,
      id: "p-2",
      code: "ZY-2",
      name: "社区助老行动",
      status: "通过",
    },
  ],
  tasks: [
    {
      project_id: "p-1",
      project_name: project.name,
      status: "立项",
      instruction: "核对基础信息，准备立项申请材料。",
    },
  ],
  stages: [
    { status: "立项", count: 1 },
    { status: "通过", count: 1 },
  ],
};
const icon = () => <svg />;
const brand = () => <a href="/">志愿服务</a>;
function mount(api: Api, overrides: Partial<ActivityHomeProps> = {}) {
  const props = {
    session,
    api,
    Icon: icon,
    Brand: brand,
    onNavigate: vi.fn(),
    onSessionIssue: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
  render(<ActivityHome {...props} />);
  return props;
}
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShowModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});

test("shows persisted empty state and unavailable hours without demonstration metrics", async () => {
  const api = vi.fn().mockResolvedValue(empty);
  mount(api);
  await screen.findByText("从第一个志愿服务项目开始");
  expect(api).toHaveBeenCalledWith("/activity/dashboard");
  expect(screen.getByText("时长模块暂未接入")).toBeTruthy();
  expect(screen.getByText("当前没有待跟进事项")).toBeTruthy();
  expect(screen.getByText("—")).toBeTruthy();
});

test("filters only recent projects and opens authorized basic details", async () => {
  const api = vi
    .fn()
    .mockImplementation((path) =>
      Promise.resolve(path === "/activity/dashboard" ? populated : project),
    );
  const user = userEvent.setup();
  mount(api);
  await screen.findByRole("table");
  await user.click(screen.getByRole("button", { name: "待跟进" }));
  expect(screen.queryByText("社区助老行动")).toBeNull();
  await user.click(screen.getByRole("button", { name: "全部近期项目" }));
  await user.type(
    screen.getByRole("textbox", { name: "搜索近期项目名称或编号" }),
    "社区",
  );
  expect(screen.getByRole("table").textContent).toContain("社区助老行动");
  expect(screen.getByRole("table").textContent).not.toContain(project.name);
  await user.clear(
    screen.getByRole("textbox", { name: "搜索近期项目名称或编号" }),
  );
  await user.click(screen.getByRole("button", { name: project.name }));
  const dialog = await screen.findByRole("dialog", { name: "项目基础详情" });
  expect(api).toHaveBeenCalledWith("/activity/projects/p-1");
  expect(within(dialog).getByText("学院团委")).toBeTruthy();
  expect(within(dialog).getByText("帮助来访学生")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "完成" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("creates a project through the API and reloads dashboard", async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce(project)
    .mockResolvedValueOnce(populated);
  const user = userEvent.setup();
  mount(api);
  await screen.findByText("从第一个志愿服务项目开始");
  await user.click(screen.getAllByRole("button", { name: "新建项目" })[0]);
  const dialog = screen.getByRole("dialog", { name: "新建志愿服务项目" });
  await user.type(within(dialog).getByLabelText(/项目名称/), project.name);
  await user.type(
    within(dialog).getByLabelText(/主办部门/),
    project.department,
  );
  fireEvent.change(within(dialog).getByLabelText(/开始日期/), {
    target: { value: project.starts_on },
  });
  fireEvent.change(within(dialog).getByLabelText(/结束日期/), {
    target: { value: project.ends_on },
  });
  await user.type(within(dialog).getByLabelText(/活动地点/), project.location);
  await user.click(within(dialog).getByRole("button", { name: "创建项目" }));
  await screen.findByText("项目已创建，当前状态为立项。");
  expect(api.mock.calls[1][0]).toBe("/activity/projects");
  expect(api.mock.calls[1][1].headers).toEqual({
    "X-Requested-With": "XMLHttpRequest",
  });
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({
    name: project.name,
    department: project.department,
    starts_on: project.starts_on,
    ends_on: project.ends_on,
    location: project.location,
    description: "",
  });
  expect(api).toHaveBeenLastCalledWith("/activity/dashboard");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("offers retry when dashboard fails and recovers without fabricated data", async () => {
  const api = vi
    .fn()
    .mockRejectedValueOnce(new Error("网络连接失败"))
    .mockResolvedValueOnce(empty);
  const user = userEvent.setup();
  mount(api);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("项目统计")).toBeNull();
  await user.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByText("从第一个志愿服务项目开始");
});

test.each([{ status: 401 }, { status: 403, code: 200009 }])(
  "delegates session recovery for $status / $code",
  async (error) => {
    const api = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("需重新验证"), error));
    const props = mount(api);
    await screen.findByRole("heading", { name: "活动管理工作台" });
    await vi.waitFor(() => expect(props.onSessionIssue).toHaveBeenCalled());
  },
);

test("keeps permission errors visible and navigates to profile", async () => {
  const api = vi.fn().mockRejectedValue(
    Object.assign(new Error("当前账号没有访问权限"), {
      status: 403,
      code: 200002,
    }),
  );
  const props = mount(api);
  const user = userEvent.setup();
  await screen.findByRole("alert");
  expect(props.onSessionIssue).not.toHaveBeenCalled();
  await user.click(screen.getByRole("link", { name: "个人信息" }));
  expect(props.onNavigate).toHaveBeenCalledWith("/profile");
});
