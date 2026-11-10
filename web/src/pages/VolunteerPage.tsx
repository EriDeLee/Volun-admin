import { VolunteerGuarantees } from "../components/VolunteerGuarantees.tsx";
import { useEffect, useState } from "react";
import type { Project, WorkspaceProps } from "../types.ts";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import { request } from "../lib/workflow.ts";
import { asApiError } from "../lib/api.ts";
import { profileComplete } from "../lib/profile.ts";
import "./volunteer.css";

export interface VolunteerProject {
  guarantees?: string[];
  other_guarantee?: string;
  project: Project;
  form_id: string;
  deadline: string;
  registered: boolean;
  participated: boolean;
  recognized_hours: number | null;
}

export default function VolunteerPage(
  props: WorkspaceProps & { mine: boolean },
) {
  const { mine, session, onNavigate, onSessionIssue } = props;
  const [items, setItems] = useState<VolunteerProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    request<{ items: VolunteerProject[] }>("/volunteer/projects")
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch((cause) => {
        if (!active) return;
        const e = asApiError(cause);
        setError(e.message);
        if (e.status === 401 || e.status === 403) onSessionIssue(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, mine]);
  const own = items.filter((item) => item.registered);
  const recruiting = items.filter((item) => item.form_id);
  const visible = (mine ? own : recruiting).filter(
    (item) =>
      (filter === "全部" ||
        (filter === "已参加" ? item.participated : !item.participated)) &&
      `${item.project.name} ${item.project.department} ${item.project.location}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const title = mine ? "我的服务" : "招募活动";
  const open = (item: VolunteerProject) => {
    const target = `/signup?project=${encodeURIComponent(item.project.id)}${item.registered ? "" : `&form=${encodeURIComponent(item.form_id)}`}`;
    if (!item.registered && !profileComplete(session.user)) {
      sessionStorage.setItem("volunteer_return", target);
      onNavigate("/profile");
    } else onNavigate(target);
  };
  return (
    <WorkspaceShell
      {...props}
      route={mine ? "/my-services" : "/recruitment"}
      crumb={title}
    >
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {mine
              ? "每一次报名与付出，都在这里留下记录。"
              : "找到适合你的服务，从一次报名开始。"}
          </p>
        </div>
      </div>
      <section className="volunteer-overview" aria-label="我的志愿服务概况">
        <div>
          <span>已报名服务</span>
          <strong>{loading || error ? "—" : own.length}</strong>
        </div>
        <div>
          <span>已参加服务</span>
          <strong>
            {loading || error ? "—" : own.filter((i) => i.participated).length}
          </strong>
        </div>
        <div>
          <span>已公布认定时长</span>
          <strong>
            {loading || error
              ? "—"
              : own.reduce((sum, i) => sum + (i.recognized_hours ?? 0), 0)}
            <small> 小时</small>
          </strong>
        </div>
      </section>
      {!profileComplete(session.user) && (
        <div className="workspace-info">
          <p>报名前请先完善姓名、学号 / 人员编号和绑定手机号。</p>
          <button
            className="button secondary"
            onClick={() => onNavigate("/profile")}
          >
            完善个人信息
          </button>
        </div>
      )}
      <div className="volunteer-toolbar">
        <label>
          搜索活动
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="活动名称、学院或地点"
          />
        </label>
        {mine && (
          <label>
            服务记录
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {["全部", "已报名待参加", "已参加"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading ? (
        <p role="status">正在加载活动…</p>
      ) : error ? (
        <div role="alert">
          <p className="error">{error}</p>
          <button
            className="button secondary"
            onClick={() => setAttempt((v) => v + 1)}
          >
            重新加载
          </button>
        </div>
      ) : visible.length ? (
        <div className="volunteer-list">
          {visible.map((item) => (
            <article className="volunteer-card" key={item.project.id}>
              <div className="activity-actions">
                <span className="activity-badge">
                  {item.registered
                    ? item.participated
                      ? "已参加"
                      : "已报名"
                    : "正在招募"}
                </span>
                <span className="muted">{item.project.department}</span>
              </div>
              <h2>{item.project.name}</h2>
              <p>
                {item.project.description || "服务内容以报名页公布的安排为准。"}
              </p>
              <VolunteerGuarantees value={item} />
              <dl>
                <div>
                  <dt>服务日期</dt>
                  <dd>
                    {item.project.starts_on} 至 {item.project.ends_on}
                  </dd>
                </div>
                <div>
                  <dt>服务地点</dt>
                  <dd>{item.project.location || "待公布"}</dd>
                </div>
                <div>
                  <dt>{mine ? "认定时长" : "报名截止"}</dt>
                  <dd>
                    {mine
                      ? item.recognized_hours === null
                        ? "待公布"
                        : `${item.recognized_hours} 小时`
                      : item.deadline
                        ? new Date(item.deadline).toLocaleString("zh-CN")
                        : "以招募关闭时间为准"}
                  </dd>
                </div>
              </dl>
              <button className="button primary" onClick={() => open(item)}>
                {item.registered
                  ? "查看本人服务记录"
                  : profileComplete(session.user)
                    ? "查看活动并报名"
                    : "完善资料后报名"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <section className="panel volunteer-empty">
          <h2>
            {search || filter !== "全部"
              ? "暂无符合条件的服务"
              : mine
                ? "还没有关联到你的服务记录"
                : "暂无正在招募的活动"}
          </h2>
          <p>
            {mine
              ? "账号报名后会自动收录；历史手动登记请联系管理员核实并关联账号。"
              : "活动发布招募后会显示在这里，稍后再来看看。"}
          </p>
          {mine && (
            <button
              className="button primary"
              onClick={() => onNavigate("/recruitment")}
            >
              浏览招募活动
            </button>
          )}
        </section>
      )}
      <p className="panel-note">
        已参加依据本人出勤或已登记的服务时长；报名不会自动产生时长，认定结果以审核公布为准。
      </p>
    </WorkspaceShell>
  );
}
