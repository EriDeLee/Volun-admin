import { useEffect, useState } from "react";
import type { WorkspaceProps, Project } from "../types.ts";
import type { Workflow } from "../lib/workflow.ts";
import { request } from "../lib/workflow.ts";
import { asApiError } from "../lib/api.ts";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";

interface Queue {
  items: {
    project: Project;
    application: Workflow["state"]["applications"][number];
  }[];
  total: number;
  page_size: number;
}

export default function ApprovalsPage(props: WorkspaceProps) {
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    request<Queue>(
      `/activity/approvals?page=${page}&q=${encodeURIComponent(search)}`,
    )
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause) => {
        if (!active) return;
        const e = asApiError(cause);
        if (e.status === 401 || e.code === 200009) props.onSessionIssue(e);
        else setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, search, revision]);
  return (
    <WorkspaceShell {...props} route="/approvals" crumb="项目审批">
      <div className="page-heading">
        <div>
          <h1>项目审批</h1>
          <p>
            集中处理待审核的立项申请和基础信息变更，打开申请核对完整内容后审批。
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
        >
          <Icon name="refresh" />
          刷新列表
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel approvals-panel" aria-busy={loading}>
        <div className="approvals-panel-heading">
          <div>
            <Icon name="shield" />
            <h2>待审批申请</h2>
            <span className="approvals-count">{data?.total ?? "—"}</span>
          </div>
          <span>立项申请 / 基础信息变更</span>
        </div>
        <form
          className="approvals-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query.trim());
            setRevision((v) => v + 1);
          }}
        >
          <label className="activity-search">
            <Icon name="search" />
            <input
              aria-label="搜索申请"
              value={query}
              maxLength={160}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="项目名称、编号或申请人"
            />
          </label>
          <button className="button secondary">搜索</button>
          {search && (
            <button
              type="button"
              className="activity-text-button"
              onClick={() => {
                setQuery("");
                setSearch("");
                setPage(1);
              }}
            >
              清空筛选
            </button>
          )}
        </form>
        <p className="approvals-summary" role="status">
          {loading
            ? "正在加载申请…"
            : error
              ? "申请列表加载失败"
              : `共 ${data?.total || 0} 项待审批申请`}
        </p>
        {!loading && !error && !data?.items.length && (
          <div className="approvals-empty">
            <span className="approvals-empty-icon">
              <Icon name={search ? "search" : "check"} />
            </span>
            <h3>{search ? "没有找到相关申请" : "暂无待审批申请"}</h3>
            <p>
              {search
                ? "试试其他关键词，或清空筛选查看全部申请。"
                : "活动管理员提交立项或项目变更后，会出现在这里。"}
            </p>
            <button
              className="button secondary"
              onClick={() =>
                search
                  ? (setSearch(""), setQuery(""), setPage(1))
                  : props.onNavigate("/projects")
              }
            >
              {search ? "清空筛选" : "查看项目台账"}
              <Icon name="arrow" />
            </button>
          </div>
        )}
        {!loading &&
          !error &&
          data?.items.map(({ project, application: app }) => (
            <article className="approval-item" key={app.id}>
              <div className="approval-item-content">
                <div className="approval-item-title">
                  <span
                    className={`approval-kind ${app.kind === "initial" ? "initial" : "change"}`}
                  >
                    {app.kind === "initial" ? "立项申请" : "信息变更"}
                  </span>
                  <h2>{app.basics.name}</h2>
                </div>
                <p>
                  {app.kind === "initial" ? "立项申请" : "基础信息变更"} ·{" "}
                  {project.code} · {app.applicant} ·{" "}
                  {new Date(app.created_at).toLocaleString("zh-CN")}
                </p>
                <p>
                  {app.basics.starts_on} 至 {app.basics.ends_on} ·{" "}
                  {app.basics.location}
                </p>
                {app.reason && <p>申请理由：{app.reason}</p>}
              </div>
              <a
                className="button primary"
                href={`/projects/${encodeURIComponent(project.id)}?tab=overview`}
                onClick={(e) => {
                  e.preventDefault();
                  props.onNavigate(
                    `/projects/${encodeURIComponent(project.id)}?tab=overview`,
                  );
                }}
              >
                查看并审批
              </a>
            </article>
          ))}
        {data && data.total > data.page_size && (
          <div className="activity-actions approvals-pagination">
            <button
              className="button secondary"
              disabled={loading || page === 1}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>
              第 {page} / {Math.ceil(data.total / data.page_size)} 页
            </span>
            <button
              className="button secondary"
              disabled={loading || page * data.page_size >= data.total}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
