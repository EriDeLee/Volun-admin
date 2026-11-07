import type { ProjectPageProps } from "../types.ts";
import React, { useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import Badge from "../components/Badge.tsx";
import Modal from "../components/Modal.tsx";
import {
  DraftNotice,
  Empty,
  useProject,
} from "../components/ProjectContext.tsx";
import { useDraft, exportCSV } from "../lib/drafts.tsx";
import { projectStatuses } from "../lib/constants.ts";

const tabs = [
  ["overview", "项目概览"],
  ["recruit", "招募登记"],
  ["hours", "计时与时长"],
  ["materials", "材料"],
  ["review", "录入与审核"],
  ["history", "操作记录"],
];
const blankPerson = {
  name: "",
  number: "",
  department: "",
  position: "",
  session: "",
};

export default function ProjectDetail(
  props: ProjectPageProps & { id: string },
) {
  const { id, api, onNavigate, onSessionIssue, search = "" } = props;
  const {
    project: p,
    error,
    loading,
    retry,
  } = useProject({ id, api, onSessionIssue });
  const [draft, update] = useDraft(id);
  const requestedTab = new URLSearchParams(search).get("tab");
  const tab = tabs.some(([key]) => key === requestedTab)
    ? requestedTab
    : "overview";
  const [modal, setModal] = useState("");
  const [person, setPerson] = useState(blankPerson);
  const [session, setSession] = useState({
    name: "",
    start: "",
    end: "",
    positions: "",
    capacity: "",
  });
  const [formError, setFormError] = useState("");
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const open = (type: string) => {
    setModal(type);
    setFormError("");
    setPerson(blankPerson);
    setPaste("");
  };
  const go = (key: string) =>
    onNavigate(
      key === "hours" || key === "materials"
        ? `/${key}?project=${encodeURIComponent(id)}`
        : `/projects/${encodeURIComponent(id)}?tab=${key}`,
    );
  const addPerson = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = Object.fromEntries(
      Object.entries(person).map(([k, v]) => [k, v.trim()]),
    ) as typeof person;
    if (!clean.name || !clean.number || !clean.department || !clean.position) {
      setFormError("请填写姓名、人员编号、部门和岗位。");
      return;
    }
    if (draft.people.some((v) => v.number === clean.number)) {
      setFormError("本项目草稿已有相同人员编号，请核对后再添加。");
      return;
    }
    update((d) => ({
      ...d,
      people: [
        ...d.people,
        { ...clean, id: crypto.randomUUID(), source: "手动草稿" },
      ],
      saved: false,
    }));
    setModal("");
    setNotice("已添加到本次会话的招募草稿，尚未保存到服务器。");
  };
  const addSession = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const start = new Date(session.start),
      end = new Date(session.end);
    if (
      !session.name.trim() ||
      !session.positions.trim() ||
      !(end > start) ||
      !Number.isInteger(Number(session.capacity)) ||
      Number(session.capacity) < 1
    ) {
      setFormError(
        "请填写完整场次信息；结束时间需晚于开始时间，人数需为正整数。",
      );
      return;
    }
    if (
      !p ||
      session.start.slice(0, 10) < p.starts_on ||
      session.end.slice(0, 10) > p.ends_on
    ) {
      setFormError("场次时间需在项目起止日期内。");
      return;
    }
    update((d) => ({
      ...d,
      sessions: [
        ...d.sessions,
        {
          ...session,
          name: session.name.trim(),
          id: crypto.randomUUID(),
          max_hours: Math.floor((end.getTime() - start.getTime()) / 3600000),
        },
      ],
      saved: false,
    }));
    setSession({ name: "", start: "", end: "", positions: "", capacity: "" });
    setModal("");
    setNotice("已添加场次草稿，尚未保存到服务器。");
  };
  const parsed = paste.trim()
    ? paste
        .trim()
        .split(/\r?\n/)
        .map((line, i) => {
          const [name = "", number = "", department = "", position = ""] = line
            .split("\t")
            .map((v) => v.trim());
          const duplicate =
            draft.people.some((p) => p.number === number) ||
            paste
              .trim()
              .split(/\r?\n/)
              .slice(0, i)
              .some((l) => l.split("\t")[1]?.trim() === number);
          return {
            name,
            number,
            department,
            position,
            issue:
              !name || !number || !department || !position
                ? "必填列不完整"
                : duplicate
                  ? "编号重复，请核对"
                  : "可录入",
          };
        })
    : [];
  const importDraft = () => {
    if (!parsed.length || parsed.some((p) => p.issue !== "可录入")) {
      setFormError("请修正全部预检问题后再录入草稿。");
      return;
    }
    update((d) => ({
      ...d,
      people: [
        ...d.people,
        ...parsed.map(({ issue, ...p }) => ({
          ...p,
          id: crypto.randomUUID(),
          session: "",
          source: "批量草稿",
        })),
      ],
      saved: false,
    }));
    setModal("");
    setNotice(`已录入 ${parsed.length} 条本次会话草稿。`);
  };
  const people = draft.people.filter((v) =>
    `${v.name}${v.number}${v.department}`.includes(query),
  );
  return (
    <WorkspaceShell {...props} route={`/projects/${id}`} crumb="项目详情">
      <button
        className="activity-text-button back-link"
        onClick={() => onNavigate("/projects")}
      >
        ← 返回项目台账
      </button>
      {props.parentError && (
        <p className="error" role="alert">
          {props.parentError}
        </p>
      )}
      {loading ? (
        <section className="panel activity-loading" role="status">
          正在读取项目详情…
        </section>
      ) : error ? (
        <section className="panel activity-error" role="alert">
          <h2>无法读取项目</h2>
          <p>{error}</p>
          <button className="button secondary" onClick={retry}>
            重新加载
          </button>
        </section>
      ) : (
        p && (
          <>
            <section className="panel workspace-detail-head">
              <div className="page-heading">
                <div>
                  <div className="row-title">
                    <h1>{p.name}</h1>
                    <Badge status={p.status} />
                  </div>
                  <p>
                    {p.code} · {p.department}
                  </p>
                </div>
                <div className="activity-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      onNavigate(
                        `/signup?preview=1&project=${encodeURIComponent(id)}`,
                      )
                    }
                  >
                    <Icon name="file" />
                    问卷版式预览
                  </button>
                </div>
              </div>
              <div className="detail-meta">
                <span>
                  <Icon name="calendar" />
                  {p.starts_on} 至 {p.ends_on}
                </span>
                <span>
                  <Icon name="location" />
                  {p.location}
                </span>
                <span>
                  <Icon name="people" />
                  负责人：{p.owner_name || "未提供"}
                </span>
              </div>
              <div
                className="activity-tabs"
                role="tablist"
                aria-label="项目详情标签"
              >
                {tabs.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    className={tab === key ? "selected" : ""}
                    onClick={() => go(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
            {tab === "overview" && (
              <div className="detail-layout">
                <div className="activity-column">
                  <section className="panel">
                    <div className="activity-panel-heading">
                      <h2>项目进度</h2>
                      <span className="muted">当前阶段：{p.status}</span>
                    </div>
                    <div className="project-steps">
                      {projectStatuses
                        .filter((s) => s !== "驳回")
                        .map((s, i) => (
                          <div
                            key={s}
                            className={`project-step ${s === p.status ? "current" : ""}`}
                          >
                            <span>{i + 1}</span>
                            {s}
                          </div>
                        ))}
                    </div>
                    <div className="workspace-info">
                      <Icon name="info" />
                      <p>
                        状态以服务器记录为准。报名、草稿编辑与材料下载均不会推进项目状态。
                      </p>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="activity-panel-heading">
                      <h2>项目基本信息</h2>
                      <Badge status={p.status} />
                    </div>
                    <dl className="workspace-kv">
                      {(
                        [
                          ["主办部门", p.department],
                          ["活动负责人", p.owner_name],
                          ["服务地点", p.location],
                          ["活动开始", p.starts_on],
                          ["活动结束", p.ends_on],
                          [
                            "创建时间",
                            p.created_at
                              ? new Date(p.created_at).toLocaleString("zh-CN")
                              : "未提供",
                          ],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v || "未提供"}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="workspace-description">
                      <h3>项目介绍</h3>
                      <p>{p.description || "暂未填写项目描述。"}</p>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="activity-panel-heading">
                      <div>
                        <h2>场次与岗位</h2>
                        <p>{draft.sessions.length} 个本次会话草稿场次</p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => open("session")}
                      >
                        <Icon name="plus" />
                        添加场次草稿
                      </button>
                    </div>
                    {draft.sessions.length ? (
                      <div className="activity-table-wrap">
                        <table className="activity-table">
                          <thead>
                            <tr>
                              <th>场次</th>
                              <th>服务时间</th>
                              <th>岗位</th>
                              <th>计划人数</th>
                              <th>每人上限</th>
                            </tr>
                          </thead>
                          <tbody>
                            {draft.sessions.map((s) => (
                              <tr key={s.id}>
                                <td>{s.name}</td>
                                <td>
                                  {s.start.replace("T", " ")}
                                  <small>至 {s.end.replace("T", " ")}</small>
                                </td>
                                <td>{s.positions}</td>
                                <td>{s.capacity}</td>
                                <td>{s.max_hours} 整数小时</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title="还没有场次草稿">
                        添加服务时间、岗位与计划人数，便于安排招募与时长。
                      </Empty>
                    )}
                  </section>
                </div>
                <div className="activity-column">
                  <section className="panel">
                    <div className="activity-panel-heading">
                      <h2>招募进展</h2>
                      <Badge status="草稿" />
                    </div>
                    <div className="draft-metric">
                      <strong>{draft.people.length}</strong>
                      <span>本次会话招募草稿人数</span>
                    </div>
                    <div className="workspace-description">
                      <button
                        className="button primary"
                        onClick={() => go("recruit")}
                      >
                        <Icon name="people" />
                        管理招募草稿
                      </button>
                    </div>
                    <DraftNotice />
                  </section>
                  <section className="panel">
                    <div className="activity-panel-heading">
                      <h2>业务提醒</h2>
                      <Icon name="info" />
                    </div>
                    <div className="activity-reminder">
                      <h3>报名不自动产生时长</h3>
                      <p>活动后请逐人核对实际服务情况，再人工登记时长。</p>
                    </div>
                    <div className="activity-reminder">
                      <h3>材料下载不推进状态</h3>
                      <p>申请表预览用于核对信息，最终审核由数据管理员处理。</p>
                    </div>
                  </section>
                </div>
              </div>
            )}
            {tab === "recruit" && (
              <>
                <DraftNotice />
                <section className="panel">
                  <div className="activity-panel-heading">
                    <div>
                      <h2>志愿者名单</h2>
                      <p>
                        {draft.people.length} 条本次会话草稿 ·
                        人员编号按文本保留
                      </p>
                    </div>
                    <div className="activity-actions">
                      <button
                        className="button secondary"
                        onClick={() => open("paste")}
                      >
                        <Icon name="upload" />
                        批量粘贴
                      </button>
                      <button
                        className="button primary"
                        onClick={() => open("person")}
                      >
                        <Icon name="plus" />
                        添加志愿者
                      </button>
                    </div>
                  </div>
                  <div className="workspace-filters">
                    <label className="activity-search">
                      <Icon name="search" />
                      <input
                        aria-label="搜索志愿者"
                        placeholder="姓名、编号或部门"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={!draft.people.length}
                      onClick={() =>
                        exportCSV("招募草稿.csv", [
                          ["姓名", "人员编号", "学院 / 部门", "岗位", "来源"],
                          ...draft.people.map((v) => [
                            v.name,
                            v.number,
                            v.department,
                            v.position,
                            v.source,
                          ]),
                        ])
                      }
                    >
                      <Icon name="download" />
                      导出草稿
                    </button>
                  </div>
                  {people.length ? (
                    <div className="activity-table-wrap">
                      <table className="activity-table">
                        <thead>
                          <tr>
                            {(
                              [
                                "姓名",
                                "学号 / 人员编号",
                                "学院 / 部门",
                                "岗位 / 场次",
                                "来源",
                                "状态",
                              ] as const
                            ).map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {people.map((v) => (
                            <tr key={v.id}>
                              <td>{v.name}</td>
                              <td>{v.number}</td>
                              <td>{v.department}</td>
                              <td>
                                {v.position}
                                <small>
                                  {draft.sessions.find(
                                    (s) => s.id === v.session,
                                  )?.name || "待分配场次"}
                                </small>
                              </td>
                              <td>{v.source}</td>
                              <td>
                                <Badge status="草稿" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon="people"
                      title={query ? "没有匹配的志愿者" : "尚无招募草稿"}
                    >
                      可以手动添加或粘贴表格数据。报名名单尚未接入服务器。
                    </Empty>
                  )}
                </section>
              </>
            )}
            {tab === "review" && (
              <>
                <div className="workspace-info">
                  <Icon name="info" />
                  <p>
                    时长复核与最终审核尚未开放。活动管理员不能自行通过或驳回时长认定。
                  </p>
                </div>
                <section className="panel">
                  <div className="activity-panel-heading">
                    <h2>录入与审核</h2>
                    <Badge status="草稿">尚未接入</Badge>
                  </div>
                  <div className="project-steps">
                    {(["统计", "数据", "录入", "审核", "通过"] as const).map(
                      (s, i) => (
                        <div key={s} className="project-step">
                          <span>{i + 1}</span>
                          {s}
                        </div>
                      ),
                    )}
                  </div>
                  <Empty icon="shield" title="暂无可读取的复核快照">
                    完成实际服务核对后提交复核；外部系统录入结果与最终认定将分别记录。
                  </Empty>
                </section>
              </>
            )}
            {tab === "history" && (
              <section className="panel">
                <div className="activity-panel-heading">
                  <h2>操作记录</h2>
                </div>
                <Empty icon="clock" title="操作日志尚未接入">
                  当前仅能读取项目创建时间与最近更新时间，不推断中间操作。
                </Empty>
                <dl className="workspace-kv">
                  {(
                    [
                      ["创建时间", p.created_at],
                      ["最近更新", p.updated_at],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {v ? new Date(v).toLocaleString("zh-CN") : "未提供"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </>
        )
      )}
      {modal && (
        <Modal
          title={
            modal === "person"
              ? "添加志愿者草稿"
              : modal === "session"
                ? "添加场次草稿"
                : "批量登记预检"
          }
          onClose={() => setModal("")}
        >
          <div className="activity-project-form">
            {modal === "person" && (
              <form onSubmit={addPerson}>
                <div className="activity-form-fields">
                  {(
                    [
                      ["name", "姓名"],
                      ["number", "学号 / 人员编号"],
                      ["department", "学院 / 部门"],
                      ["position", "服务岗位"],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k}>
                      {label} *
                      <input
                        required
                        maxLength={80}
                        value={person[k]}
                        onChange={(e) =>
                          setPerson({ ...person, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <label className="full">
                    参与场次
                    <select
                      value={person.session}
                      onChange={(e) =>
                        setPerson({ ...person, session: e.target.value })
                      }
                    >
                      <option value="">待分配</option>
                      {draft.sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {formError && (
                  <p role="alert" className="error">
                    {formError}
                  </p>
                )}
                <div className="activity-modal-actions">
                  <button className="button primary">添加到草稿</button>
                </div>
              </form>
            )}
            {modal === "session" && (
              <form onSubmit={addSession}>
                <div className="activity-form-fields">
                  {(
                    [
                      ["name", "场次名称", "text"],
                      ["positions", "岗位安排", "text"],
                      ["start", "开始时间", "datetime-local"],
                      ["end", "结束时间", "datetime-local"],
                      ["capacity", "计划人数", "number"],
                    ] as const
                  ).map(([k, label, type]) => (
                    <label key={k}>
                      {label} *
                      <input
                        required
                        type={type}
                        min={type === "number" ? 1 : undefined}
                        max={type === "number" ? 100000 : undefined}
                        maxLength={160}
                        value={session[k]}
                        onChange={(e) =>
                          setSession({ ...session, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="password-hint">
                  时长上限按实际起止时间向下取整为小时；不自动生成个人时长。
                </p>
                {formError && (
                  <p role="alert" className="error">
                    {formError}
                  </p>
                )}
                <div className="activity-modal-actions">
                  <button className="button primary">添加场次草稿</button>
                </div>
              </form>
            )}
            {modal === "paste" && (
              <>
                <label className="workspace-field">
                  按列粘贴：姓名、人员编号、学院 / 部门、岗位
                  <textarea
                    aria-label="批量名单"
                    rows={6}
                    maxLength={100000}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder="从表格复制四列，以 Tab 分隔；不包含表头。"
                  />
                </label>
                <div className="activity-table-wrap">
                  <table className="activity-table">
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>编号</th>
                        <th>预检结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.map((v, i) => (
                        <tr key={i}>
                          <td>{v.name || "—"}</td>
                          <td>{v.number || "—"}</td>
                          <td>{v.issue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {formError && (
                  <p role="alert" className="error">
                    {formError}
                  </p>
                )}
                <div className="activity-modal-actions">
                  <button
                    className="button primary"
                    disabled={
                      !parsed.length || parsed.some((v) => v.issue !== "可录入")
                    }
                    onClick={importDraft}
                  >
                    录入本次会话草稿
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      <footer className="activity-footer">
        北京航空航天大学 · 志愿服务项目管理平台
      </footer>
    </WorkspaceShell>
  );
}
