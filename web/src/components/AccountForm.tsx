import ValidatedForm from "./ValidatedForm.tsx";
import { useId, useRef, useState } from "react";
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
    phone: "",
    password: "",
    groups: ["formal_user"],
  });
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const errorID = useId();
  const lock = useRef(false);
  const change = (
    key: "username" | "name" | "id" | "password" | "phone",
    value: string,
  ) => setForm((prev) => ({ ...prev, [key]: value }));
  return (
    <Modal
      title={target ? "重置成员密码" : "添加成员"}
      onClose={onClose}
      locked={busy}
    >
      <ValidatedForm
        className="account-form activity-project-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
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
                `已重置 ${target.name || target.username} 的密码，下次登录需设置新密码。`,
              );
            } else {
              const result = await request<{
                valid: boolean;
                imported: number;
                rows: { error: string; error_field?: string }[];
              }>("/admin/users", form);
              if (!result.valid || !result.imported) {
                const invalid = result.rows.find((row) => row.error);
                const field =
                  invalid?.error_field &&
                  document.querySelector<HTMLInputElement>(
                    `.account-form [name="${invalid.error_field}"]`,
                  );
                if (field) {
                  field.setAttribute("aria-invalid", "true");
                  field.focus();
                }
                setError(invalid?.error || "添加失败，请重试。");
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
                  ? target
                    ? "无法重置该成员的密码。"
                    : "请检查标记的内容。"
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
          <p className="account-intro">成员首次登录时需设置新密码。</p>
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
                    name="name"
                    placeholder="请输入姓名"
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
                    name="id"
                    placeholder="请输入学号或人员编号"
                    value={form.id}
                    onChange={(e) => change("id", e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  绑定手机号
                  <input
                    type="tel"
                    data-validate="phone"
                    name="phone"
                    value={form.phone}
                    onChange={(event) => change("phone", event.target.value)}
                    placeholder="请输入手机号（选填）"
                  />
                </label>
                <label className="full">
                  登录账号
                  <input
                    required
                    maxLength={120}
                    name="username"
                    placeholder="设置用于登录的账号"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={form.username}
                    onChange={(e) => change("username", e.target.value)}
                    autoComplete="off"
                    data-validate="username"
                  />
                </label>
              </>
            )}
            <label className="full">
              {target ? "临时密码" : "初始密码"}
              <div className="account-password">
                <input
                  name="password"
                  placeholder={target ? "设置临时登录密码" : "设置首次登录密码"}
                  data-validate="password"
                  required
                  type={visible ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => {
                    change("password", e.target.value);
                    setError("");
                  }}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="activity-icon-button"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name="eye" />
                </button>
              </div>
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
            该账号将退出所有设备。
          </p>
        )}
        {error && (
          <p className="error" role="alert" id={errorID}>
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
      </ValidatedForm>
    </Modal>
  );
}
