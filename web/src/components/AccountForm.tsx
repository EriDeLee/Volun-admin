import { useRef, useState } from "react";
import Modal from "./Modal.tsx";
import Icon from "./Icon.tsx";
import { request } from "../lib/workflow.ts";
import { asApiError } from "../lib/api.ts";
import { groupNames, groupOptions } from "../lib/constants.ts";
import type { AdminUser, ApiError } from "../types.ts";

export default function AccountForm({
  target,
  onClose,
  onSaved,
  onSessionIssue,
}: {
  target?: AdminUser;
  onClose: () => void;
  onSaved: (message: string) => void;
  onSessionIssue: (error: ApiError) => void;
}) {
  const [form, setForm] = useState({
    username: "",
    name: "",
    id: "",
    password: "",
    groups: ["formal_user"],
  });
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const change = (
    key: "username" | "name" | "id" | "password",
    value: string,
  ) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <Modal
      title={target ? "重置成员密码" : "添加成员"}
      onClose={onClose}
      locked={busy}
    >
      <form
        className="account-form activity-project-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const bytes = new TextEncoder().encode(form.password).length;
          if (bytes < 12 || bytes > 72) {
            setError("密码长度须为12至72字节。");
            return;
          }
          if (!target && !form.groups.length) {
            setError("请至少选择一个用户组。");
            return;
          }
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            if (target) {
              await request(
                `/admin/users/${encodeURIComponent(target.username)}/reset-password`,
                { password: form.password },
              );
              onSaved(
                `已重置 ${target.name || target.username} 的密码并撤销原会话，下次登录需设置新密码。`,
              );
            } else {
              const result = await request<{
                valid: boolean;
                imported: number;
                rows: { error: string }[];
              }>("/admin/users", form);
              if (!result.valid || !result.imported) {
                setError(
                  result.rows.find((r) => r.error)?.error ||
                    "添加失败，请检查填写内容。",
                );
                return;
              }
              onSaved(`已添加成员 ${form.name}，首次登录需设置新密码。`);
            }
          } catch (cause) {
            const failure = asApiError(cause);
            if (failure.status === 401 || failure.code === 200009)
              onSessionIssue(failure);
            else
              setError(
                failure.status === 400
                  ? "请检查填写内容；当前账号或身份不明确的账号不能在此重置密码。"
                  : failure.message,
              );
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {target ? (
          <div className="account-reset-summary">
            <span className="avatar">
              {(target.name || target.username).slice(0, 1)}
            </span>
            <div>
              <strong>{target.name || target.username}</strong>
              <p>
                {target.username} · {target.id || "未提供编号"}
              </p>
            </div>
          </div>
        ) : (
          <p className="account-intro">
            创建平台登录账号，成员首次登录后需设置新密码。
          </p>
        )}
        <fieldset className="account-fields" disabled={busy}>
          <div className="activity-form-fields">
            {!target && (
              <>
                <label>
                  姓名
                  <input
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(e) => change("name", e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  学号 / 人员编号
                  <input
                    required
                    maxLength={120}
                    value={form.id}
                    onChange={(e) => change("id", e.target.value)}
                    autoComplete="off"
                  />
                  <small>以文本保存，保留前导零</small>
                </label>
                <label className="full">
                  登录账号
                  <input
                    required
                    maxLength={120}
                    value={form.username}
                    onChange={(e) => change("username", e.target.value)}
                    autoComplete="off"
                    placeholder="输入唯一账号"
                  />
                </label>
              </>
            )}
            <label className="full">
              {target ? "临时密码" : "初始密码"}
              <div className="account-password">
                <input
                  required
                  type={visible ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => change("password", e.target.value)}
                  autoComplete="new-password"
                  placeholder="12至72字节"
                />
                <button
                  type="button"
                  className="activity-icon-button"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name="eye" />
                </button>
              </div>
              <small>请单独告知成员此密码，下次登录时需设置新密码。</small>
            </label>
            {!target && (
              <fieldset className="full user-group-fieldset">
                <legend>用户组</legend>
                <div className="user-group-options">
                  {groupOptions.map((g) => (
                    <label key={g} className="user-group-option">
                      <input
                        type="checkbox"
                        checked={form.groups.includes(g)}
                        onChange={() =>
                          setForm((prev) => ({
                            ...prev,
                            groups: prev.groups.includes(g)
                              ? prev.groups.filter((v) => v !== g)
                              : [...prev.groups, g],
                          }))
                        }
                      />
                      <span>{groupNames[g]}</span>
                      <small>{g}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </fieldset>
        {target && (
          <p className="account-reset-note">
            <Icon name="info" />
            重置后该成员所有设备的登录会话立即失效，账号启停状态和用户组保持当前设置。
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="activity-modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "正在保存…" : target ? "确认重置密码" : "添加成员"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
