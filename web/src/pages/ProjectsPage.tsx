import { asApiError } from "../lib/api.ts";
import type { WorkspaceProps, ProjectList, CreateProject } from "../types.ts";
import React, { useEffect, useRef, useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import Badge from "../components/Badge.tsx";
import Modal from "../components/Modal.tsx";
import { projectStatuses } from "../lib/constants.ts";
import { exportCSV } from "../lib/drafts.tsx";

const initialForm = {
  name: "",
  department: "",
  starts_on: "",
  ends_on: "",
  location: "",
  description: "",
};

export default function ProjectsPage({
  session,
  api,
  onNavigate,
  logout,
  logoutPending,
  parentError,
  onSessionIssue,
  section,
}: WorkspaceProps & { section?: "hours" | "materials" }) {
  const title =
    section === "hours"
      ? "时长管理"
      : section === "materials"
        ? "项目材料"
        : "项目台账";
  const openProject = (id: string) =>
    onNavigate(
      section
        ? `/${section}?project=${encodeURIComponent(id)}`
        : `/projects/${id}`,
    );
  const [data, setData] = useState<ProjectList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [view, setView] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set<string>());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(false);
  const requestID = useRef(0);
  const canCreate = session.user.groups.some((g) =>
    ["super_admin", "activity_admin"].includes(g),
  );
  const isData = session.user.groups.includes("data_admin");
  const isSuper = session.user.groups?.includes("super_admin");

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
      if (department) params.set("department", department);
      if (view === "pending") params.set("view", "pending");
      const result = await api(`/activity/projects?${params}`);
      if (mounted.current && id === requestID.current) {
        setData(result);
        setSelected(new Set<string>());
      }
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
  }, [page, status, department, view, appliedQuery, revision]);

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
    setDepartment("");
    setView("all");
    setPage(1);
  };

  const createProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (lock.current) return;
    if (form.ends_on < form.starts_on) {
      setFormError("结束日期不能早于开始日期。");
      return;
    }
    lock.current = true;
    setSaving(true);
    setFormError("");
    try {
      const p = await api("/activity/projects", {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(form),
      });
      if (!mounted.current) return;
      setCreating(false);
      setForm(initialForm);
      setNotice("项目已创建，当前状态为立项。");
      onNavigate(`/projects/${p.id}`);
    } catch (cause) {
      const e = asApiError(cause);
      if (mounted.current) {
        if (e.status === 401 || e.code === 200009) onSessionIssue(e);
        else
          setFormError(
            e.status === 400
              ? "请检查项目名称、部门、地点和活动日期。"
              : e.message,
          );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!data?.items?.length) return;
    if (selected.size === data.items.length) setSelected(new Set<string>());
    else setSelected(new Set(data.items.map((p) => p.id)));
  };

  const exportSelected = () => {
    const rows = (data?.items || []).filter((p) => selected.has(p.id));
    if (!rows.length) {
      setNotice("请先勾选要导出的项目。");
      return;
    }
    exportCSV("项目台账导出.csv", [
      ["编号", "名称", "部门", "负责人", "开始", "结束", "地点", "状态"],
      ...rows.map((p) => [
        p.code,
        p.name,
        p.department,
        p.owner_name,
        p.starts_on,
        p.ends_on,
        p.location,
        p.status,
      ]),
    ]);
    setNotice(`已导出 ${rows.length} 个项目。`);
  };

  const fields: Array<{
    key: keyof CreateProject;
    label: string;
    max?: number;
    full?: boolean;
    type?: string;
  }> = [
    { key: "name", label: "项目名称", max: 80, full: true },
    { key: "department", label: "主办部门", max: 80, full: true },
    { key: "starts_on", label: "开始日期", type: "date" },
    { key: "ends_on", label: "结束日期", type: "date" },
    { key: "location", label: "活动地点", max: 160, full: true },
  ];

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;
  return (
    <WorkspaceShell
      session={session}
      route={section ? `/${section}` : "/projects"}
      crumb={title}
      onNavigate={onNavigate}
      logout={logout}
      logoutPending={logoutPending}
      projectCount={data?.summary?.project_count}
    >
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          {section && (
            <p>
              选择项目后
              {section === "hours"
                ? "登记、补录或查看服务时长"
                : "编辑、生成或下载附件1材料"}
              。
            </p>
          )}
          <p>从立项到归档，在一个地方管理志愿服务全流程。</p>
        </div>
        <div className="activity-actions">
          <button className="button secondary" onClick={exportSelected}>
            <Icon name="download" />
            导出所选
          </button>
          <button
            className="button primary"
            disabled={!canCreate}
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" />
            新建项目
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
        <div className="activity-stats" aria-label="台账统计">
          {(
            [
              [
                "全部项目",
                data.summary.project_count,
                "项",
                isSuper
                  ? "当前权限：全部项目"
                  : isData
                    ? "当前权限：已提交项目"
                    : "当前权限：本人创建",
                "folder",
              ],
              [
                "正在招募",
                data.summary.recruiting_count,
                "项",
                "处于招募阶段",
                "people",
              ],
              [
                "待跟进",
                data.summary.pending_count,
                "项",
                "立项、筹备、招募、结项、意向",
                "check",
              ],
              [
                "认定时长",
                data.summary.recognized_hours ?? "—",
                "小时",
                "时长模块暂未接入",
                "clock",
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
        <div className="activity-tabs" role="group" aria-label="台账视图">
          <button
            className={view === "all" ? "selected" : ""}
            aria-pressed={view === "all"}
            onClick={() => {
              setView("all");
              setPage(1);
            }}
          >
            全部项目
          </button>
          <button
            className={view === "pending" ? "selected" : ""}
            aria-pressed={view === "pending"}
            onClick={() => {
              setView("pending");
              setPage(1);
            }}
          >
            待我处理
          </button>
        </div>
        <form className="workspace-filters" onSubmit={search}>
          <label className="activity-search">
            <Icon name="search" />
            <input
              maxLength={160}
              aria-label="搜索项目名称或编号"
              placeholder="搜索项目名称或编号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="筛选项目状态"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {projectStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选部门"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部部门</option>
            {(data?.departments || []).map((d) => (
              <option key={d} value={d}>
                {d}
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
          <span>共 {data?.total ?? 0} 个项目</span>
          <span>保留 12 种业务状态 · 按更新时间倒序</span>
        </div>
        {selected.size > 0 && (
          <div className="selection-bar">
            <span>
              已选 <b>{selected.size}</b> 项
            </span>
            <button className="activity-text-button" onClick={exportSelected}>
              导出所选
            </button>
            <button
              className="activity-text-button"
              onClick={() => setSelected(new Set<string>())}
            >
              取消选择
            </button>
          </div>
        )}
        {error ? (
          <div className="activity-error" role="alert">
            <Icon name="info" />
            <h2>台账暂时无法读取</h2>
            <p>{error}</p>
            <button className="button secondary" onClick={load}>
              重新加载
            </button>
          </div>
        ) : loading && !data ? (
          <div className="activity-loading" role="status">
            正在读取项目台账…
          </div>
        ) : data?.items?.length ? (
          <>
            <div className="activity-table-wrap">
              <table className="activity-table ledger-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="选择当前页全部项目"
                        checked={
                          data.items.length > 0 &&
                          selected.size === data.items.length
                        }
                        onChange={toggleAll}
                      />
                    </th>
                    <th scope="col">项目名称 / 编号</th>
                    <th scope="col">活动负责人</th>
                    <th scope="col">涉及部门</th>
                    <th scope="col">活动时间 / 地点</th>
                    <th scope="col">当前状态</th>
                    <th scope="col">常用操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择${p.name}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
                      <td>
                        <button
                          className="activity-project-name"
                          onClick={() => openProject(p.id)}
                        >
                          {p.name}
                        </button>
                        <small>
                          {p.code}
                          {p.description ? ` · ${p.description}` : ""}
                        </small>
                      </td>
                      <td>
                        <span className="mini-person">
                          <span className="avatar tiny">
                            {(p.owner_name || "?").slice(0, 1)}
                          </span>
                          {p.owner_name || "—"}
                        </span>
                      </td>
                      <td>{p.department}</td>
                      <td>
                        {p.starts_on} 至 {p.ends_on}
                        <small>{p.location}</small>
                      </td>
                      <td>
                        <Badge status={p.status} />
                        <small>
                          {
                            (
                              {
                                draft: "立项草稿",
                                pending: "待立项审核",
                                approved: "立项通过",
                                returned: "立项退回",
                              } as Record<string, string>
                            )[p.approval || ""]
                          }
                        </small>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="activity-text-button"
                            onClick={() => openProject(p.id)}
                          >
                            详情
                          </button>
                          <button
                            className="activity-text-button"
                            onClick={() =>
                              onNavigate(`/projects/${p.id}?tab=recruit`)
                            }
                          >
                            成员
                          </button>
                          <button
                            className="activity-text-button"
                            onClick={() => onNavigate(`/hours?project=${p.id}`)}
                          >
                            时长
                          </button>
                          <button
                            className="activity-text-button"
                            onClick={() =>
                              onNavigate(`/materials?project=${p.id}`)
                            }
                          >
                            材料
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
              <Icon name="folder" />
            </span>
            <h3>
              {data?.summary?.project_count
                ? "没有符合条件的项目"
                : "从第一个志愿服务项目开始"}
            </h3>
            <p>
              {data?.summary?.project_count
                ? "试试调整筛选条件，或切换到全部项目。"
                : "新建立项，记录服务安排，开始后续筹备。"}
            </p>
            {!data?.summary?.project_count && (
              <button
                className="button primary"
                disabled={!canCreate}
                onClick={() => setCreating(true)}
              >
                <Icon name="plus" />
                新建项目
              </button>
            )}
          </div>
        )}
      </section>
      <footer className="activity-footer">
        <span>北京航空航天大学 · 志愿服务项目管理平台</span>
        <span>{title} · 真实数据</span>
      </footer>
      {creating && (
        <Modal
          title="新建志愿服务项目"
          locked={saving}
          onClose={() => setCreating(false)}
        >
          <p className="activity-modal-intro">
            先填写基础信息，项目将以「立项」状态保存。负责人为当前账号。
          </p>
          <form onSubmit={createProject} className="activity-project-form">
            <div className="activity-form-fields">
              {fields.map((f) => (
                <label key={f.key} className={f.full ? "full" : ""}>
                  {f.label}
                  <span aria-hidden="true"> *</span>
                  <input
                    name={f.key}
                    required
                    maxLength={f.max}
                    type={f.type || "text"}
                    value={form[f.key]}
                    min={
                      f.key === "ends_on"
                        ? form.starts_on || undefined
                        : undefined
                    }
                    disabled={saving}
                    onChange={(e) =>
                      setForm({ ...form, [f.key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="full">
                项目描述（选填）
                <textarea
                  name="description"
                  maxLength={2000}
                  value={form.description}
                  disabled={saving}
                  rows={4}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
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
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                {saving ? "正在创建…" : "创建项目"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </WorkspaceShell>
  );
}
