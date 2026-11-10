import { useEffect, useRef, useState } from "react";
import type { ApiError } from "../types.ts";
import type { History } from "../lib/workflow.ts";
import Icon from "./Icon.tsx";
import "./AttachmentPreview.css";

// Keep document styles and links isolated from the application. No scripts or
// external resources are allowed in the document frame.
const frameHTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:"><style>html,body{margin:0;background:#e9edf3;color:#111}body{min-width:fit-content}.docx-wrapper{padding:24px!important}section.docx{color:#111;background:white}@media(max-width:600px){.docx-wrapper{padding:12px!important}}</style></head><body></body></html>`;

export default function AttachmentPreview({
  file,
  url,
  onClose,
  onSessionIssue,
}: {
  file: History["materials"][number];
  url: string;
  onClose: () => void;
  onSessionIssue: (error: ApiError) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadURL, setDownloadURL] = useState("");
  const [zoom, setZoom] = useState("fit");
  const sessionIssue = useRef(onSessionIssue);
  sessionIssue.current = onSessionIssue;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const document = frame.current?.contentDocument;
    if (!ready || !document) return;
    const controller = new AbortController();
    let disposed = false;
    let objectURL = "";
    setLoading(true);
    setError("");
    setDownloadURL("");
    document.body.replaceChildren();
    const load = async () => {
      try {
        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const failure: ApiError = new Error(
            response.status === 401
              ? "登录已失效，请重新登录。"
              : response.status === 403
                ? "当前账号没有查看此材料的权限。"
                : "无法读取附件，请稍后重试。",
          );
          failure.status = response.status;
          failure.code = body?.errcode;
          throw failure;
        }
        const blob = await response.blob();
        if (disposed) return;
        objectURL = URL.createObjectURL(blob);
        setDownloadURL(objectURL);
        const { renderAsync } = await import("docx-preview");
        if (disposed) return;
        await renderAsync(
          await blob.arrayBuffer(),
          document.body,
          document.body,
          {
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderAltChunks: false,
            useBase64URL: true,
          },
        );
      } catch (cause) {
        if (disposed) return;
        const failure = cause as ApiError;
        if (failure.status === 401 || failure.code === 200009) {
          sessionIssue.current(failure);
        }
        setError(
          failure.status
            ? failure.message
            : "暂时无法呈现 Word 预览，可重试或下载原文件查看。",
        );
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [url, ready, attempt]);

  useEffect(() => {
    const element = frame.current;
    if (!element || loading || error) return;
    const resize = () => {
      const wrapper =
        element.contentDocument?.querySelector<HTMLElement>(".docx-wrapper");
      const paper = wrapper?.querySelector<HTMLElement>("section.docx");
      if (!wrapper || !paper) return;
      const scale =
        zoom === "fit"
          ? Math.min(1, element.clientWidth / (paper.offsetWidth + 48))
          : Number(zoom);
      wrapper.style.zoom = String(scale);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [zoom, loading, error]);

  return (
    <dialog
      ref={dialog}
      className="activity-dialog attachment-preview-dialog"
      aria-labelledby="attachment-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="activity-dialog-head">
        <div>
          <h2 id="attachment-preview-title">附件1预览 · 版本 {file.version}</h2>
          <p>{file.filename}</p>
        </div>
        <button
          className="activity-icon-button"
          aria-label="关闭预览"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="attachment-preview-note">
        正在查看已生成的 Word 文件。浏览器与 Word
        的字体、分页可能略有差异，请以下载文件为准。
      </p>
      <div className="attachment-preview-toolbar">
        <label>
          显示比例
          <select
            aria-label="预览显示比例"
            value={zoom}
            onChange={(event) => setZoom(event.target.value)}
          >
            <option value="fit">适应宽度</option>
            <option value="1">100%</option>
            <option value="1.25">125%</option>
          </select>
        </label>
      </div>
      {loading && (
        <p className="attachment-preview-message" role="status">
          正在加载 Word 预览…
        </p>
      )}
      {error && (
        <div className="attachment-preview-message" role="alert">
          <p>{error}</p>
          <button
            className="button secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重新加载
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        title="附件1 Word 页面预览"
        sandbox="allow-same-origin"
        srcDoc={frameHTML}
        onLoad={() => setReady(true)}
        className="attachment-preview-frame"
        hidden={loading || !!error}
      />
      <div className="attachment-preview-actions">
        <button className="button secondary" onClick={onClose}>
          返回材料
        </button>
        {downloadURL ? (
          <a
            className="button primary"
            href={downloadURL}
            download={file.filename}
          >
            <Icon name="download" />
            下载 Word
          </a>
        ) : (
          <button className="button primary" disabled>
            下载 Word
          </button>
        )}
      </div>
    </dialog>
  );
}
