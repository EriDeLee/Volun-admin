import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TableImport from "./TableImport.tsx";
afterEach(cleanup);
test("paste preview retains leading zeroes and requires correction of invalid cells", async () => {
  const save = vi.fn().mockResolvedValue(true);
  render(
    <TableImport
      label="粘贴时长"
      busy={false}
      columns={[
        {
          key: "number",
          label: "编号",
          required: true,
          validate: (value) => value === "00123",
        },
        {
          key: "hours",
          label: "时长",
          type: "number",
          min: 0,
          max: 100000,
          step: 1,
          required: true,
        },
      ]}
      onImport={save}
    />,
  );
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText("粘贴时长"), {
    target: { value: "00999\t-2" },
  });
  await user.click(screen.getByRole("button", { name: "导入" }));
  expect(save).not.toHaveBeenCalled();
  const number = screen.getByLabelText<HTMLInputElement>("编号，第 1 行");
  const hours = screen.getByLabelText("时长，第 1 行");
  expect(number.getAttribute("aria-invalid")).toBe("true");
  await user.clear(number);
  await user.type(number, "00123");
  await user.clear(hours);
  await user.type(hours, "0");
  await user.click(screen.getByRole("button", { name: "导入" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith([{ number: "00123", hours: "0" }]),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText("编号，第 1 行")).toBeNull(),
  );
});
