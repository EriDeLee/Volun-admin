import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

if (!globalThis.TextEncoder)
  globalThis.TextEncoder = (await import("node:util")).TextEncoder;

const session = {
  user: {
    sub: "local-001",
    id: "001234",
    name: "测试同学",
    username: "tester",
    groups: ["activity_admin"],
  },
  auth_method: "session",
};
const reply = (data, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => ({ errcode: status === 200 ? 0 : 200001, data }),
});
beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("restores identity from the server with leading-zero ID and actual groups", async () => {
  fetch.mockResolvedValue(reply(session));
  render(<App />);
  await screen.findByRole("heading", { name: "个人信息" });
  expect(screen.getByText("001234")).toBeTruthy();
  expect(document.body.textContent).not.toContain("local-001");
  expect(screen.queryByText("平台用户标识")).toBeNull();
  expect(screen.getAllByText("活动管理员").length).toBeGreaterThan(0);
  expect(screen.getByText("已通过会话验证")).toBeTruthy();
  expect(location.pathname).toBe("/profile");
});

test("login failure keeps username, clears password, and allows a successful retry", async () => {
  fetch
    .mockResolvedValueOnce(reply(null, 401))
    .mockResolvedValueOnce(reply(null, 401))
    .mockResolvedValueOnce(reply({ ...session, auth_method: "password" }));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "登录平台" });
  await user.type(screen.getByLabelText("账号"), "tester");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "wrong-password",
  );
  await user.click(screen.getByRole("button", { name: "登录平台" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("账号").value).toBe("tester");
  expect(screen.getByLabelText("密码", { exact: true }).value).toBe("");
  await user.type(
    screen.getByLabelText("密码", { exact: true }),
    "correct-password",
  );
  await user.click(screen.getByRole("button", { name: "登录平台" }));
  await screen.findByRole("heading", { name: "个人信息" });
  expect(screen.getByText("账号密码登录")).toBeTruthy();
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    username: "tester",
    password: "correct-password",
  });
  expect(localStorage.length).toBe(0);
});

test("network errors during session recovery offer retry instead of showing authenticated content", async () => {
  fetch
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reply(session));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "暂时无法确认登录状态" });
  expect(screen.queryByRole("heading", { name: "个人信息" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "重新连接" }));
  await screen.findByRole("heading", { name: "个人信息" });
});

test("logout failure preserves identity; retry clears it only after server success", async () => {
  fetch
    .mockResolvedValueOnce(reply(session))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reply(null));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "个人信息" });
  await user.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "个人信息" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "退出登录" }));
  await screen.findByRole("button", { name: "登录平台" });
  expect(location.pathname).toBe("/login");
  expect(screen.queryByText("001234")).toBeNull();
});

test("refreshing an expired session clears profile and requests a new login", async () => {
  fetch
    .mockResolvedValueOnce(reply(session))
    .mockResolvedValueOnce(reply(null, 401));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "个人信息" });
  await user.click(screen.getByRole("button", { name: "刷新信息" }));
  await screen.findByRole("button", { name: "登录平台" });
  expect(screen.queryByText("001234")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("登录已失效");
});

test("SSO failure is readable and the retry uses backend browser navigation", async () => {
  history.replaceState(null, "", "/login?sso=failed");
  fetch.mockResolvedValue(reply(null, 401));
  render(<App />);
  await screen.findByRole("button", { name: "登录平台" });
  expect(screen.getByRole("alert").textContent).toContain("学校统一认证未完成");
  expect(
    screen.getByRole("link", { name: "学校统一认证" }).getAttribute("href"),
  ).toBe("/api/v1/auth/sso/start?return_to=%2Fprofile");
});

test("blocks repeated login while the request is pending", async () => {
  let resolveLogin;
  fetch.mockResolvedValueOnce(reply(null, 401)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("button", { name: "登录平台" });
  await user.type(screen.getByLabelText("账号"), "tester");
  await user.type(screen.getByLabelText("密码", { exact: true }), "password");
  await user.dblClick(screen.getByRole("button", { name: "登录平台" }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "正在登录…" }).disabled).toBe(true);
  resolveLogin(reply(session));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "个人信息" })).toBeTruthy(),
  );
});

test("new SSO identity is sent to the required password setup page and then to profile", async () => {
  const firstLogin = { ...session, password_setup_required: true };
  const completed = {
    ...session,
    auth_method: "sso",
    password_setup_required: false,
  };
  fetch
    .mockResolvedValueOnce(reply(firstLogin))
    .mockResolvedValueOnce(reply(completed));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "请设置登录密码" });
  expect(document.body.textContent).not.toContain("local-001");
  expect(screen.getByText("平台登录账号：tester")).toBeTruthy();
  expect(location.pathname).toBe("/set-password");
  await user.type(
    screen.getByLabelText("新密码"),
    "a-secure-password-for-this-user",
  );
  await user.type(
    screen.getByLabelText("确认新密码"),
    "a-secure-password-for-this-user",
  );
  await user.click(screen.getByRole("button", { name: "设置密码并继续" }));
  await screen.findByRole("heading", { name: "个人信息" });
  expect(location.pathname).toBe("/profile");
  expect(fetch.mock.calls[1][0]).toBe("/api/v1/auth/setup-password");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    password: "a-secure-password-for-this-user",
  });
});

test("password setup rejects mismatched confirmations without sending a request", async () => {
  fetch.mockResolvedValue(reply({ ...session, password_setup_required: true }));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "请设置登录密码" });
  await user.type(
    screen.getByLabelText("新密码"),
    "a-secure-password-for-this-user",
  );
  await user.type(
    screen.getByLabelText("确认新密码"),
    "a-different-password-value",
  );
  await user.click(screen.getByRole("button", { name: "设置密码并继续" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "两次输入的密码不一致",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
