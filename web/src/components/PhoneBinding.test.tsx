import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PhoneBinding from "./PhoneBinding.tsx";
import { request } from "../lib/workflow.ts";

vi.mock("../lib/workflow.ts", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("invalid phone stays marked until corrected without sending a request", async () => {
  vi.mocked(request).mockRejectedValueOnce(
    Object.assign(new Error("手机号格式不正确"), { status: 400 }),
  );
  render(<PhoneBinding onBound={vi.fn()} />);
  const user = userEvent.setup();
  const input = screen.getByRole("textbox", { name: "绑定手机号" });
  await user.type(input, "123");
  await user.click(screen.getByRole("button", { name: "绑定手机号" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(input);

  await user.type(input, "4");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  await user.clear(input);
  await user.type(input, "13800000001");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});
test("phone binding reports conflicts and then updates session on success", async () => {
  const phone = "130" + "0".repeat(7) + "1";
  const session = { user: { name: "测试", phone, groups: ["formal_user"] } };
  vi.mocked(request)
    .mockRejectedValueOnce(new Error("该手机号已绑定其他账号"))
    .mockResolvedValueOnce(session);
  const onBound = vi.fn();
  render(<PhoneBinding onBound={onBound} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("绑定手机号"), phone);
  await user.click(screen.getByRole("button", { name: "绑定手机号" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "已绑定其他账号",
  );
  expect(onBound).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "绑定手机号" }));
  await screen.findByRole("status");
  expect(request).toHaveBeenLastCalledWith("/auth/phone", { phone }, "PUT");
  expect(onBound).toHaveBeenCalledWith(session);
});
