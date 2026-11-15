import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectAccountPicker from "./ProjectAccountPicker.tsx";
import { request } from "../lib/workflow.ts";

vi.mock("../lib/workflow.ts", () => ({ request: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("a slow account search cannot replace results for a newer query", async () => {
  let resolveOld!: (result: { items: unknown[] }) => void;
  vi.mocked(request)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({
      items: [{ username: "new", name: "新成员", number: "002", phone: "" }],
    });
  const onSelect = vi.fn();
  render(
    <ProjectAccountPicker base="/activity/projects/p" onSelect={onSelect} />,
  );
  const user = userEvent.setup();
  const input = screen.getByLabelText("姓名、学号或账号");
  await user.type(input, "旧账号");
  await user.click(screen.getByRole("button", { name: "查询志愿者账号" }));
  await user.clear(input);
  await user.type(input, "新账号");
  await user.click(screen.getByRole("button", { name: "查询志愿者账号" }));
  await screen.findByRole("button", { name: /选择 新成员/ });
  await act(async () =>
    resolveOld({
      items: [{ username: "old", name: "旧成员", number: "001", phone: "" }],
    }),
  );
  expect(screen.queryByRole("button", { name: /选择 旧成员/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /选择 新成员/ }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ username: "new", number: "002" }),
  );
});
