import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ValidatedForm from "./ValidatedForm.tsx";
afterEach(cleanup);
test("password errors explain UTF-8 limits, clear on correction and do not truncate", async () => {
  const saved = vi.fn();
  function Example() {
    const [password, setPassword] = useState("");
    return (
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          saved(password);
        }}
      >
        <label>
          密码
          <input
            required
            data-validate="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button>保存</button>
      </ValidatedForm>
    );
  }
  render(<Example />);
  const user = userEvent.setup();
  const input = screen.getByLabelText<HTMLInputElement>("密码");
  await user.type(input, "短密码");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  await user.tab();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const description = () =>
    document.getElementById(input.getAttribute("aria-describedby") || "");
  expect(description()?.textContent).toContain("密码太短");
  expect(description()?.textContent).toContain("12–72 字节");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  await user.type(input, "好");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  expect(input.hasAttribute("aria-describedby")).toBe(false);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledWith("短密码好");
  const long = "测".repeat(25);
  fireEvent.change(input, { target: { value: long } });
  expect(input.value).toBe(long);
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledTimes(1);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.hasAttribute("maxlength")).toBe(false);
  expect(input.hasAttribute("minlength")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(description()?.textContent).toContain("密码太长");
  expect(description()?.textContent).toContain("常用汉字通常占 3 字节");
});
test("required and numeric fields clear only when corrected, including valid zero", async () => {
  const saved = vi.fn();
  render(
    <ValidatedForm
      onSubmit={(event) => {
        event.preventDefault();
        saved();
      }}
    >
      <label>
        姓名
        <input required />
      </label>
      <label>
        时长
        <input type="number" min={0} step={1} />
      </label>
      <button>保存</button>
    </ValidatedForm>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(
    screen.getByRole("textbox", { name: "姓名" }).getAttribute("aria-invalid"),
  ).toBe("true");
  await user.type(screen.getByRole("textbox", { name: "姓名" }), "同学");
  await user.type(screen.getByRole("spinbutton", { name: "时长" }), "1.5");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).not.toHaveBeenCalled();
  expect(
    screen
      .getByRole("spinbutton", { name: "时长" })
      .getAttribute("aria-invalid"),
  ).toBe("true");
  await user.clear(screen.getByRole("spinbutton", { name: "时长" }));
  await user.type(screen.getByRole("spinbutton", { name: "时长" }), "0");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledTimes(1);
});

test("login passwords preserve whitespace and do not inherit new-password limits", () => {
  const saved = vi.fn();
  render(
    <ValidatedForm
      onSubmit={(event) => {
        event.preventDefault();
        saved();
      }}
    >
      <label>
        登录密码
        <input required type="password" autoComplete="current-password" />
      </label>
      <button>登录</button>
    </ValidatedForm>,
  );
  const input = screen.getByLabelText<HTMLInputElement>("登录密码");
  const form = input.form!;
  fireEvent.submit(form);
  expect(saved).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  for (const type of ["password", "text"]) {
    input.type = type;
    for (const value of [" ".repeat(12), "short", "x".repeat(73)]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(form);
      expect(input.hasAttribute("aria-invalid")).toBe(false);
    }
  }
  expect(saved).toHaveBeenCalledTimes(6);
});

test("confirmation errors preserve hints, track corrections and clear on reset", async () => {
  const saved = vi.fn();
  render(
    <ValidatedForm
      onSubmit={(event) => {
        event.preventDefault();
        saved();
      }}
    >
      <label htmlFor="test-new-password">新密码</label>
      <input
        id="test-new-password"
        required
        data-validate="password"
        autoComplete="new-password"
        defaultValue="valid-password"
      />
      <label htmlFor="test-confirm">确认密码</label>
      <input
        id="test-confirm"
        required
        data-matches="test-new-password"
        autoComplete="new-password"
        aria-describedby="confirm-hint"
      />
      <span id="confirm-hint">请再次输入新密码</span>
      <button>保存</button>
      <button type="reset">重置</button>
    </ValidatedForm>,
  );
  const user = userEvent.setup();
  const confirmation = screen.getByLabelText<HTMLInputElement>("确认密码");
  await user.type(confirmation, "different-password");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(confirmation);
  const descriptions = confirmation
    .getAttribute("aria-describedby")!
    .split(" ");
  expect(descriptions).toContain("confirm-hint");
  expect(document.getElementById(descriptions[1])?.textContent).toBe(
    "两次密码不一致。",
  );
  await user.clear(confirmation);
  await user.type(confirmation, "valid-password");
  expect(confirmation.getAttribute("aria-describedby")).toBe("confirm-hint");
  expect(document.getElementById(descriptions[1])).toBeNull();
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledTimes(1);
  await user.type(confirmation, "x");
  await user.click(screen.getByRole("button", { name: "重置" }));
  expect(confirmation.getAttribute("aria-describedby")).toBe("confirm-hint");
  expect(confirmation.hasAttribute("aria-invalid")).toBe(false);
  expect(document.querySelector(".field-error")).toBeNull();
});

test("new password confirmation preserves whitespace accepted by the password rule", () => {
  const saved = vi.fn();
  render(
    <ValidatedForm
      onSubmit={(event) => {
        event.preventDefault();
        saved();
      }}
    >
      <input
        id="whitespace-password"
        aria-label="新密码"
        required
        autoComplete="new-password"
        data-validate="password"
        defaultValue={" ".repeat(12)}
      />
      <input
        aria-label="确认密码"
        required
        autoComplete="new-password"
        data-matches="whitespace-password"
        defaultValue={" ".repeat(12)}
      />
    </ValidatedForm>,
  );
  fireEvent.submit(screen.getByLabelText<HTMLInputElement>("新密码").form!);
  expect(saved).toHaveBeenCalledTimes(1);
});
