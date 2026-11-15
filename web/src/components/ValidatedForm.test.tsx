import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ValidatedForm from "./ValidatedForm.tsx";
afterEach(cleanup);
test("password validation is implicit, uses UTF-8 and does not truncate", async () => {
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
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  await user.type(input, "好");
  expect(input.hasAttribute("aria-invalid")).toBe(false);
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
  expect(document.body.textContent).not.toMatch(/字节|字符/);
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
  expect(screen.getByLabelText("姓名").getAttribute("aria-invalid")).toBe(
    "true",
  );
  await user.type(screen.getByLabelText("姓名"), "同学");
  await user.type(screen.getByLabelText("时长"), "1.5");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText("时长").getAttribute("aria-invalid")).toBe(
    "true",
  );
  await user.clear(screen.getByLabelText("时长"));
  await user.type(screen.getByLabelText("时长"), "0");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(saved).toHaveBeenCalledTimes(1);
});
