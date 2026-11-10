import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VolunteerPage from "./VolunteerPage.tsx";
import { request } from "../lib/workflow.ts";
import type { WorkspaceProps } from "../types.ts";

vi.mock("../lib/workflow.ts", () => ({ request: vi.fn() }));
const project = {
  id: "p1",
  name: "校园引导服务",
  department: "学院",
  location: "广场",
  starts_on: "2026-11-10",
  ends_on: "2026-11-11",
  description: "服务新同学",
};
const props = (): WorkspaceProps => ({
  session: { user: { name: "同学", id: "001", groups: ["formal_user"] } },
  api: vi.fn(),
  onNavigate: vi.fn(),
  logout: vi.fn(),
  onSessionIssue: vi.fn(),
});
beforeEach(() => {
  vi.mocked(request).mockReset();
  sessionStorage.clear();
});
afterEach(cleanup);

test("incomplete profile returns through personal information before signing up", async () => {
  vi.mocked(request).mockResolvedValue({
    items: [
      {
        project,
        form_id: "f1",
        guarantees: ["提供饮水"],
        other_guarantee: "往返接送",
        registered: false,
        participated: false,
        recognized_hours: null,
      },
    ],
  });
  const p = props();
  render(<VolunteerPage {...p} mine={false} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "完善资料后报名" }),
  );
  expect(screen.getByText("提供饮水、往返接送")).toBeTruthy();
  expect(p.onNavigate).toHaveBeenCalledWith("/profile");
  expect(sessionStorage.getItem("volunteer_return")).toBe(
    "/signup?project=p1&form=f1",
  );
});

test("complete profile opens the published recruitment form", async () => {
  vi.mocked(request).mockResolvedValue({
    items: [
      {
        project,
        form_id: "f1",
        registered: false,
        participated: false,
        recognized_hours: null,
      },
    ],
  });
  const p = props();
  p.session.user.phone = "13800138000";
  render(<VolunteerPage {...p} mine={false} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "查看活动并报名" }),
  );
  expect(p.onNavigate).toHaveBeenCalledWith("/signup?project=p1&form=f1");
});

test("my services filters participation and opens only the caller's record", async () => {
  vi.mocked(request).mockResolvedValue({
    items: [
      {
        project,
        form_id: "",
        registered: true,
        participated: true,
        recognized_hours: 3,
      },
      {
        project: { ...project, id: "p2", name: "待参加活动" },
        form_id: "f2",
        registered: true,
        participated: false,
        recognized_hours: null,
      },
      {
        project: { ...project, id: "p3", name: "未报名活动" },
        form_id: "f3",
        registered: false,
        participated: false,
        recognized_hours: null,
      },
    ],
  });
  const p = props();
  render(<VolunteerPage {...p} mine />);
  await screen.findByRole("heading", { name: "校园引导服务" });
  expect(screen.queryByRole("heading", { name: "未报名活动" })).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText("服务记录"), "已参加");
  expect(screen.queryByRole("heading", { name: "待参加活动" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "查看本人服务记录" }),
  );
  expect(p.onNavigate).toHaveBeenCalledWith("/signup?project=p1");
});

test("load errors offer a successful retry", async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(new Error("连接失败"))
    .mockResolvedValueOnce({ items: [] });
  render(<VolunteerPage {...props()} mine={false} />);
  await screen.findByText("连接失败");
  await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByRole("heading", { name: "暂无正在招募的活动" });
});
