import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserImport from "./UserImport.tsx";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.unstubAllGlobals();
});

test("requires preview, invalidates preview after editing, and commits the reviewed content", async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  const onImported = vi.fn();
  const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    return {
      ok: true,
      json: async () => ({
        data: {
          valid: true,
          imported: body.commit ? 1 : 0,
          rows: [
            {
              line: 2,
              username: "alice",
              name: "成员",
              id: "001",
              groups: ["formal_user"],
              error: "",
            },
          ],
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <UserImport
      onClose={vi.fn()}
      onImported={onImported}
      onSessionIssue={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  const confirm = screen.getByRole("button", {
    name: "确认导入",
  }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  await user.type(
    screen.getByRole("textbox", { name: "CSV内容" }),
    "账号,姓名,学号,初始密码,用户组\nalice,成员,001,secret-password,formal_user",
  );
  await user.click(screen.getByRole("button", { name: "预检" }));
  await waitFor(() => expect(confirm.disabled).toBe(false));
  await user.type(screen.getByRole("textbox", { name: "CSV内容" }), "\n");
  expect(confirm.disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "预检" }));
  await waitFor(() => expect(confirm.disabled).toBe(false));
  await user.click(confirm);
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(1));
  expect(JSON.parse(String(fetcher.mock.calls[2][1].body)).commit).toBe(true);
});
