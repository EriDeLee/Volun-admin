import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AttachmentPreview from "./AttachmentPreview.tsx";
import { renderAsync } from "docx-preview";

vi.mock("docx-preview", () => ({ renderAsync: vi.fn() }));

const file = {
  id: "v2",
  version: 2,
  filename: "附件1.docx",
  checksum: "",
  template_checksum: "",
  created_at: "2026-11-10",
};
const fetchMock = vi.fn();
const revoke = vi.fn();
const bytes = new ArrayBuffer(8);
const blob = { arrayBuffer: async () => bytes };
const props = {
  file,
  url: "/api/v1/activity/projects/p/material/v2",
  onClose: vi.fn(),
  onSessionIssue: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
    },
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:attachment-v2");
      static revokeObjectURL = revoke;
    },
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

test("previews and downloads the same version, then releases its URL on close", async () => {
  fetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
  const { unmount } = render(<AttachmentPreview {...props} />);
  fireEvent.load(screen.getByTitle("附件1 Word 页面预览"));
  const download = await screen.findByRole("link", { name: "下载 Word" });
  await waitFor(() => expect(renderAsync).toHaveBeenCalled());
  expect(renderAsync).toHaveBeenCalledWith(
    bytes,
    expect.anything(),
    expect.anything(),
    expect.objectContaining({ renderAltChunks: false, breakPages: true }),
  );
  expect(download.getAttribute("href")).toBe("blob:attachment-v2");
  expect(download.getAttribute("download")).toBe(file.filename);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:attachment-v2");
});

test("denied access disables download and allows retry without bypassing permissions", async () => {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: async () => ({ errcode: 200002 }),
  });
  render(<AttachmentPreview {...props} />);
  fireEvent.load(screen.getByTitle("附件1 Word 页面预览"));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "没有查看此材料的权限",
  );
  expect(screen.queryByRole("link", { name: "下载 Word" })).toBeNull();
  expect(renderAsync).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
  await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByRole("link", { name: "下载 Word" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
