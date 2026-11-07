import type { ProjectPageProps } from "../types.ts";
import { useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import Badge from "../components/Badge.tsx";
import Modal from "../components/Modal.tsx";
import {
  DraftNotice,
  Empty,
  ProjectPicker,
  useProject,
} from "../components/ProjectContext.tsx";
import { useDraft, exportCSV } from "../lib/drafts.tsx";

export default function HoursPage(props: ProjectPageProps) {
  const { id, api, onSessionIssue, onNavigate } = props;
  const { project, error, loading, retry } = useProject({
    id,
    api,
    onSessionIssue,
  });
  const [draft, update] = useDraft(id);
  const [sessionID, setSessionID] = useState("");
  const [batch, setBatch] = useState("");
  const [message, setMessage] = useState("");
  const [validation, setValidation] = useState("");
  const [snapshot, setSnapshot] = useState<{
    session: string;
    total: number;
    count: number;
    time: string;
    rows: { name: string; number: string; hours: string }[];
  } | null>(null);
  const session =
    draft.sessions.find((v) => v.id === sessionID) || draft.sessions[0];
  const people = session
    ? draft.people.filter((p) => p.session === session.id)
    : [];
  const hours = draft.hours[session?.id] || {};
  const validHour = (v: string | undefined) =>
    v !== "" &&
    v !== undefined &&
    Number.isInteger(Number(v)) &&
    Number(v) >= 0 &&
    Number(v) <= session.max_hours;
  const total = people.reduce(
    (sum, p) => sum + (validHour(hours[p.id]) ? Number(hours[p.id]) : 0),
    0,
  );
  const change = (id: string, value: string) => {
    setMessage("");
    setValidation("");
    update((d) => ({
      ...d,
      saved: false,
      hours: {
        ...d.hours,
        [session.id]: { ...d.hours[session.id], [id]: value },
      },
    }));
  };
  const apply = () => {
    if (!session || !validHour(batch)) {
      setValidation(`请填写 0 至 ${session?.max_hours ?? 0} 的整数小时。`);
      return;
    }
    update((d) => ({
      ...d,
      saved: false,
      hours: {
        ...d.hours,
        [session.id]: {
          ...d.hours[session.id],
          ...Object.fromEntries(people.map((p) => [p.id, batch])),
        },
      },
    }));
    setMessage("已统一填写，请核对每位志愿者的实际服务情况。");
    setValidation("");
  };
  const save = () => {
    if (!people.length || people.some((p) => !validHour(hours[p.id]))) {
      setValidation(
        `请为每人填写 0 至 ${session.max_hours} 的整数小时，空值不等于 0。`,
      );
      return;
    }
    update({ saved: true });
    setValidation("");
    setMessage(
      "时长草稿已保留在本次会话中，刷新或退出后清除。尚未提交服务器复核。",
    );
  };
  const exportHours = () =>
    exportCSV("拟计时长草稿.csv", [
      [
        "项目编号",
        "场次",
        "姓名",
        "人员编号",
        "岗位",
        "拟计时长",
        "认定时长",
        "状态",
      ],
      ...people.map((p) => [
        project?.code || "",
        session.name,
        p.name,
        p.number,
        p.position,
        hours[p.id] ?? "",
        "",
        "本次会话草稿，未认定",
      ]),
    ]);
  return (
    <WorkspaceShell {...props} route="/hours" crumb="时长登记">
      <div className="page-heading">
        <div>
          <h1>时长登记</h1>
          <p>
            {project
              ? `${project.name} · ${project.code}`
              : "按实际服务情况登记，认真核对每一小时的付出。"}
          </p>
        </div>
        <div className="activity-actions">
          {id && (
            <button
              className="button secondary"
              onClick={() => onNavigate(`/projects/${encodeURIComponent(id)}`)}
            >
              返回项目详情
            </button>
          )}
          <button
            className="button secondary"
            onClick={exportHours}
            disabled={!people.length}
          >
            <Icon name="download" />
            导出草稿明细
          </button>
        </div>
      </div>
      {props.parentError && (
        <p className="error" role="alert">
          {props.parentError}
        </p>
      )}
      {!id ? (
        <ProjectPicker
          {...props}
          onSelect={(value) =>
            onNavigate(`/hours?project=${encodeURIComponent(value)}`)
          }
        />
      ) : loading ? (
        <section className="panel activity-loading" role="status">
          正在读取项目信息…
        </section>
      ) : error ? (
        <section className="panel activity-error" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={retry}>
            重新加载
          </button>
        </section>
      ) : (
        project && (
          <>
            <DraftNotice />
            <div className="activity-stats">
              {(
                [
                  [
                    "本场次草稿",
                    people.length,
                    "人",
                    "只显示已分配到本场次的人员",
                  ],
                  ["拟计时长", total, "小时", "尚未最终认定"],
                  ["认定时长", "—", "小时", "复核接口尚未接入"],
                  [
                    "当前版本",
                    draft.saved ? "会话已存" : "草稿",
                    "",
                    "刷新或退出后清除",
                  ],
                ] as const
              ).map(([label, value, unit, sub]) => (
                <section className="activity-stat" key={label}>
                  <div>
                    {label}
                    <span className="activity-stat-icon">
                      <Icon name="clock" />
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
            {message && (
              <p className="success" role="status">
                {message}
              </p>
            )}
            {validation && (
              <p className="error" role="alert">
                {validation}
              </p>
            )}
            <section className="panel">
              <div className="activity-panel-heading">
                <div>
                  <h2>志愿者服务时长</h2>
                  <p>{project.name} · 人工登记 · 整数小时</p>
                </div>
                <Badge status="草稿">拟计草稿</Badge>
              </div>
              {!session ? (
                <Empty
                  icon="calendar"
                  title="先安排服务场次"
                  action={
                    <button
                      className="button primary"
                      onClick={() =>
                        onNavigate(`/projects/${encodeURIComponent(id)}`)
                      }
                    >
                      添加场次草稿
                    </button>
                  }
                >
                  在项目概览设置场次时间与岗位，再到招募登记添加人员并分配场次。
                </Empty>
              ) : (
                <>
                  <div className="workspace-toolbar">
                    <label className="workspace-field">
                      服务场次
                      <select
                        aria-label="服务场次"
                        value={session.id}
                        onChange={(e) => {
                          setSessionID(e.target.value);
                          setMessage("");
                          setValidation("");
                        }}
                      >
                        {draft.sessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="activity-actions">
                      <label htmlFor="batch-hours">统一填入</label>
                      <input
                        id="batch-hours"
                        className="hours-input"
                        type="number"
                        min="0"
                        max={session.max_hours}
                        step="1"
                        value={batch}
                        onChange={(e) => setBatch(e.target.value)}
                      />
                      <span className="muted">小时</span>
                      <button
                        className="button secondary"
                        disabled={!people.length}
                        onClick={apply}
                      >
                        应用到全部
                      </button>
                    </div>
                  </div>
                  <p className="workspace-caption">
                    {session.start.replace("T", " ")} 至{" "}
                    {session.end.replace("T", " ")} · 本场次最多{" "}
                    {session.max_hours} 整数小时 / 人
                  </p>
                  {people.length ? (
                    <div className="activity-table-wrap">
                      <table className="activity-table hours-table">
                        <thead>
                          <tr>
                            {(
                              [
                                "志愿者",
                                "人员编号",
                                "学院 / 部门",
                                "实际服务岗位",
                                "拟计时长（小时）",
                                "认定时长",
                                "复核状态",
                              ] as const
                            ).map((h) => (
                              <th key={h} scope="col">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {people.map((p) => (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td>{p.number}</td>
                              <td>{p.department}</td>
                              <td>{p.position}</td>
                              <td>
                                <input
                                  className="hours-input"
                                  type="number"
                                  min="0"
                                  max={session.max_hours}
                                  step="1"
                                  aria-label={`${p.name}的拟计时长`}
                                  aria-invalid={
                                    hours[p.id] !== undefined &&
                                    !validHour(hours[p.id])
                                  }
                                  value={hours[p.id] ?? ""}
                                  onChange={(e) => change(p.id, e.target.value)}
                                />
                              </td>
                              <td className="muted">—</td>
                              <td>
                                <Badge status="草稿">未提交</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon="people"
                      title="本场次尚无人员"
                      action={
                        <button
                          className="button secondary"
                          onClick={() =>
                            onNavigate(
                              `/projects/${encodeURIComponent(id)}?tab=recruit`,
                            )
                          }
                        >
                          去分配人员
                        </button>
                      }
                    >
                      在招募登记添加志愿者时，选择此服务场次。
                    </Empty>
                  )}
                  <div className="pagination">
                    <span>
                      拟计人数 {people.length} 人 · 拟计总时长 <b>{total}</b>{" "}
                      小时
                    </span>
                    <span>报名不自动产生时长</span>
                  </div>
                </>
              )}
            </section>
            <div className="workspace-bottom-bar">
              <div>
                <strong>
                  {draft.saved ? "已保留本次会话草稿" : "核对后请保留草稿"}
                </strong>
                <p>尚未开放服务器提交；最终认定由数据管理员处理。</p>
              </div>
              <div className="activity-actions">
                <button
                  className="button secondary"
                  disabled={!people.length}
                  onClick={save}
                >
                  保留会话草稿
                </button>
                <button
                  className="button secondary"
                  disabled={!people.length}
                  onClick={() =>
                    setSnapshot({
                      session: session.name,
                      total,
                      count: people.length,
                      time: new Date().toLocaleString("zh-CN"),
                      rows: people.map((p) => ({
                        name: p.name,
                        number: p.number,
                        hours: hours[p.id] ?? "未填",
                      })),
                    })
                  }
                >
                  查看草稿快照
                </button>
                <button
                  className="button primary"
                  disabled
                  title="复核接口尚未接入"
                >
                  提交数据复核（待开放）
                </button>
              </div>
            </div>
          </>
        )
      )}
      {snapshot && (
        <Modal title="本次会话草稿快照" onClose={() => setSnapshot(null)}>
          <div className="activity-project-form">
            <p>
              {snapshot.session} · {snapshot.count} 人 · 拟计 {snapshot.total}{" "}
              小时
            </p>
            <p className="muted tiny">
              截取时间：{snapshot.time}。这是前端草稿预览，尚未提交复核。
            </p>
            <div className="activity-table-wrap">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>人员编号</th>
                    <th>拟计时长</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.number}</td>
                      <td>{r.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
      <footer className="activity-footer">
        北京航空航天大学 · 志愿服务项目管理平台
      </footer>
    </WorkspaceShell>
  );
}
