import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountForm from "./AccountForm.tsx";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.unstubAllGlobals();
});

test("adds an individual member while preserving the student number and default group", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { valid: true, imported: 1, rows: [] } }),
  }));
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  render(
    <AccountForm
      onClose={vi.fn()}
      onSaved={onSaved}
      onSessionIssue={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "姓名" }), "测试成员");
  await user.type(screen.getByRole("textbox", { name: /学号/ }), "00123");
  await user.type(screen.getByRole("textbox", { name: "登录账号" }), "student");
  await user.type(screen.getByLabelText(/^初始密码/), "temporary-secret-123");
  await user.click(screen.getByRole("button", { name: "添加成员" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const [url, options] = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe("/api/v1/admin/users");
  expect(JSON.parse(String(options.body))).toMatchObject({
    username: "student",
    id: "00123",
    groups: ["formal_user"],
  });
});

test("resets the chosen member password and communicates the next-login requirement", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: {} }),
  }));
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  render(
    <AccountForm
      target={{
        username: "student",
        name: "测试成员",
        id: "00123",
        groups: ["formal_user"],
        status: "active",
        has_password: true,
        password_setup_required: false,
      }}
      onClose={vi.fn()}
      onSaved={onSaved}
      onSessionIssue={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^临时密码/), "replacement-secret-123");
  await user.click(screen.getByRole("button", { name: "确认重置密码" }));
  await waitFor(() =>
    expect(onSaved).toHaveBeenCalledWith(
      expect.stringContaining("下次登录需设置新密码"),
    ),
  );
  const [url, options] = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[0];
  expect(url).toBe("/api/v1/admin/users/student/reset-password");
  expect(JSON.parse(String(options.body))).toEqual({
    password: "replacement-secret-123",
  });
});
