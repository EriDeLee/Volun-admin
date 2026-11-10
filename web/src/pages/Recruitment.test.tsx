import type { ComponentProps, ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkflowPage from "./WorkflowPage.tsx";
import ParticipantPage from "./ParticipantPage.tsx";
import { request, type Workflow } from "../lib/workflow.ts";

vi.mock("../lib/workflow.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  request: vi.fn(),
}));
vi.mock("../components/WorkspaceShell.tsx", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Brand: () => <span>志愿服务</span>,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

const sessions = ["上午", "下午"].map((name, i) => ({
  id: `s${i + 1}`,
  name,
  start: "2026-11-09T08:00:00+08:00",
  end: "2026-11-09T12:00:00+08:00",
  positions: [
    {
      id: `p${i + 1}`,
      name: i ? "服务" : "引导",
      capacity: 10,
      description: "",
      hours: null,
    },
  ],
}));
const initial = () =>
  ({
    project: { id: "p", name: "测试项目", code: "TEST", status: "招募" },
    version: 1,
    approval: "approved",
    capabilities: ["forms.write", "members.write"],
    state: {
      basics: {
        name: "测试项目",
        department: "测试",
        starts_on: "2026-11-09",
        ends_on: "2026-11-09",
        location: "广场",
        description: "",
        sessions,
      },
      draft: null,
      applications: [],
      members: [],
      windows: [],
      attendance: [],
      hours: [],
      form: {
        id: "f",
        published: true,
        title: "原问卷",
        description: "",
        deadline: "",
      },
      intent_form: {
        id: "",
        published: false,
        title: "",
        description: "",
        deadline: "",
      },
      material: {},
      review: { published: false },
      legacy: false,
    },
  }) as unknown as Workflow;
const props = {
  id: "p",
  initialTab: "forms",
  session: { user: { groups: ["data_admin"] } },
  api: vi.fn(),
  onNavigate: vi.fn(),
  logout: vi.fn(),
  onSessionIssue: vi.fn(),
} as ComponentProps<typeof WorkflowPage>;

test("member deletion requires confirmation and refreshes the roster", async () => {
  const data = initial();
  data.state.members = [
    {
      id: "m",
      name: "测试成员",
      number: "001",
      department: "",
      phone: "",
      session_id: "s1",
      position_id: "p1",
      source: "manual",
      intent: "未填写",
      platform: "",
    },
  ];
  vi.mocked(request).mockImplementation(async (path, _body, method) => {
    if (path.endsWith("/history"))
      return { events: [], materials: [] } as never;
    if (method === "DELETE")
      return {
        ...data,
        version: 2,
        state: { ...data.state, members: [] },
      } as never;
    return data as never;
  });
  const confirm = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
  render(<WorkflowPage {...props} initialTab="recruit" />);
  const button = await screen.findByRole("button", {
    name: "删除",
  });
  const user = userEvent.setup();
  await user.click(button);
  expect(
    vi.mocked(request).mock.calls.some((call) => call[2] === "DELETE"),
  ).toBe(false);
  confirm.mockReturnValue(true);
  await user.click(button);
  await screen.findByText("成员已删除。");
  expect(request).toHaveBeenCalledWith(
    "/activity/projects/p/members/m",
    {},
    "DELETE",
    1,
  );
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
});

test("navigation follows the activity sequence and attachment3 is a placeholder", async () => {
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/history")
      ? ({ events: [], materials: [] } as never)
      : (initial() as never),
  );
  render(<WorkflowPage {...props} initialTab="review" />);
  await screen.findByRole("heading", { name: "附件3" });
  expect(
    screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-label")),
  ).toEqual([
    "立项",
    "招募问卷与二维码",
    "成员名单",
    "附件1",
    "现场出勤",
    "计时与时长",
    "附件3",
    "操作记录",
  ]);
  expect(
    screen.getByRole("tab", { name: "现场出勤" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("tab", { name: "计时与时长" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("功能待完善")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "目标阶段" })).toBeNull();
  expect(screen.queryByRole("button", { name: "确认流程处理" })).toBeNull();
});

test("direct hours links show a reason before the first session ends", async () => {
  const data = initial();
  data.project.status = "进行";
  data.state.basics.sessions = sessions.map((s) => ({
    ...s,
    start: "2999-11-09T08:00:00+08:00",
    end: "2999-11-09T12:00:00+08:00",
  }));
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/history")
      ? ({ events: [], materials: [] } as never)
      : (data as never),
  );
  render(<WorkflowPage {...props} initialTab="hours" />);
  await screen.findByRole("heading", { name: "计时与时长尚未开放" });
  expect(screen.getByText(/首场“上午”结束后开放/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "保存时长 / 批量补录" }),
  ).toBeNull();
  expect(
    screen.getByRole("tab", { name: "现场出勤" }).hasAttribute("disabled"),
  ).toBe(false);
});

test("preparation confirmation requires both a roster and generated attachment1", async () => {
  const data = initial();
  data.capabilities.push("workflow.write");
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/history")
      ? ({ events: [], materials: [] } as never)
      : (data as never),
  );
  render(<WorkflowPage {...props} />);
  const button = await screen.findByRole("button", {
    name: "确认准备完成，开放现场出勤",
  });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("待录入成员名单")).toBeTruthy();
  expect(screen.getByText("待生成附件1")).toBeTruthy();
});

test.each([false, true])(
  "publishing uses latest version and recovers one unrelated conflict: %s",
  async (race) => {
    let reads = 0,
      writes = 0;
    vi.mocked(request).mockImplementation(
      async (path, _body, _method, version) => {
        if (path.endsWith("/history"))
          return { events: [], materials: [] } as never;
        if (path.endsWith("/workflow")) {
          const value = initial();
          value.version = ++reads;
          return value as never;
        }
        if (path.endsWith("/forms")) {
          writes++;
          expect(version).toBe(race && writes === 2 ? 3 : 2);
          if (race && writes === 1)
            throw Object.assign(new Error("版本变化"), {
              status: 409,
              code: 100003,
            });
          return initial() as never;
        }
        throw new Error(path);
      },
    );
    render(<WorkflowPage {...props} />);
    await screen.findByDisplayValue("原问卷");
    await userEvent.click(screen.getByRole("button", { name: "保存问卷" }));
    await screen.findByText("已保存到服务器。");
    expect(writes).toBe(race ? 2 : 1);
  },
);

test("concurrent form edit preserves the draft and requires review before writing", async () => {
  let reads = 0;
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/history"))
      return { events: [], materials: [] } as never;
    const value = initial();
    if (++reads > 1) value.state.form.title = "其他管理员的标题";
    return value as never;
  });
  render(<WorkflowPage {...props} />);
  const title = await screen.findByDisplayValue("原问卷");
  await userEvent.clear(title);
  await userEvent.type(title, "我的草稿");
  await userEvent.click(screen.getByRole("button", { name: "保存问卷" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "填写内容已保留",
  );
  expect(screen.getByDisplayValue("我的草稿")).toBeTruthy();
  expect(
    vi.mocked(request).mock.calls.some(([path]) => path.endsWith("/forms")),
  ).toBe(false);
});

test("recruit form waits for its type without flashing an SSO prompt", async () => {
  history.replaceState(null, "", "/signup?project=p&form=f");
  let resolveForm!: (value: unknown) => void;
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === "/auth/me")
      throw Object.assign(new Error("未登录"), { status: 401 });
    if (path.endsWith("/forms/f"))
      return (await new Promise<unknown>((resolve) => {
        resolveForm = resolve;
      })) as never;
    throw new Error("未报名");
  });
  render(<ParticipantPage />);
  expect(screen.getByRole("status").textContent).toContain("正在加载");
  expect(screen.queryByRole("button", { name: /SSO/ })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "姓名" })).toBeNull();
  resolveForm({
    project: "测试项目",
    kind: "recruit",
    form: initial().state.form,
    sessions,
  });
  await screen.findByRole("button", { name: "学校 SSO 登录" });
  expect(screen.queryByRole("textbox", { name: "姓名" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "手动填写" }));
  await screen.findByRole("textbox", { name: "姓名" });
});

test("an unavailable recruit form shows its error without an SSO fallback", async () => {
  history.replaceState(null, "", "/signup?project=p&form=f");
  vi.mocked(request).mockRejectedValue(new Error("问卷或签到窗口已关闭"));
  render(<ParticipantPage />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: /SSO/ })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "姓名" })).toBeNull();
});

test("fixed public questionnaire submits multiple choices and notes", async () => {
  history.replaceState(null, "", "/signup?project=p&form=f");
  let submitted: unknown;
  vi.mocked(request).mockImplementation(async (path, body) => {
    if (path === "/auth/me")
      throw Object.assign(new Error("未登录"), { status: 401 });
    if (path.endsWith("/forms/f"))
      return {
        project: "测试项目",
        kind: "recruit",
        form: initial().state.form,
        sessions,
      } as never;
    if (path.endsWith("/me")) throw new Error("未报名");
    if (path.endsWith("/responses")) {
      submitted = body;
      return { member: {}, credential: "synthetic-credential" } as never;
    }
    throw new Error(path);
  });
  render(<ParticipantPage />);
  await userEvent.click(
    await screen.findByRole("button", { name: "手动填写" }),
  );
  await screen.findByRole("textbox", { name: "姓名" });
  expect(screen.queryByRole("textbox", { name: "部门" })).toBeNull();
  await userEvent.type(
    screen.getByRole("textbox", { name: "姓名" }),
    "测试成员",
  );
  await userEvent.type(screen.getByRole("textbox", { name: "学号" }), "001");
  await userEvent.type(
    screen.getByRole("textbox", { name: "联系电话" }),
    "13800000000",
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /引导/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: /服务/ }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "其他备注" }),
    "可协助布场",
  );
  await userEvent.click(screen.getByRole("button", { name: "提交报名" }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      member: {
        name: "测试成员",
        number: "001",
        notes: "可协助布场",
        session_id: "s1",
        position_id: "p1",
        assignments: [
          { session_id: "s1", position_id: "p1" },
          { session_id: "s2", position_id: "p2" },
        ],
      },
    }),
  );
});

test.each([false, true])(
  "account identity is auto-filled after existing session or password login: %s",
  async (passwordLogin) => {
    history.replaceState(null, "", "/signup?project=p&form=f");
    let loggedIn = !passwordLogin;
    const authenticated = {
      user: {
        name: "账号姓名",
        id: "001234",
        phone: "13800000001",
        groups: ["formal_user"],
      },
    };
    vi.mocked(request).mockImplementation(async (path) => {
      if (path === "/auth/login") {
        loggedIn = true;
        return authenticated as never;
      }
      if (path === "/auth/me") {
        if (!loggedIn)
          throw Object.assign(new Error("未登录"), { status: 401 });
        return authenticated as never;
      }
      if (path.endsWith("/forms/f"))
        return {
          project: "测试项目",
          kind: "recruit",
          form: initial().state.form,
          sessions,
        } as never;
      throw new Error("未报名");
    });
    render(<ParticipantPage />);
    if (passwordLogin) {
      await userEvent.click(
        await screen.findByRole("button", { name: "账号密码登录" }),
      );
      await userEvent.type(screen.getByLabelText("平台账号"), "tester");
      await userEvent.type(
        screen.getByLabelText("平台密码"),
        "synthetic-password",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "登录并继续报名" }),
      );
    }
    const name = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "姓名",
    });
    expect(name.value).toBe("账号姓名");
    expect(name.readOnly).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "联系电话" }).value,
    ).toBe("13800000001");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "学号" }).value,
    ).toBe("001234");
    expect(screen.queryByRole("button", { name: "手动填写" })).toBeNull();
    expect(location.pathname + location.search).toBe(
      "/signup?project=p&form=f",
    );
  },
);

test("an account without a phone binds it before registration", async () => {
  history.replaceState(null, "", "/signup?project=p&form=f");
  const phone = "130" + "0".repeat(7) + "1";
  const account = {
    name: "账号姓名",
    id: "001234",
    phone: "",
    groups: ["formal_user"],
  };
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === "/auth/me") return { user: account } as never;
    if (path === "/auth/phone") return { user: { ...account, phone } } as never;
    if (path.endsWith("/forms/f"))
      return {
        project: "测试项目",
        kind: "recruit",
        form: initial().state.form,
        sessions,
      } as never;
    throw new Error("未报名");
  });
  render(<ParticipantPage />);
  await screen.findByRole("heading", { name: "完善报名资料" });
  expect(screen.queryByRole("button", { name: "提交报名" })).toBeNull();
  await userEvent.type(screen.getByLabelText("绑定手机号"), phone);
  await userEvent.click(screen.getByRole("button", { name: "绑定手机号" }));
  const input = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "联系电话",
  });
  expect(input.value).toBe(phone);
  expect(input.readOnly).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "姓名" }).value,
  ).toBe(account.name);
  expect(screen.queryByRole("heading", { name: "绑定报名手机号" })).toBeNull();
});

test("project registration selects an account without directory access", async () => {
  const data = initial();
  const candidate = {
    username: "volunteer",
    name: "已有账号志愿者",
    number: "001235",
    phone: "13000000001",
  };
  let saved: unknown;
  vi.mocked(request).mockImplementation(async (path, body) => {
    if (path.includes("/members/candidates?"))
      return { items: [candidate] } as never;
    if (path.endsWith("/history"))
      return { events: [], materials: [] } as never;
    if (path.endsWith("/members")) saved = body;
    return data as never;
  });
  render(<WorkflowPage {...props} initialTab="recruit" />);
  await userEvent.type(
    await screen.findByLabelText("姓名、学号或账号"),
    "001235",
  );
  await userEvent.click(screen.getByRole("button", { name: "查询志愿者账号" }));
  await userEvent.click(
    await screen.findByRole("button", { name: /选择 已有账号志愿者/ }),
  );
  const name = screen.getByRole<HTMLInputElement>("textbox", {
    name: "姓名",
  });
  expect(name.value).toBe(candidate.name);
  expect(name.readOnly).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "联系电话" }).value,
  ).toBe(candidate.phone);
  await userEvent.click(screen.getByRole("checkbox", { name: /引导/ }));
  await userEvent.click(screen.getByRole("button", { name: "保存成员" }));
  await waitFor(() =>
    expect(saved).toMatchObject({
      members: [
        {
          account_username: candidate.username,
          name: candidate.name,
          number: candidate.number,
        },
      ],
    }),
  );
  expect(
    vi.mocked(request).mock.calls.some(([path]) => path.startsWith("/admin/")),
  ).toBe(false);
});

test("identity review excludes account registrations", async () => {
  const data = initial();
  data.state.members = [
    {
      id: "account",
      name: "账号成员",
      number: "001",
      identity_source: "account",
      identity_verified: true,
    },
    {
      id: "manual",
      name: "手填成员",
      number: "002",
      identity_source: "manual",
      identity_verified: false,
    },
  ] as Workflow["state"]["members"];
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/history")
      ? ({ events: [], materials: [] } as never)
      : (data as never),
  );
  render(<WorkflowPage {...props} initialTab="recruit" />);
  await screen.findByText("账号身份已确认");
  expect(screen.queryByRole("option", { name: /账号成员/ })).toBeNull();
  expect(screen.getByRole("option", { name: /手填成员.*待核实/ })).toBeTruthy();
});
