import type {
  Project,
  ProjectList,
  ProjectPageProps,
  WorkspaceProps,
} from "../types.ts";
import React, { useEffect, useState } from "react";
import Icon from "./Icon.tsx";

export function DraftNotice() {
  return (
    <div className="workspace-info">
      <Icon name="info" />
      <p>
        当前可编辑本次会话草稿，刷新或退出后清除。招募、场次、时长与材料尚未开放服务器保存；草稿不产生认定时长。
      </p>
    </div>
  );
}

export function Empty({
  icon = "folder",
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="activity-empty">
      <span className="activity-empty-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function useProject({
  id,
  api,
  onSessionIssue,
}: Pick<ProjectPageProps, "id" | "api" | "onSessionIssue">) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!id);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setProject(null);
    setError("");
    setLoading(!!id);
    if (id)
      api(`/activity/projects/${encodeURIComponent(id)}`)
        .then((p) => {
          if (active) setProject(p);
        })
        .catch((e) => {
          if (!active) return;
          if (e.status === 401 || e.code === 200009) onSessionIssue(e);
          else
            setError(
              e.status === 404
                ? "该项目不存在或不在你的访问范围内。"
                : e.message,
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    return () => {
      active = false;
    };
  }, [id, revision]);
  return { project, error, loading, retry: () => setRevision((v) => v + 1) };
}

export function ProjectPicker({
  api,
  onSessionIssue,
  selected,
  onSelect,
}: Pick<WorkspaceProps, "api" | "onSessionIssue"> & {
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const [result, setResult] = useState<ProjectList | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      page_size: "20",
      q: filter,
    });
    api(`/activity/projects?${params}`)
      .then((r) => {
        if (active) setResult(r);
      })
      .catch((e) => {
        if (!active) return;
        if (e.status === 401 || e.code === 200009) onSessionIssue(e);
        else setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [filter, page, revision]);
  return (
    <section className="panel project-picker">
      <div className="activity-panel-heading">
        <div>
          <h2>选择项目</h2>
          <p>先选一个有权管理的项目，再开始填写。</p>
        </div>
      </div>
      <form
        className="workspace-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(query.trim());
          setPage(1);
        }}
      >
        <label className="activity-search">
          <Icon name="search" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="查找项目"
            placeholder="项目名称或编号"
          />
        </label>
        <button className="button secondary" disabled={busy}>
          查询
        </button>
      </form>
      {error ? (
        <div className="activity-error" role="alert">
          <p>{error}</p>
          <button
            className="button secondary"
            onClick={() => setRevision((v) => v + 1)}
          >
            重新加载
          </button>
        </div>
      ) : busy ? (
        <p className="activity-loading" role="status">
          正在读取项目…
        </p>
      ) : (
        <>
          <div className="project-options">
            {result?.items?.length ? (
              result.items.map((p) => (
                <button
                  key={p.id}
                  className={`project-option ${selected === p.id ? "selected" : ""}`}
                  onClick={() => onSelect(p.id)}
                >
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {p.code} · {p.department}
                    </small>
                  </span>
                  <Icon name="arrow" />
                </button>
              ))
            ) : (
              <Empty title="没有符合条件的项目">
                请调整关键词或在项目台账新建项目。
              </Empty>
            )}
          </div>
          <div className="pagination">
            <span>
              共 {result?.total ?? 0} 项 · 第 {page} 页
            </span>
            <div className="activity-actions">
              <button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <button
                className="button secondary"
                disabled={page * 20 >= (result?.total || 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
