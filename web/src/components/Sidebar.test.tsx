import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

test.each([
  [
    "super_admin",
    [
      "工作台",
      "项目台账",
      "项目审批",
      "时长管理",
      "项目材料",
      "成员管理",
      "招募活动",
      "我的服务",
      "个人信息",
    ],
  ],
  [
    "data_admin",
    [
      "工作台",
      "项目台账",
      "项目审批",
      "时长管理",
      "项目材料",
      "招募活动",
      "我的服务",
      "个人信息",
    ],
  ],
  [
    "activity_admin",
    ["工作台", "项目台账", "招募活动", "我的服务", "个人信息"],
  ],
  ["formal_user", ["招募活动", "我的服务", "个人信息"]],
])(
  "%s sees the correct navigation on every authenticated page",
  (group, expected) => {
    const props = {
      session: { user: { name: "成员", groups: [group] } },
      onNavigate: vi.fn(),
      onClose: vi.fn(),
    };
    const view = render(<Sidebar {...props} route="/activity" />);
    for (const route of [
      "/activity",
      "/projects",
      "/projects/p1",
      "/hours",
      "/materials",
      "/users",
      "/profile",
    ]) {
      view.rerender(<Sidebar {...props} route={route} />);
      const nav = screen.getByRole("navigation", { name: "页面导航" });
      expect(
        within(nav)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(expected);
      const active = within(nav)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      expect(active.length).toBeLessThanOrEqual(1);
      if (route === "/projects/p1" && group !== "formal_user")
        expect(active[0].textContent).toBe("项目台账");
    }
  },
);

test("mobile navigation closes after choosing a page and the brand respects the role home", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      this.removeAttribute("open");
    },
  });
  const onClose = vi.fn(),
    onNavigate = vi.fn();
  render(
    <Sidebar
      session={{ user: { groups: ["super_admin"] } }}
      route="/activity"
      open
      onClose={onClose}
      onNavigate={onNavigate}
    />,
  );
  expect(screen.getByRole("dialog", { name: "主导航" })).toBeTruthy();
  expect(document.body.style.overflow).toBe("");
  await userEvent.click(screen.getByRole("link", { name: "成员管理" }));
  expect(onNavigate).toHaveBeenLastCalledWith("/users");
  expect(onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("link", { name: "志愿服务项目管理平台" }),
  );
  expect(onNavigate).toHaveBeenLastCalledWith("/activity");
  await userEvent.click(screen.getByRole("button", { name: "收起导航" }));
  expect(onClose).toHaveBeenCalledTimes(3);
  cleanup();
  expect(document.body.style.overflow).toBe("");
});
