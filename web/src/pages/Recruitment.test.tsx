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

test("fixed public questionnaire submits multiple choices and notes", async () => {
  history.replaceState(null, "", "/signup?project=p&form=f");
  let submitted: unknown;
  vi.mocked(request).mockImplementation(async (path, body) => {
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
        assignments: [
          { session_id: "s1", position_id: "p1" },
          { session_id: "s2", position_id: "p2" },
        ],
      },
    }),
  );
});
