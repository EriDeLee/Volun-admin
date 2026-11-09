import { useRef, useState } from "react";
import Modal from "./Modal.tsx";
import { request } from "../lib/workflow.ts";
import { asApiError } from "../lib/api.ts";
import type { ApiError } from "../types.ts";
import Icon from "./Icon.tsx";

interface Result {
  valid: boolean;
  imported: number;
  rows: {
    line: number;
    username: string;
    name: string;
    id: string;
    groups: string[];
    error: string;
  }[];
}

export default function UserImport({
  onClose,
  onImported,
  onSessionIssue,
}: {
  onClose: () => void;
  onImported: (count: number) => void;
  onSessionIssue: (e: ApiError) => void;
}) {
  const [csv, setCSV] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const lock = useRef(false);
  const change = (text: string) => {
    setCSV(text);
    setResult(null);
    setError("");
  };
  const submit = async (commit: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await request<Result>("/admin/users/import", {
        csv,
        commit,
      });
      setResult(response);
      if (response.imported) {
        setCSV("");
        onImported(response.imported);
      }
    } catch (cause) {
      const e = asApiError(cause);
      setResult(null);
      if (e.status === 401 || e.code === 200009) onSessionIssue(e);
      else
        setError(
          e.status === 400
            ? "请检查CSV表头、编码、列数及文件大小。"
            : e.message,
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const template = () => {
    const url = URL.createObjectURL(
      new Blob(["\ufeff账号,姓名,学号,初始密码,用户组\r\n"], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "平台成员导入模板.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal title="批量导入成员" onClose={onClose} locked={busy}>
      <div className="member-import-body">
        <ol className="import-steps" aria-label="导入步骤">
          <li className={!csv ? "current" : "complete"}>
            <span>1</span>准备名单
          </li>
          <li className={csv && !result?.valid ? "current" : ""}>
            <span>2</span>预检数据
          </li>
          <li className={result?.valid ? "current" : ""}>
            <span>3</span>确认导入
          </li>
        </ol>
        <div className="import-template">
          <span className="import-file-icon">
            <Icon name="file" />
          </span>
          <div>
            <strong>先下载模板，按列填写成员信息</strong>
            <p>UTF-8 CSV · 每批最多100人 · 已有账号不会覆盖</p>
          </div>
          <button
            className="button secondary"
            onClick={template}
            disabled={busy}
          >
            <Icon name="download" />
            下载CSV模板
          </button>
        </div>
        <label className="import-upload">
          <Icon name="upload" />
          <strong>{filename || "选择CSV文件"}</strong>
          <span>
            {filename ? "点击重新选择文件" : "点击上传，文件不超过200KB"}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFilename(file.name);
              if (file.size > 200 * 1024) {
                change("");
                setError("文件不能超过200KB。");
                return;
              }
              try {
                change(await file.text());
              } catch {
                setError("文件读取失败，请重试。");
              }
            }}
          />
        </label>
        <label className="import-paste">
          <span>
            CSV内容<small>也可直接粘贴，首行保留表头</small>
          </span>
          <textarea
            aria-label="CSV内容"
            rows={7}
            value={csv}
            disabled={busy}
            onChange={(e) => change(e.target.value)}
            placeholder="账号,姓名,学号,初始密码,用户组"
          />
        </label>
        <details className="import-help">
          <summary>
            <Icon name="info" />
            填写规则与用户组说明
          </summary>
          <p>
            账号和学号请以文本填写，保留前导零。初始密码为12至72字节，成员首次登录需设置新密码。
          </p>
          <p>
            用户组留空默认为正式用户；多个代码用 <code>|</code> 分隔。
          </p>
          <dl>
            {[
              ["formal_user", "正式用户"],
              ["activity_admin", "活动管理员"],
              ["data_admin", "数据管理员"],
              ["super_admin", "超管"],
            ].map(([code, label]) => (
              <div key={code}>
                <dt>{label}</dt>
                <dd>
                  <code>{code}</code>
                </dd>
              </div>
            ))}
          </dl>
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <p
              className={`import-result ${result.valid ? "valid" : "invalid"}`}
              role="status"
            >
              <Icon name={result.valid ? "check" : "info"} />
              {result.valid
                ? `预检通过，共 ${result.rows.length} 人。`
                : "预检未通过，请修正以下错误后重试，尚未写入任何账号。"}
            </p>
            <div className="activity-table-wrap import-preview">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>行号</th>
                    <th>账号</th>
                    <th>姓名</th>
                    <th>编号</th>
                    <th>校验结果</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.line}>
                      <td>{row.line}</td>
                      <td>{row.username}</td>
                      <td>{row.name}</td>
                      <td>{row.id}</td>
                      <td>{row.error || "通过"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <div className="activity-modal-actions import-footer">
        <span>预检通过后才能导入</span>
        <button className="button secondary" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button secondary"
          disabled={busy || !csv.trim()}
          onClick={() => void submit(false)}
        >
          预检
        </button>
        <button
          className="button primary"
          disabled={busy || !result?.valid}
          onClick={() => void submit(true)}
        >
          {busy ? "处理中…" : "确认导入"}
        </button>
      </div>
    </Modal>
  );
}
