import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal.tsx";

beforeEach(() => {
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
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

test("nested native dialogs have distinct names and leave root scrolling styles untouched", async () => {
  document.body.style.overflow = "auto";
  function Nested() {
    const [inner, setInner] = useState(true);
    return (
      <Modal title="成员资料" onClose={() => {}}>
        <p>外层表单</p>
        {inner && (
          <Modal title="材料预览" onClose={() => setInner(false)}>
            预览内容
          </Modal>
        )}
      </Modal>
    );
  }
  const view = render(<Nested />);
  expect(screen.getByRole("dialog", { name: "成员资料" })).toBeTruthy();
  expect(document.body.style.overflow).toBe("auto");
  const inner = screen.getByRole("dialog", { name: "材料预览" });
  await userEvent.click(inner.querySelector<HTMLButtonElement>("button")!);
  expect(screen.queryByRole("dialog", { name: "材料预览" })).toBeNull();
  expect(document.body.style.overflow).toBe("auto");
  expect(screen.getByRole("dialog", { name: "成员资料" })).toBeTruthy();
  view.unmount();
  expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});
