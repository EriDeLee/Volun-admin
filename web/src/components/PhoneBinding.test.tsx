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
