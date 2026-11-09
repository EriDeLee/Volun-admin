import { asApiError } from "../lib/api.ts";
import type { WorkspaceProps, AdminUserList, AdminUser } from "../types.ts";
import React, { useEffect, useRef, useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import Modal from "../components/Modal.tsx";
import UserImport from "../components/UserImport.tsx";
import AccountForm from "../components/AccountForm.tsx";
import { groupNames, groupOptions } from "../lib/constants.ts";

const statusLabels: Record<string, string> = {
  active: "启用",
  disabled: "停用",
};

export default function UsersPage({
  session,
  api,
  onNavigate,
  logout,
  logoutPending,
  parentError,
  onSessionIssue,
}: WorkspaceProps) {
  const [data, setData] = useState<AdminUserList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");
  const [group, setGroup] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState("active");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const requestID = useRef(0);
  const selfName = session.user.username || "";

  const load = async () => {
    const id = ++requestID.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: "20",
      });
      if (appliedQuery) params.set("q", appliedQuery);
      if (status) params.set("status", status);
      if (group) params.set("group", group);
      const result = await api(`/admin/users?${params}`);
      if (mounted.current && id === requestID.current) setData(result);
    } catch (cause) {
      const e = asApiError(cause);
      if (mounted.current && id === requestID.current) {
        if (e.status === 401 || e.code === 200009) onSessionIssue(e);
        else setError(e.message);
      }
    } finally {
      if (mounted.current && id === requestID.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestID.current++;
    };
  }, []);

  useEffect(() => {
    load();
  }, [page, status, group, appliedQuery, revision]);

  const search = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
    setRevision((v) => v + 1);
  };

  const resetFilters = () => {
    setQuery("");
    setAppliedQuery("");
    setRevision((v) => v + 1);
    setStatus("");
    setGroup("");
    setPage(1);
  };

  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setEditGroups([...user.groups]);
    setEditStatus(user.status);
    setFormError("");
  };

  const toggleGroup = (code: string) => {
    setEditGroups((prev) =>
      prev.includes(code) ? prev.filter((g) => g !== code) : [...prev, code],
    );
  };

  const saveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || lock.current) return;
    if (!editGroups.length) {
      setFormError("请至少保留一个用户组。");
      return;
    }
    if (editing.username === selfName && !editGroups.includes("super_admin")) {
      setFormError("不能去掉当前账号的超管身份。");
      return;
    }
    if (editing.username === selfName && editStatus === "disabled") {
      setFormError("不能停用当前登录账号。");
      return;
    }
    lock.current = true;
    setSaving(true);
    setFormError("");
    try {
      const updated = await api(
        `/admin/users/${encodeURIComponent(editing.username)}`,
        {
          method: "PATCH",
          headers: { "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({
            status: editStatus,
            groups: editGroups,
          }),
        },
      );
      if (!mounted.current) return;
      setEditing(null);
      setNotice(`已更新账号 ${updated.username}。`);
      setRevision((v) => v + 1);
    } catch (cause) {
      const err = asApiError(cause);
      if (mounted.current) {
        if (err.status === 401 || err.code === 200009) onSessionIssue(err);
        else
          setFormError(
            err.status === 400
              ? "请检查用户组与状态设置，不能停用或降权当前超管账号。"
              : err.message,
          );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;

  return (
    <WorkspaceShell
      session={session}
      route="/users"
      crumb="成员管理"
      onNavigate={onNavigate}
      logout={logout}
      logoutPending={logoutPending}
    >
      <div className="page-heading">
        <div>
          <h1>成员管理</h1>
          <p>
            管理平台成员账号、分配四个固定用户组及启停账号。活动志愿者名单在项目详情中管理。
          </p>
        </div>
        <div className="activity-actions">
          <button className="button primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            添加成员
          </button>
          <button
            className="button secondary"
            onClick={() => setImporting(true)}
          >
            <Icon name="upload" />
            批量导入
          </button>
          <button
            className="button secondary"
            onClick={() => setRevision((v) => v + 1)}
            disabled={loading}
          >
            <Icon name="refresh" />
            刷新列表
          </button>
        </div>
      </div>
      {parentError && (
        <p className="error" role="alert">
          {parentError}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {data && (
        <div className="activity-stats" aria-label="用户统计">
          {(
            [
              [
                "全部用户",
                data.summary.user_count,
                "人",
                "目录内全部账号",
                "people",
              ],
              [
                "启用中",
                data.summary.active_count,
                "人",
                "可登录平台",
                "check",
              ],
              [
                "已停用",
                data.summary.disabled_count,
                "人",
                "会话已撤销",
                "close",
              ],
              [
                "管理角色",
                data.summary.manager_count,
                "人",
                "超管 / 数据 / 活动",
                "shield",
              ],
            ] as const
          ).map(([label, value, unit, sub, ic]) => (
            <section key={label} className="activity-stat">
              <div>
                <span>{label}</span>
                <span className="activity-stat-icon">
                  <Icon name={ic} />
                </span>
              </div>
              <strong>
                {value}
                <small>{unit}</small>
              </strong>
              <p>{sub}</p>
            </section>
          ))}
        </div>
      )}
      <section className="panel" aria-busy={loading}>
        <form className="workspace-filters" onSubmit={search}>
          <label className="activity-search">
            <Icon name="search" />
            <input
              maxLength={160}
              aria-label="搜索账号、姓名或学号"
              placeholder="搜索账号、姓名或学号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="筛选账号状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="disabled">停用</option>
          </select>
          <select
            aria-label="筛选用户组"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部用户组</option>
            {groupOptions.map((g) => (
              <option key={g} value={g}>
                {groupNames[g]}
              </option>
            ))}
          </select>
          <button className="button secondary" type="submit" disabled={loading}>
            查询
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={resetFilters}
          >
            重置
          </button>
        </form>
        <div className="filter-meta">
          <span>共 {data?.total ?? 0} 个账号</span>
          <span>用户组由超管分配 · 不开放自行注册</span>
        </div>
        {error ? (
          <div className="activity-error" role="alert">
            <Icon name="info" />
            <h2>用户目录暂时无法读取</h2>
            <p>{error}</p>
            <button className="button secondary" onClick={load}>
              重新加载
            </button>
          </div>
        ) : loading && !data ? (
          <div className="activity-loading" role="status">
            正在读取用户目录…
          </div>
        ) : data?.items?.length ? (
          <>
            <div className="activity-table-wrap">
              <table className="activity-table ledger-table">
                <thead>
                  <tr>
                    <th scope="col">姓名 / 账号</th>
                    <th scope="col">学号 / 人员编号</th>
                    <th scope="col">用户组</th>
                    <th scope="col">状态</th>
                    <th scope="col">密码</th>
                    <th scope="col">更新时间</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.username}>
                      <td>
                        <strong className="activity-project-name">
                          {u.name || "未提供姓名"}
                        </strong>
                        <small>
                          {u.username}
                          {u.username === selfName ? " · 当前账号" : ""}
                        </small>
                      </td>
                      <td>{u.id || "—"}</td>
                      <td>
                        <div className="group-list">
                          {u.groups.length ? (
                            u.groups.map((g) => (
                              <span className="badge" key={g}>
                                {groupNames[g] || g}
                              </span>
                            ))
                          ) : (
                            <span className="muted">未分配</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${u.status === "active" ? "" : "white"}`}
                        >
                          {statusLabels[u.status] || u.status}
                        </span>
                      </td>
                      <td>
                        {u.password_setup_required
                          ? "待首次设密"
                          : u.has_password
                            ? "已设置"
                            : "未设置"}
                      </td>
                      <td>
                        {u.updated_at
                          ? new Date(u.updated_at).toLocaleString("zh-CN", {
                              hour12: false,
                            })
                          : "—"}
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="activity-text-button"
                            onClick={() => openEdit(u)}
                          >
                            编辑
                          </button>
                          <button
                            className="activity-text-button"
                            disabled={u.username === selfName}
                            title={
                              u.username === selfName
                                ? "不能在此重置当前登录账号密码"
                                : undefined
                            }
                            onClick={() => setResetting(u)}
                          >
                            重置密码
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                第 {(page - 1) * data.page_size + 1}–
                {Math.min(page * data.page_size, data.total)} 条，共{" "}
                {data.total} 条
              </span>
              <div className="activity-actions">
                <button
                  className="button secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </button>
                <span className="muted tiny">
                  {page} / {totalPages}
                </span>
                <button
                  className="button secondary"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="activity-empty">
            <span className="activity-empty-icon">
              <Icon name="people" />
            </span>
            <h3>
              {data?.summary?.user_count
                ? "没有符合条件的用户"
                : "还没有可管理的用户"}
            </h3>
            <p>
              {data?.summary?.user_count
                ? "试试调整筛选条件，或清空关键词。"
                : "点击添加成员或批量导入，为成员创建平台账号。"}
            </p>
          </div>
        )}
      </section>
      <footer className="activity-footer">
        <span>北京航空航天大学 · 志愿服务项目管理平台</span>
        <span>成员管理 · 超管</span>
      </footer>
      {editing && (
        <Modal
          title={`编辑账号 · ${editing.username}`}
          locked={saving}
          onClose={() => setEditing(null)}
        >
          <p className="activity-modal-intro">
            姓名：{editing.name || "未提供"}
            {editing.id ? ` · 编号 ${editing.id}` : ""}
            。用户组决定功能权限，停用会立即撤销会话。
          </p>
          <form onSubmit={saveUser} className="activity-project-form">
            <div className="activity-form-fields">
              <label className="full">
                账号状态
                <select
                  value={editStatus}
                  disabled={saving}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <fieldset className="full user-group-fieldset">
                <legend>用户组</legend>
                <div className="user-group-options">
                  {groupOptions.map((code) => (
                    <label key={code} className="user-group-option">
                      <input
                        type="checkbox"
                        checked={editGroups.includes(code)}
                        disabled={saving}
                        onChange={() => toggleGroup(code)}
                      />
                      <span>{groupNames[code]}</span>
                      <small>{code}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {formError && (
              <p className="error" role="alert">
                {formError}
              </p>
            )}
            <div className="activity-modal-actions">
              <button
                className="button secondary"
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                {saving ? "正在保存…" : "保存变更"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importing && (
        <UserImport
          onClose={() => setImporting(false)}
          onSessionIssue={onSessionIssue}
          onImported={(count) => {
            setImporting(false);
            setNotice(`已导入 ${count} 位成员，首次登录需设置新密码。`);
            setPage(1);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {(adding || resetting) && (
        <AccountForm
          target={resetting || undefined}
          onClose={() => {
            setAdding(false);
            setResetting(null);
          }}
          onSessionIssue={onSessionIssue}
          onSaved={(message) => {
            setAdding(false);
            setResetting(null);
            setNotice(message);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </WorkspaceShell>
  );
}
