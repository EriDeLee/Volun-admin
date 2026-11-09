import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttachmentMaterialFields, {
  checkinRules,
  recruitments,
  guarantees,
} from "./AttachmentMaterialFields.tsx";
import type { Basics, Material } from "../lib/workflow.ts";

afterEach(cleanup);
test("attachment1 offers reference options and fixed contacts", async () => {
  const changed = vi.fn();
  function Editor() {
    const [value, setValue] = useState({
      guarantees: [],
      contact_name: "环境联系人",
      contact_email: "test@example.test",
    } as unknown as Material);
    return (
      <AttachmentMaterialFields
        value={value}
        basics={
          {
            name: "测试项目",
            location: "测试地点",
            starts_on: "2026-11-13",
            ends_on: "2026-11-14",
            sessions: [],
          } as unknown as Basics
        }
        onChange={(next) => {
          setValue(next);
          changed(next);
        }}
        onEditPositions={vi.fn()}
      />
    );
  }
  render(<Editor />);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "联系人姓名" })
      .readOnly,
  ).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("textbox", { name: "联系人姓名" }).value,
  ).toBe("环境联系人");
  expect(screen.getAllByRole("checkbox")).toHaveLength(guarantees.length);
  const user = userEvent.setup();
  for (const rule of checkinRules)
    await user.selectOptions(
      screen.getByRole("combobox", { name: "打卡规则" }),
      rule,
    );
  for (const option of recruitments)
    await user.selectOptions(
      screen.getByRole("combobox", { name: "志愿者招募范围" }),
      option,
    );
  await user.click(screen.getByRole("checkbox", { name: "提供饮水" }));
  await user.click(screen.getByRole("checkbox", { name: "专项培训" }));
  expect(changed.mock.lastCall?.[0]).toMatchObject({
    checkin_rule: "定位扫码",
    recruitment: "定向招募",
    guarantees: ["提供饮水", "专项培训"],
  });
  expect(screen.getByLabelText("免审密码").hasAttribute("disabled")).toBe(true);
  await user.selectOptions(
    screen.getByRole("combobox", { name: "志愿者招募范围" }),
    "免审密码招募",
  );
  expect(screen.getByLabelText("免审密码").hasAttribute("disabled")).toBe(
    false,
  );
});
