import Sidebar from "./components/Sidebar.tsx";
import ThemeSelect from "./components/ThemeSelect.tsx";
import { asApiError } from "./lib/api.ts";
import type {
  ActivityHomeProps,
  Dashboard,
  Project,
  CreateProject,
  ModalProps,
} from "./types.ts";
import React, { useEffect, useRef, useState } from "react";
import "./activity.css";

const pendingStatuses = ["立项", "筹备", "招募", "结项", "意向"];
const initialForm: CreateProject = {
  name: "",
  department: "",
  starts_on: "",
  ends_on: "",
  location: "",
  description: "",
};
function ActivityIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    folder: (
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6M8 13h8m-8 4h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`activity-badge ${["进行", "通过"].includes(status) ? "green" : ["数据", "统计"].includes(status) ? "purple" : status === "审核" ? "amber" : status === "驳回" ? "red" : ""}`}
    >
      {status}
    </span>
  );
}
function Modal({ title, children, onClose, locked = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="activity-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      aria-labelledby="activity-dialog-title"
    >
      <div className="activity-dialog-head">
        <h2 id="activity-dialog-title">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={locked}
          className="activity-icon-button"
          aria-label="关闭弹窗"
        >
          <ActivityIcon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function ActivityHome({
  session,
  api,
  Icon,
  onNavigate,
  onSessionIssue,
  logout,
  logoutPending,
  parentError,
  onOpenProject,
}: ActivityHomeProps) {
  const [data, setData] = useState<Dashboard | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""),
    [view, setView] = useState("all"),
    [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false),
    [form, setForm] = useState(initialForm),
    [saving, setSaving] = useState(false),
    [formError, setFormError] = useState("");
  const [detail, setDetail] = useState<Project | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const tasksRef = useRef<HTMLElement>(null),
    recentRef = useRef<HTMLElement>(null),
    lock = useRef(false),
    mounted = useRef(false),
    requestID = useRef(0);
  const name = session.user.name || session.user.username || "平台用户";
  const canCreate = session.user.groups.some((g) =>
    ["super_admin", "activity_admin"].includes(g),
  );
  const isData = session.user.groups.includes("data_admin");
  const isSuper = session.user.groups?.includes("super_admin");
  const refresh = async () => {
    const id = ++requestID.current;
    setLoading(true);
    setError("");
    try {
      const result = await api("/activity/dashboard");
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
    refresh();
    return () => {
      mounted.current = false;
      requestID.current++;
    };
  }, []);
  const startCreate = () => {
    setForm(initialForm);
    setFormError("");
    setCreating(true);
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
      await api("/activity/projects", {
        method: "POST",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(form),
      });
      if (!mounted.current) return;
      setCreating(false);
      setForm(initialForm);
      setNotice("项目已创建，当前状态为立项。");
      await refresh();
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
  const openProject = async (id: string) => {
    if (onOpenProject) {
      onOpenProject(id);
      return;
    }
    if (detailLoading) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const p = await api(`/activity/projects/${encodeURIComponent(id)}`);
      if (mounted.current) setDetail(p);
    } catch (cause) {
      const e = asApiError(cause);
      if (mounted.current) {
        if (e.status === 401 || e.code === 200009) onSessionIssue(e);
        else
          setDetailError(
            e.status === 404 ? "该项目已不可访问，请刷新项目列表。" : e.message,
          );
      }
    } finally {
      if (mounted.current) setDetailLoading(false);
    }
  };
  const focusSection = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    ref.current?.focus({ preventScroll: true });
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
  const list = (data?.recent_projects || []).filter(
    (p) =>
      (view === "all" || pendingStatuses.includes(p.status)) &&
      (!query ||
        `${p.name}${p.code}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const phaseGroups: [string, string[]][] = [
    ["筹备与招募", ["立项", "筹备", "招募"]],
    ["活动进行中", ["进行"]],
    ["结项与意向", ["结项", "意向"]],
    ["数据与审核", ["统计", "数据", "录入", "审核"]],
    ["已通过归档", ["通过"]],
    ["未予认定", ["驳回"]],
  ];
  return (
    <div className="activity-shell">
      <Sidebar
        session={session}
        route="/activity"
        onNavigate={onNavigate}
        open={menu}
        onClose={() => setMenu(false)}
      />
      <div className="profile-main">
        <header className="topbar activity-topbar">
          <button
            className="activity-icon-button activity-mobile-menu"
            aria-label="展开导航"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <ActivityIcon name="menu" />
          </button>
          <span>
            工作空间 <b>/</b> <strong>工作台</strong>
          </span>
          <div className="activity-top-actions">
            <ThemeSelect />
            <span className="activity-today">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <button
              className="button secondary"
              onClick={logout}
              disabled={logoutPending}
            >
              <Icon name="logout" />
              {logoutPending ? "正在退出…" : "退出登录"}
            </button>
          </div>
        </header>
        <main className="activity-content">
          <div className="page-heading">
            <div>
              <h1>活动管理工作台</h1>
              <p>
                {isSuper
                  ? "查看全平台项目，跟进志愿服务筹备与协作。"
                  : "查看我负责的项目，让志愿服务有序开展。"}
              </p>
            </div>
            <div className="activity-actions">
              <button
                className="button secondary"
                onClick={refresh}
                disabled={loading}
              >
                <Icon name="refresh" />
                {loading ? "正在刷新…" : "刷新数据"}
              </button>
              <button
                className="button primary"
                disabled={!canCreate}
                onClick={startCreate}
              >
                <ActivityIcon name="plus" />
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
          <section className="activity-hero">
            <div>
              <h2>你好，{name}</h2>
              <p>
                {data
                  ? data.summary.pending_count
                    ? `有 ${data.summary.pending_count} 个项目需要跟进，先从待办开始。`
                    : "当前没有待跟进项目，准备好开启下一次服务了吗？"
                  : "在一个地方查看项目进度、整理待办、开始新的服务。"}
              </p>
              <div className="activity-actions">
                <button
                  className="button primary"
                  onClick={() => focusSection(tasksRef)}
                >
                  <ActivityIcon name="check" />
                  查看我的待办
                </button>
                <button
                  className="button secondary"
                  onClick={() => focusSection(recentRef)}
                >
                  查看近期项目
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
            <div className="activity-hero-art" aria-hidden="true">
              <div className="activity-art-sheet">
                <Icon name="heart" />
                <i />
                <i />
                <i />
              </div>
              <span>一起，让善意发生</span>
            </div>
          </section>
          {error ? (
            <section className="panel activity-error" role="alert">
              <Icon name="info" />
              <h2>工作台数据暂时无法读取</h2>
              <p>{error}</p>
              <button className="button secondary" onClick={refresh}>
                重新加载
              </button>
            </section>
          ) : loading && !data ? (
            <section className="panel activity-loading" role="status">
              正在读取你的项目与待办…
            </section>
          ) : (
            data && (
              <>
                <div className="activity-stats" aria-label="项目统计">
                  {(
                    [
                      [
                        "管理项目",
                        data.summary.project_count,
                        "项",
                        "当前权限范围 · 全部时间",
                        "folder",
                      ],
                      [
                        "正在招募",
                        data.summary.recruiting_count,
                        "项",
                        "当前处于招募阶段",
                        "people",
                      ],
                      [
                        "已审核认定",
                        data.summary.recognized_hours ?? "—",
                        "小时",
                        data.summary.recognized_hours === null
                          ? "时长模块暂未接入"
                          : "仅统计已审核认定时长",
                        "clock",
                      ],
                      [
                        "待跟进项目",
                        data.summary.pending_count,
                        "项",
                        "立项、筹备、招募、结项、意向",
                        "check",
                      ],
                    ] as const
                  ).map(([label, value, unit, sub, ic]) => (
                    <section key={label} className="activity-stat">
                      <div>
                        <span>{label}</span>
                        <span className="activity-stat-icon">
                          <ActivityIcon name={ic} />
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
                <div className="activity-grid">
                  <div className="activity-column">
                    <section
                      className="panel"
                      ref={tasksRef}
                      tabIndex={-1}
                      aria-labelledby="activity-tasks-title"
                    >
                      <div className="activity-panel-heading">
                        <h2 id="activity-tasks-title">
                          待我处理{" "}
                          <span className="activity-count">
                            {data.summary.pending_count}
                          </span>
                        </h2>
                        <span className="muted">最近更新优先 · 最多 5 项</span>
                      </div>
                      {data.tasks.length ? (
                        data.tasks.map((t) => (
                          <div className="activity-task" key={t.project_id}>
                            <span className="activity-task-dot" />
                            <div>
                              <h3>{t.project_name}</h3>
                              <p>{t.instruction}</p>
                              <Badge status={t.status} />
                            </div>
                            <button
                              className="button secondary"
                              disabled={detailLoading}
                              onClick={() => openProject(t.project_id)}
                            >
                              查看项目
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="activity-empty">
                          <span className="activity-empty-icon">
                            <ActivityIcon name="check" />
                          </span>
                          <h3>当前没有待跟进事项</h3>
                          <p>
                            项目进入需要活动负责人跟进的阶段后，会显示在这里。
                          </p>
                        </div>
                      )}
                    </section>
                    <section
                      className="panel"
                      ref={recentRef}
                      tabIndex={-1}
                      aria-labelledby="activity-recent-title"
                    >
                      <div className="activity-panel-heading">
                        <div>
                          <h2 id="activity-recent-title">近期项目</h2>
                          <p>
                            最近更新的 {data.recent_projects.length} 项 ·
                            项目总数 {data.summary.project_count}
                          </p>
                        </div>
                        <label className="activity-search">
                          <ActivityIcon name="search" />
                          <input
                            aria-label="搜索近期项目名称或编号"
                            placeholder="搜索名称或编号"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                      </div>
                      <div
                        className="activity-tabs"
                        role="group"
                        aria-label="近期项目视图"
                      >
                        <button
                          className={view === "all" ? "selected" : ""}
                          aria-pressed={view === "all"}
                          onClick={() => setView("all")}
                        >
                          全部近期项目
                        </button>
                        <button
                          className={view === "pending" ? "selected" : ""}
                          aria-pressed={view === "pending"}
                          onClick={() => setView("pending")}
                        >
                          待跟进
                        </button>
                      </div>
                      {list.length ? (
                        <div className="activity-table-wrap">
                          <table className="activity-table">
                            <thead>
                              <tr>
                                <th scope="col">项目名称 / 编号</th>
                                <th scope="col">活动时间 / 地点</th>
                                <th scope="col">状态</th>
                                <th scope="col">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {list.map((p) => (
                                <tr key={p.id}>
                                  <td>
                                    <button
                                      onClick={() => openProject(p.id)}
                                      disabled={detailLoading}
                                      className="activity-project-name"
                                    >
                                      {p.name}
                                    </button>
                                    <small>{p.code}</small>
                                  </td>
                                  <td>
                                    {p.starts_on} 至 {p.ends_on}
                                    <small>{p.location}</small>
                                  </td>
                                  <td>
                                    <Badge status={p.status} />
                                  </td>
                                  <td>
                                    <button
                                      className="activity-text-button"
                                      onClick={() => openProject(p.id)}
                                      disabled={detailLoading}
                                    >
                                      详情
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="activity-empty">
                          <span className="activity-empty-icon">
                            <ActivityIcon name="folder" />
                          </span>
                          <h3>
                            {data.recent_projects.length
                              ? "没有找到符合条件的近期项目"
                              : "从第一个志愿服务项目开始"}
                          </h3>
                          <p>
                            {data.recent_projects.length
                              ? "试试调整关键词或切换查看全部近期项目。"
                              : "新建立项，记录服务安排，开始后续筹备。"}
                          </p>
                          {!data.recent_projects.length && (
                            <button
                              className="button primary"
                              disabled={!canCreate}
                              onClick={startCreate}
                            >
                              <ActivityIcon name="plus" />
                              新建项目
                            </button>
                          )}
                        </div>
                      )}
                      <div className="activity-table-footer">
                        {isSuper
                          ? "当前范围：全部项目"
                          : isData
                            ? "当前范围：已提交项目"
                            : "当前范围：本人创建的项目"}{" "}
                        · 新建项目状态为立项
                      </div>
                    </section>
                  </div>
                  <div className="activity-column">
                    <section className="panel">
                      <div className="activity-panel-heading">
                        <h2>项目进展</h2>
                        <span className="muted">全部时间</span>
                      </div>
                      <div className="activity-phases">
                        {phaseGroups.map(([label, included]) => {
                          const count = data.stages
                            .filter((s) => included.includes(s.status))
                            .reduce((a, s) => a + s.count, 0);
                          return (
                            <div className="activity-phase" key={label}>
                              <div>
                                <span>{label}</span>
                                <strong>{count} 项</strong>
                              </div>
                              <meter
                                min="0"
                                max={Math.max(data.summary.project_count, 1)}
                                value={count}
                                aria-label={`${label}：${count}项，共${data.summary.project_count}项`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                    <section className="panel">
                      <div className="activity-panel-heading">
                        <h2>业务提醒</h2>
                        <Icon name="info" />
                      </div>
                      <div className="activity-reminder">
                        <h3>服务时长由管理员人工登记</h3>
                        <p>
                          报名不会自动生成时长。活动结束后核对实际服务情况，再提交复核。
                        </p>
                      </div>
                      <div className="activity-reminder">
                        <h3>材料与业务进度独立记录</h3>
                        <p>
                          生成或下载附件1不会改变项目状态，状态变更需明确提交。
                        </p>
                      </div>
                      <div className="activity-reminder">
                        <h3>最终认定由数据管理员处理</h3>
                        <p>
                          活动管理员负责基础信息、立项和现场出勤；数据管理员负责审核、招募、时长与材料。
                        </p>
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )
          )}
          {detailLoading && (
            <p role="status" className="activity-detail-status">
              正在读取项目详情…
            </p>
          )}
          {detailError && (
            <p className="error" role="alert">
              {detailError}
            </p>
          )}
          <footer className="activity-footer">
            <span>北京航空航天大学 · 志愿服务项目管理平台</span>
            <span>
              {data
                ? `数据更新于 ${new Date(data.generated_at).toLocaleTimeString("zh-CN", { hour12: false })}`
                : "活动管理"}
            </span>
          </footer>
        </main>
      </div>
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
      {detail && (
        <Modal title="项目基础详情" onClose={() => setDetail(null)}>
          <div className="activity-detail-heading">
            <h3>{detail.name}</h3>
            <Badge status={detail.status} />
            <p>{detail.code}</p>
          </div>
          <dl className="activity-detail-list">
            {(
              [
                ["主办部门", detail.department],
                ["活动负责人", detail.owner_name],
                ["活动时间", `${detail.starts_on} 至 ${detail.ends_on}`],
                ["活动地点", detail.location],
                ["项目描述", detail.description || "暂未填写"],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="activity-detail-note">
            项目详情提供立项审批、成员招募、现场出勤、时长补录及附件1。
          </p>
          <div className="activity-modal-actions">
            <button className="button primary" onClick={() => setDetail(null)}>
              完成
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
