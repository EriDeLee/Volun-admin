import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PositionList from "./PositionList.tsx";
import type { Position } from "../lib/workflow.ts";

afterEach(cleanup);

test("positions are listed and new rows stay editable while typing", async () => {
  function Example() {
    const [positions, setPositions] = useState<Position[]>([
      {
        id: "p1",
        name: "引导",
        capacity: 3,
        hours: 4,
        description: "现场引导",
      },
    ]);
    return <PositionList positions={positions} onChange={setPositions} />;
  }
  render(<Example />);
  const user = userEvent.setup();
  expect(screen.getByText("现场引导")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(screen.getByRole("button", { name: "增加岗位" }));
  await user.type(screen.getByLabelText("岗位2名称"), "接待服务");
  await user.type(screen.getByLabelText("岗位2说明"), "接待来访人员");
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(screen.getByText("接待服务")).toBeTruthy();
  expect(screen.getByText("接待来访人员")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  await user.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  expect((screen.getByLabelText("岗位1名称") as HTMLInputElement).value).toBe(
    "引导",
  );
  await user.click(screen.getByRole("button", { name: "删除岗位2" }));
  expect(screen.queryByText("接待服务")).toBeNull();
});
