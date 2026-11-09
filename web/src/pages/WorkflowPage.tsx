import React, { useEffect, useRef, useState } from "react";
import type { ProjectPageProps } from "../types.ts";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import AssignmentPicker from "../components/AssignmentPicker.tsx";
import Icon from "../components/Icon.tsx";
import {
  request,
  approvalNames,
  attendanceNames,
  iso,
  localTime,
  sessionRangeError,
  memberAssignments,
} from "../lib/workflow.ts";
import type {
  Workflow,
  Basics,
  Member,
  Material,
  History,
  AttendanceWindow,
  PublishedForm,
} from "../lib/workflow.ts";

const formSnapshot = (form: PublishedForm) =>
  JSON.stringify([
    form.id || "",
    form.published,
    form.title || "",
    form.description || "",
    form.deadline || "",
  ]);

const emptyMember: Member = {
  id: "",
  name: "",
  number: "",
  department: "",
  phone: "",
  session_id: "",
  position_id: "",
  source: "",
  intent: "",
  platform: "",
  notes: "",
};
const labels: Record<string, string> = {
  name: "项目名称",
  department: "主办部门",
  starts_on: "开始日期",
  ends_on: "结束日期",
  location: "活动地点",
  description: "项目说明",
};
const materialLabels: Record<string, string> = {
  team: "团队名称",
  audience: "服务对象",
  registration_start: "报名开始日期",
  registration_end: "报名截止日期",
  checkin_rule: "外部打卡规则",
  checkin_start: "外部开始打卡时间",
  checkin_end: "外部截止打卡时间",
  recruitment: "外部招募方式",
  password: "外部免审密码",
  other_guarantee: "其他保障",
  description: "服务内容（500字以内）",
  contact_name: "联系人",
  contact_phone: "联系电话",
  contact_mobile: "手机",
  contact_email: "邮箱",
  notes: "补充说明",
  training: "培训信息",
};

export default function WorkflowPage(
  props: ProjectPageProps & { id: string; initialTab?: string },
) {
  const { id, onNavigate, onSessionIssue } = props;
  const base = `/activity/projects/${encodeURIComponent(id)}`;
  const [data, setData] = useState<Workflow | null>(null),
    [history, setHistory] = useState<History>({ events: [], materials: [] });
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [basics, setBasics] = useState<Basics | null>(null),
    [material, setMaterial] = useState<Material | null>(null);
  const [tab, setTab] = useState(
    props.initialTab ||
      new URLSearchParams(props.search || "").get("tab") ||
      "overview",
  );
  const [member, setMember] = useState<Member>(emptyMember),
    [paste, setPaste] = useState("");
  const [reason, setReason] = useState(""),
    [stage, setStage] = useState("招募"),
    [external, setExternal] = useState("");
  const [hourValues, setHourValues] = useState<Record<string, string>>({}),
    [source, setSource] = useState("登记");
  const [window, setWindow] = useState<AttendanceWindow>({
    session_id: "",
    action: "checkin",
    mode: "manual",
    open: false,
    start: "",
    end: "",
  });
  const [form, setForm] = useState({
    kind: "recruit",
    published: true,
    title: "志愿者报名",
    description: "",
    deadline: "",
    rotate: false,
  });
  const [access, setAccess] = useState({
    member_id: "",
    username: "",
    revoke: false,
    reason: "",
  });
  const [qr, setQR] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const mutationLock = useRef(false);
  const [copying, setCopying] = useState(false);
  const handle = (e: unknown) => {
    const failure = e as Error & { status?: number; code?: number };
    setError(failure.message);
    if (failure.status === 401 || failure.code === 200009)
      onSessionIssue(failure);
  };
  const load = async () => {
    try {
      const result = await request<Workflow>(`${base}/workflow`);
      setData(result);
      setBasics(structuredClone(result.state.draft || result.state.basics));
      setMaterial(result.state.material);
      const saved = result.state.form;
      if (saved.id)
        setForm({
          kind: "recruit",
          published: saved.published,
          title: saved.title,
          description: saved.description,
          deadline: saved.deadline,
          rotate: false,
        });
      setHistory(await request<History>(`${base}/history`));
    } catch (e) {
      handle(e);
    }
  };
  useEffect(() => {
    void load();
  }, [id]);
  const can = (capability: string) => !!data?.capabilities.includes(capability);
  const mutate = async (path: string, body: unknown, method = "POST") => {
    if (mutationLock.current || busy || !data) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let current = data;
      const formKind = (body as { kind?: string }).kind;
      const publishedForm = (value: Workflow) =>
        formKind === "intent" ? value.state.intent_form : value.state.form;
      if (path === "/forms") {
        current = await request<Workflow>(`${base}/workflow`);
        if (!current.capabilities.includes("forms.write")) {
          setData(current);
          throw new Error("当前项目已锁定问卷修改，请核对项目状态。");
        }
        if (
          formSnapshot(publishedForm(current)) !==
          formSnapshot(publishedForm(data))
        ) {
          setData(current);
          throw new Error(
            "问卷配置已由其他操作修改，已加载最新版本。你的填写内容已保留，请核对后再次保存。",
          );
        }
      }
      let result: Workflow;
      try {
        result = await request<Workflow>(
          base + path,
          body,
          method,
          current.version,
        );
      } catch (cause) {
        const failure = cause as { status?: number; code?: number };
        if (
          path !== "/forms" ||
          failure.status !== 409 ||
          failure.code !== 100003
        )
          throw cause;
        const latest = await request<Workflow>(`${base}/workflow`);
        setData(latest);
        if (
          !latest.capabilities.includes("forms.write") ||
          formSnapshot(publishedForm(latest)) !==
            formSnapshot(publishedForm(current))
        )
          throw new Error(
            "问卷配置或项目状态已变化，已加载最新版本。填写内容已保留，请核对后再次保存。",
          );
        result = await request<Workflow>(
          base + path,
          body,
          method,
          latest.version,
        );
      }
      setData(result);
      setBasics(structuredClone(result.state.draft || result.state.basics));
      setMaterial(result.state.material);
      if (path === "/forms")
        setForm((previous) => ({ ...previous, rotate: false }));
      setHistory(await request<History>(`${base}/history`));
      setNotice("已保存到服务器。");
      return true;
    } catch (e) {
      handle(e);
      const failure = e as { status?: number; code?: number };
      if (failure.status === 409 && failure.code === 100003) {
        try {
          setData(await request<Workflow>(`${base}/workflow`));
          setError(
            "项目数据已变化，已更新版本。填写内容已保留，请核对后重试。",
          );
        } catch {
          /* Keep the original conflict visible. */
        }
      }
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  };
  const sessions = data?.state.basics.sessions || [];
  const members = data?.state.members || [];
  const editSession = (index: number, key: string, value: unknown) =>
    setBasics((b) =>
      b
        ? {
            ...b,
            sessions: b.sessions.map((s, i) =>
              i === index ? { ...s, [key]: value } : s,
            ),
          }
        : b,
    );
  const tabs = [
    ["overview", "基础信息与立项"],
    ["recruit", "成员名单"],
    ["attendance", "现场出勤"],
    ["forms", "问卷与二维码"],
    ["hours", "计时与时长"],
    ["materials", "附件1"],
    ["review", "录入与审核"],
    ["history", "操作记录"],
  ].filter(([key]) => key !== "forms" || can("forms.write"));
  const nameOfSession = (sessionID: string) =>
    sessions.find((s) => s.id === sessionID)?.name || sessionID;
  const nameOfPosition = (m: Member) =>
    sessions
      .find((s) => s.id === m.session_id)
      ?.positions.find((p) => p.id === m.position_id)?.name || m.position_id;
  const rowAttendance = (memberID: string, sessionID: string) =>
    data?.state.attendance
      .filter((a) => a.member_id === memberID && a.session_id === sessionID)
      .at(-1);
  const saveBasics = (e: React.FormEvent) => {
    e.preventDefault();
    if (!basics || !data) return;
    const validation = sessionRangeError(basics);
    if (validation) {
      setError(validation);
      return;
    }
    void mutate(
      data.approval === "approved" ? "/changes" : "/basics",
      {
        version: data.version,
        basics,
        ...(data.approval === "approved" ? { reason } : {}),
      },
      data.approval === "approved" ? "POST" : "PUT",
    );
  };
  const updateMember = (key: keyof Member, value: string) =>
    setMember((m) => ({
      ...m,
      [key]: value,
      ...(key === "session_id" ? { position_id: "" } : {}),
    }));
  const memberForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void mutate("/members", { members: [member], reason }, "PUT").then(
          (ok) => {
            if (ok) setMember(emptyMember);
          },
        );
      }}
      className="workflow-form recruit-member-form"
    >
      <h3>{member.id ? "修改成员" : "登记成员"}</h3>
      {["name", "number", "department", "phone"].map((key) => (
        <label key={key}>
          {
            (
              {
                name: "姓名",
                number: "人员编号",
                department: "部门",
                phone: "联系电话",
              } as Record<string, string>
            )[key]
          }
          <input
            required={key === "name" || key === "number"}
            value={member[key as "name" | "number" | "department" | "phone"]}
            onChange={(e) => updateMember(key as keyof Member, e.target.value)}
          />
        </label>
      ))}
      <AssignmentPicker
        sessions={sessions}
        value={memberAssignments(member)}
        disabled={busy}
        onChange={(assignments) =>
          setMember((m) => ({
            ...m,
            assignments,
            session_id: assignments[0]?.session_id || "",
            position_id: assignments[0]?.position_id || "",
          }))
        }
      />
      <label className="recruit-full">
        备注
        <textarea
          rows={2}
          maxLength={1000}
          value={member.notes || ""}
          onChange={(e) => updateMember("notes", e.target.value)}
        />
      </label>
      <button className="button primary" disabled={busy}>
        保存成员
      </button>
      {member.id && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setMember(emptyMember)}
        >
          取消修改
        </button>
      )}
    </form>
  );
  return (
    <WorkspaceShell
      {...props}
      route={props.initialTab ? `/${props.initialTab}` : `/projects/${id}`}
      crumb={
        props.initialTab === "hours"
          ? "时长管理"
          : props.initialTab === "materials"
            ? "项目材料"
            : "项目协作"
      }
    >
      <main className="workflow-page">
        <header className="page-heading">
          <div>
            <p>项目协作 / {data?.project.code}</p>
            <h1>{data?.project.name || "正在读取项目"}</h1>
            <p>
              {approvalNames[data?.approval || ""]} · {data?.project.status} ·
              当前版本 {data?.version ?? "—"}
            </p>
          </div>
          <button className="button secondary" onClick={() => void load()}>
            刷新
          </button>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="success">
            {notice}
          </p>
        )}
        <nav className="workflow-tabs" aria-label="项目功能">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setQR("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {data && (
          <>
            <p className="workflow-note">
              活动管理员负责项目与现场执行；数据管理员负责立项审核、招募、时长和材料。操作均记录历史。
            </p>
            {tab === "overview" && basics && (
              <section className="panel workflow-panel">
                <h2>项目基础信息</h2>
                {data.state.legacy && (
                  <p>旧流程承接项目，系统未补造历史审批记录。</p>
                )}
                <form className="workflow-form" onSubmit={saveBasics}>
                  <fieldset
                    disabled={
                      busy ||
                      !can("basics.edit") ||
                      data.approval === "pending" ||
                      !!data.state.draft
                    }
                  >
                    <div className="workflow-grid">
                      {Object.entries(labels).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          {key === "description" ? (
                            <textarea
                              value={basics.description}
                              maxLength={2000}
                              onChange={(e) =>
                                setBasics({
                                  ...basics,
                                  description: e.target.value,
                                })
                              }
                            />
                          ) : (
                            <input
                              type={key.endsWith("_on") ? "date" : "text"}
                              required
                              maxLength={key === "location" ? 160 : 80}
                              value={String(basics[key as keyof Basics] || "")}
                              onChange={(e) =>
                                setBasics({ ...basics, [key]: e.target.value })
                              }
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <h3>场次与岗位</h3>
                    <p className="workflow-note">
                      项目日期按北京时间计算，包含开始日00:00至结束日全天。场次起止时间须在此范围内。
                    </p>
                    {basics.sessions.map((s, index) => (
                      <section className="workflow-session" key={s.id}>
                        <div className="workflow-grid">
                          <label>
                            场次名称
                            <input
                              required
                              value={s.name}
                              onChange={(e) =>
                                editSession(index, "name", e.target.value)
                              }
                            />
                          </label>
                          <label>
                            开始时间
                            <input
                              type="datetime-local"
                              required
                              value={localTime(s.start)}
                              onChange={(e) =>
                                editSession(index, "start", iso(e.target.value))
                              }
                            />
                          </label>
                          <label>
                            结束时间
                            <input
                              type="datetime-local"
                              required
                              value={localTime(s.end)}
                              onChange={(e) =>
                                editSession(index, "end", iso(e.target.value))
                              }
                            />
                          </label>
                        </div>
                        {s.positions.map((p, pi) => (
                          <div className="workflow-grid" key={p.id}>
                            <label>
                              岗位名称
                              <input
                                required
                                value={p.name}
                                onChange={(e) =>
                                  editSession(
                                    index,
                                    "positions",
                                    s.positions.map((v, i) =>
                                      i === pi
                                        ? { ...v, name: e.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              招募人数
                              <input
                                type="number"
                                required
                                min={1}
                                value={p.capacity}
                                onChange={(e) =>
                                  editSession(
                                    index,
                                    "positions",
                                    s.positions.map((v, i) =>
                                      i === pi
                                        ? {
                                            ...v,
                                            capacity: Number(e.target.value),
                                          }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              拟计整数小时
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={p.hours ?? ""}
                                onChange={(e) =>
                                  editSession(
                                    index,
                                    "positions",
                                    s.positions.map((v, i) =>
                                      i === pi
                                        ? {
                                            ...v,
                                            hours:
                                              e.target.value === ""
                                                ? null
                                                : Number(e.target.value),
                                          }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              岗位说明
                              <input
                                value={p.description}
                                onChange={(e) =>
                                  editSession(
                                    index,
                                    "positions",
                                    s.positions.map((v, i) =>
                                      i === pi
                                        ? { ...v, description: e.target.value }
                                        : v,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </div>
                        ))}
                        <div className="activity-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() =>
                              editSession(index, "positions", [
                                ...s.positions,
                                {
                                  id: crypto.randomUUID(),
                                  name: "",
                                  capacity: 1,
                                  hours: null,
                                  description: "",
                                },
                              ])
                            }
                          >
                            增加岗位
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() =>
                              setBasics({
                                ...basics,
                                sessions: basics.sessions.filter(
                                  (_, i) => i !== index,
                                ),
                              })
                            }
                          >
                            移除场次
                          </button>
                        </div>
                      </section>
                    ))}
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        setBasics({
                          ...basics,
                          sessions: [
                            ...basics.sessions,
                            {
                              id: crypto.randomUUID(),
                              name: "",
                              start: "",
                              end: "",
                              positions: [
                                {
                                  id: crypto.randomUUID(),
                                  name: "",
                                  capacity: 1,
                                  hours: null,
                                  description: "",
                                },
                              ],
                            },
                          ],
                        })
                      }
                    >
                      增加场次
                    </button>
                    {data.approval === "approved" && (
                      <label>
                        变更原因
                        <input
                          required
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          minLength={2}
                        />
                      </label>
                    )}
                    <button className="button primary">
                      {data.approval === "approved"
                        ? "提交变更申请"
                        : "保存基础信息"}
                    </button>
                  </fieldset>
                </form>
                {can("proposal.submit") &&
                  ["draft", "returned"].includes(data.approval) && (
                    <button
                      className="button primary"
                      disabled={busy || !sessions.length}
                      onClick={() =>
                        void mutate("/submit", { version: data.version })
                      }
                    >
                      提交立项
                    </button>
                  )}
                <h3>立项与变更记录</h3>
                {data.state.applications.length === 0 ? (
                  <p>暂无立项申请，请保存场次后提交。</p>
                ) : (
                  data.state.applications.map((app) => (
                    <article key={app.id} className="workflow-session">
                      <strong>
                        {app.kind === "initial" ? "立项申请" : "基础信息变更"} ·{" "}
                        {approvalNames[app.status] || app.status}
                      </strong>
                      <p>
                        {app.applicant} ·{" "}
                        {new Date(app.created_at).toLocaleString("zh-CN")} ·{" "}
                        {app.reason}
                      </p>
                      <p>
                        申请内容：{app.basics.name} / {app.basics.starts_on} 至{" "}
                        {app.basics.ends_on} /{" "}
                        {app.basics.sessions.map((s) => s.name).join("、")}
                      </p>
                      <details>
                        <summary>查看申请完整内容</summary>
                        <p>
                          主办部门：{app.basics.department} · 地点：
                          {app.basics.location}
                        </p>
                        <p>项目说明：{app.basics.description || "未填写"}</p>
                        {app.basics.sessions.map((s) => (
                          <div key={s.id}>
                            <p>
                              {s.name}：
                              {new Date(s.start).toLocaleString("zh-CN")} 至{" "}
                              {new Date(s.end).toLocaleString("zh-CN")}
                            </p>
                            {s.positions.map((p) => (
                              <p key={p.id}>
                                岗位：{p.name} · 人数：{p.capacity} · 小时：
                                {p.hours ?? "未设置"} · {p.description}
                              </p>
                            ))}
                          </div>
                        ))}
                      </details>
                      {app.reviewer && (
                        <p>
                          审核人：{app.reviewer} · 审核意见：
                          {app.review_reason || app.reason}
                          {app.reviewed_at &&
                            ` · ${new Date(app.reviewed_at).toLocaleString("zh-CN")}`}
                        </p>
                      )}
                      {can("proposal.review") && app.status === "pending" && (
                        <>
                          <label>
                            审核意见
                            <input
                              minLength={2}
                              maxLength={300}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                          </label>
                          <div className="activity-actions">
                            {[
                              ["approved", "审核通过"],
                              ["returned", "退回修改"],
                            ].map(([decision, label]) => (
                              <button
                                key={decision}
                                className="button secondary"
                                disabled={busy || reason.trim().length < 2}
                                onClick={() =>
                                  void mutate(
                                    `/applications/${app.id}/decision`,
                                    { version: data.version, decision, reason },
                                  )
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
                  ))
                )}
              </section>
            )}
            {tab === "recruit" && (
              <section className="panel workflow-panel">
                <h2>成员名单</h2>
                <p>共 {members.length} 人；报名与现场出勤、时长分别记录。</p>
                {can("members.write") && (
                  <div className="recruit-paths">
                    <button
                      type="button"
                      className="recruit-path"
                      onClick={() =>
                        document
                          .getElementById("member-registration")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                    >
                      <Icon name="people" />
                      <span>
                        <strong>管理员录入名单</strong>
                        <small>单独登记，或批量粘贴已有名单</small>
                      </span>
                      <Icon name="arrow" />
                    </button>
                    <button
                      type="button"
                      className="recruit-path"
                      onClick={() => {
                        if (form.kind !== "recruit") {
                          const saved = data.state.form;
                          setForm({
                            kind: "recruit",
                            published: saved.id ? saved.published : true,
                            title: saved.title || "志愿者报名",
                            description: saved.description || "",
                            deadline: saved.deadline || "",
                            rotate: false,
                          });
                        }
                        setTab("forms");
                      }}
                    >
                      <Icon name="file" />
                      <span>
                        <strong>分享报名问卷</strong>
                        <small>发布固定问卷，由成员自行填写</small>
                      </span>
                      <Icon name="arrow" />
                    </button>
                  </div>
                )}
                {can("forms.write") && data.state.form.id && (
                  <div className="recruit-share">
                    <strong>
                      报名问卷 ·{" "}
                      {data.state.form.published ? "已开放" : "已关闭"}
                    </strong>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`/signup?project=${id}&form=${data.state.form.id}`}
                    >
                      打开报名问卷
                    </a>
                    <button
                      className="activity-text-button"
                      disabled={copying}
                      onClick={async () => {
                        setCopying(true);
                        try {
                          await navigator.clipboard.writeText(
                            `${location.origin}/signup?project=${id}&form=${data.state.form.id}`,
                          );
                          setNotice(
                            "报名问卷链接已复制，可以发给成员自行填写。",
                          );
                        } catch {
                          setError("复制失败，请打开问卷后复制地址。");
                        } finally {
                          setCopying(false);
                        }
                      }}
                    >
                      复制报名链接
                    </button>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`/api/v1${base}/forms/qr?kind=recruit`}
                    >
                      下载二维码
                    </a>
                  </div>
                )}
                {can("export") && (
                  <a
                    className="button secondary"
                    href={`/api/v1${base}/members/export`}
                  >
                    导出名单与时长
                  </a>
                )}
                <div className="workflow-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "姓名",
                          "人员编号",
                          "部门",
                          "场次",
                          "岗位",
                          "来源",
                          "备注",
                          "操作",
                        ].map((v) => (
                          <th key={v}>{v}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>{m.number}</td>
                          <td>{m.department}</td>
                          <td>
                            {[
                              ...new Set(
                                memberAssignments(m).map((a) =>
                                  nameOfSession(a.session_id),
                                ),
                              ),
                            ].join("、")}
                          </td>
                          <td>
                            {memberAssignments(m)
                              .map(
                                (a) =>
                                  `${nameOfSession(a.session_id)} / ${nameOfPosition({ ...m, ...a })}`,
                              )
                              .join("；")}
                          </td>
                          <td>
                            {m.source === "questionnaire"
                              ? "问卷报名"
                              : m.source === "manual"
                                ? "管理员录入"
                                : m.source}
                          </td>
                          <td className="member-notes">{m.notes || "—"}</td>
                          <td>
                            {can("members.write") ? (
                              <button onClick={() => setMember(m)}>修改</button>
                            ) : (
                              "只读"
                            )}
                          </td>
                        </tr>
                      ))}
                      {!members.length && (
                        <tr>
                          <td colSpan={8} className="recruit-empty">
                            还没有成员。可由管理员录入，或分享报名问卷收集名单。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {can("members.write") && (
                  <>
                    <div id="member-registration">{memberForm}</div>
                    <h3>批量导入</h3>
                    <p>
                      先选择上方场次和岗位，粘贴制表符分隔的姓名、编号、部门、电话、备注。名单会应用到已选的全部场次和岗位。
                    </p>
                    <textarea
                      aria-label="批量成员"
                      value={paste}
                      onChange={(e) => setPaste(e.target.value)}
                      placeholder="张三&#9;00123&#9;学院&#9;138…"
                    />
                    <button
                      className="button secondary"
                      disabled={
                        busy ||
                        !member.session_id ||
                        !member.position_id ||
                        !paste.trim()
                      }
                      onClick={() => {
                        const rows = paste
                          .trim()
                          .split(/\r?\n/)
                          .map((line) => {
                            const [
                              name,
                              number,
                              department = "",
                              phone = "",
                              notes = "",
                            ] = line.split("\t");
                            return {
                              ...emptyMember,
                              name,
                              number,
                              department,
                              phone,
                              notes,
                              assignments: memberAssignments(member),
                              session_id: member.session_id,
                              position_id: member.position_id,
                            };
                          });
                        void mutate(
                          "/members",
                          { members: rows, reason: "批量导入" },
                          "PUT",
                        );
                      }}
                    >
                      校验并导入
                    </button>
                    <h3>核实身份与凭证</h3>
                    <form
                      className="workflow-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (busy) return;
                        setBusy(true);
                        request<{ credential: string }>(
                          `${base}/members/access`,
                          access,
                          "POST",
                          data.version,
                        )
                          .then((result) => {
                            setNotice(
                              result.credential
                                ? `请交给本人保存修改入口：${location.origin}/signup?project=${id}#credential=${encodeURIComponent(result.credential)}`
                                : "身份绑定或凭证撤销已完成",
                            );
                            void load();
                          })
                          .catch(handle)
                          .finally(() => setBusy(false));
                      }}
                    >
                      <label>
                        成员
                        <select
                          required
                          value={access.member_id}
                          onChange={(e) =>
                            setAccess({ ...access, member_id: e.target.value })
                          }
                        >
                          <option value="">请选择</option>
                          {members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {m.number}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        核实后的系统账号（留空则签发凭证）
                        <input
                          value={access.username}
                          onChange={(e) =>
                            setAccess({ ...access, username: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        核实依据
                        <input
                          required
                          value={access.reason}
                          onChange={(e) =>
                            setAccess({ ...access, reason: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={access.revoke}
                          onChange={(e) =>
                            setAccess({ ...access, revoke: e.target.checked })
                          }
                        />
                        撤销现有凭证
                      </label>
                      <button className="button secondary" disabled={busy}>
                        确认身份操作
                      </button>
                    </form>
                  </>
                )}
              </section>
            )}
            {tab === "attendance" && (
              <section className="panel workflow-panel">
                <h2>现场出勤</h2>
                <p>
                  签到、签退只记录出勤事实，不自动生成时长。关闭窗口后的补签或修正由数据管理员处理。
                </p>
                {can("attendance.manage") && (
                  <form
                    className="workflow-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate("/windows", window, "PUT");
                    }}
                  >
                    <div className="workflow-grid">
                      <label>
                        场次
                        <select
                          required
                          value={window.session_id}
                          onChange={(e) =>
                            setWindow({ ...window, session_id: e.target.value })
                          }
                        >
                          <option value="">请选择</option>
                          {sessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        窗口
                        <select
                          value={window.action}
                          onChange={(e) =>
                            setWindow({ ...window, action: e.target.value })
                          }
                        >
                          <option value="checkin">签到</option>
                          <option value="checkout">签退</option>
                        </select>
                      </label>
                      <label>
                        开放方式
                        <select
                          value={window.mode}
                          onChange={(e) =>
                            setWindow({ ...window, mode: e.target.value })
                          }
                        >
                          <option value="manual">手动开关</option>
                          <option value="scheduled">按时间自动开放</option>
                        </select>
                      </label>
                      {window.mode === "manual" ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={window.open}
                            onChange={(e) =>
                              setWindow({ ...window, open: e.target.checked })
                            }
                          />
                          开放窗口
                        </label>
                      ) : (
                        <>
                          <label>
                            开放时间
                            <input
                              required
                              type="datetime-local"
                              value={localTime(window.start)}
                              onChange={(e) =>
                                setWindow({
                                  ...window,
                                  start: iso(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            关闭时间
                            <input
                              required
                              type="datetime-local"
                              value={localTime(window.end)}
                              onChange={(e) =>
                                setWindow({
                                  ...window,
                                  end: iso(e.target.value),
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                    </div>
                    <button className="button primary" disabled={busy}>
                      保存窗口并更新二维码
                    </button>
                  </form>
                )}
                {data.state.windows.map((w) => (
                  <div
                    className="workflow-session"
                    key={w.session_id + w.action}
                  >
                    <strong>
                      {nameOfSession(w.session_id)} ·{" "}
                      {attendanceNames[w.action]}
                    </strong>
                    <p>
                      {w.mode === "manual"
                        ? w.open
                          ? "手动开放"
                          : "手动关闭"
                        : `${new Date(w.start).toLocaleString()} 至 ${new Date(w.end).toLocaleString()}`}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setQR(
                          `/api/v1${base}/sessions/${w.session_id}/qr/${w.action}`,
                        )
                      }
                    >
                      显示二维码
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setWindow({ ...w, token: undefined })}
                    >
                      修改窗口
                    </button>
                  </div>
                ))}
                {qr && (
                  <img
                    className="workflow-qr"
                    src={qr}
                    alt="场次签到签退二维码"
                  />
                )}
                <label>
                  现场说明 / 更正依据
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <div className="workflow-table">
                  <table>
                    <thead>
                      <tr>
                        <th>姓名</th>
                        <th>场次</th>
                        <th>最近出勤</th>
                        <th>现场操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members
                        .flatMap((m) =>
                          [
                            ...new Set(
                              memberAssignments(m).map((a) => a.session_id),
                            ),
                          ].map((session_id) => ({ ...m, session_id })),
                        )
                        .map((m) => (
                          <tr key={`${m.id}-${m.session_id}`}>
                            <td>{m.name}</td>
                            <td>{nameOfSession(m.session_id)}</td>
                            <td>
                              {attendanceNames[
                                rowAttendance(m.id, m.session_id)?.action || ""
                              ] || "待签到"}
                            </td>
                            <td>
                              {can("attendance.manage") &&
                                ["checkin", "checkout", "absent"].map(
                                  (action) => (
                                    <button
                                      disabled={busy}
                                      key={action}
                                      onClick={() =>
                                        void mutate(
                                          `/sessions/${m.session_id}/attendance`,
                                          {
                                            member_id: m.id,
                                            action,
                                            reason,
                                            correction:
                                              can("hours.write") && !!reason,
                                          },
                                        )
                                      }
                                    >
                                      {attendanceNames[action]}
                                    </button>
                                  ),
                                )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === "forms" && can("forms.write") && (
              <section className="panel workflow-panel">
                <h2>问卷与二维码</h2>
                <p className="workflow-note">
                  招募问卷固定收集姓名、学号、电话、参加场次和岗位（可多选）、其他备注。保存开放后即可复制链接或下载二维码分发。
                </p>
                <form
                  className="workflow-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate("/forms", form, "PUT");
                  }}
                >
                  <label>
                    问卷用途
                    <select
                      value={form.kind}
                      onChange={(e) => {
                        const kind = e.target.value;
                        const f =
                          kind === "intent"
                            ? data.state.intent_form
                            : data.state.form;
                        setForm({
                          kind,
                          published: f.published,
                          title: f.title,
                          description: f.description,
                          deadline: f.deadline,
                          rotate: false,
                        });
                      }}
                    >
                      <option value="recruit">招募登记</option>
                      <option value="intent">时长录入意向</option>
                    </select>
                  </label>
                  <label>
                    标题
                    <input
                      required
                      value={form.title}
                      onChange={(e) =>
                        setForm({ ...form, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    填写说明
                    <textarea
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    截止时间
                    <input
                      type="datetime-local"
                      value={localTime(form.deadline)}
                      onChange={(e) =>
                        setForm({ ...form, deadline: iso(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.published}
                      onChange={(e) =>
                        setForm({ ...form, published: e.target.checked })
                      }
                    />
                    开放填写
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.rotate}
                      onChange={(e) =>
                        setForm({ ...form, rotate: e.target.checked })
                      }
                    />
                    撤销旧链接并生成新标识
                  </label>
                  <button className="button primary" disabled={busy}>
                    保存问卷
                  </button>
                </form>
                {[data.state.form, data.state.intent_form].map(
                  (f, i) =>
                    f.id && (
                      <article className="workflow-session" key={f.id}>
                        <strong>
                          {i ? "意向表" : "招募表"} ·{" "}
                          {f.published ? "已开放" : "已关闭"}
                        </strong>
                        <p>当前标题：{f.title || "未设置"}</p>
                        {f.description && <p>当前说明：{f.description}</p>}
                        {f.deadline && (
                          <p>
                            截止时间：
                            {new Date(f.deadline).toLocaleString("zh-CN")}
                          </p>
                        )}
                        <p>
                          <a
                            href={`/signup?project=${id}&form=${f.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {location.origin}/signup?project={id}&form={f.id}
                          </a>
                        </p>
                        <a
                          href={`/api/v1${base}/forms/qr?kind=${i ? "intent" : "recruit"}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          下载 / 查看问卷二维码
                        </a>
                      </article>
                    ),
                )}
              </section>
            )}
            {tab === "hours" && (
              <section className="panel workflow-panel">
                <h2>计时与时长</h2>
                {!can("hours.write") ? (
                  <>
                    <p>时长登记、补录和修正由数据管理员负责。</p>
                    {data.state.review.published ? (
                      <table>
                        <thead>
                          <tr>
                            <th>成员</th>
                            <th>已公布认定小时</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m) => (
                            <tr key={m.id}>
                              <td>{m.name}</td>
                              <td>
                                {data.state.hours?.find(
                                  (h) => h.member_id === m.id,
                                )?.recognized ?? "未认定"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p>认定结果尚未公布。</p>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      输入非负整数小时；空值表示未登记，0
                      表示明确计零。勾选后可批量填充。
                    </p>
                    <label>
                      记录类型
                      <select
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        {["登记", "补录", "更正"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      补录或更正依据
                      <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="activity-actions">
                      <input
                        aria-label="批量小时数"
                        type="number"
                        min={0}
                        step={1}
                        id="batch-hours"
                      />
                      <button
                        className="button secondary"
                        onClick={() => {
                          const input = document.getElementById(
                            "batch-hours",
                          ) as HTMLInputElement;
                          if (
                            input.value !== "" &&
                            Number.isInteger(Number(input.value)) &&
                            Number(input.value) >= 0
                          )
                            setHourValues((v) => ({
                              ...v,
                              ...Object.fromEntries(
                                selected.map((id) => [id, input.value]),
                              ),
                            }));
                        }}
                      >
                        填入选中人员
                      </button>
                    </div>
                    <div className="workflow-table">
                      <table>
                        <thead>
                          <tr>
                            <th>选择</th>
                            <th>姓名</th>
                            <th>场次</th>
                            <th>意向</th>
                            <th>登记小时</th>
                            <th>认定小时</th>
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m) => {
                            const h = data.state.hours?.find(
                              (h) => h.member_id === m.id,
                            );
                            return (
                              <tr key={m.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`选择${m.name}`}
                                    checked={selected.includes(m.id)}
                                    onChange={(e) =>
                                      setSelected((v) =>
                                        e.target.checked
                                          ? [...v, m.id]
                                          : v.filter((id) => id !== m.id),
                                      )
                                    }
                                  />
                                </td>
                                <td>{m.name}</td>
                                <td>{nameOfSession(m.session_id)}</td>
                                <td>{m.intent}</td>
                                <td>
                                  <input
                                    aria-label={`${m.name}登记小时`}
                                    type="number"
                                    step={1}
                                    min={0}
                                    value={hourValues[m.id] ?? h?.hours ?? ""}
                                    onChange={(e) =>
                                      setHourValues((v) => ({
                                        ...v,
                                        [m.id]: e.target.value,
                                      }))
                                    }
                                  />
                                </td>
                                <td>{h?.recognized ?? "未认定"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button
                      className="button primary"
                      disabled={busy || !Object.keys(hourValues).length}
                      onClick={() => {
                        const rows = Object.entries(hourValues)
                          .filter(([, v]) => v !== "")
                          .map(([member_id, v]) => ({
                            member_id,
                            hours: Number(v),
                            recognized: null,
                            source,
                            reason,
                          }));
                        void mutate("/hours", { rows }, "PUT").then((ok) => {
                          if (ok) setHourValues({});
                        });
                      }}
                    >
                      保存时长 / 批量补录
                    </button>
                    <h3>从表格导入时长</h3>
                    <p>
                      每行“人员编号 + 制表符 +
                      整数小时”，填写上方补录或更正依据后保存。
                    </p>
                    <textarea
                      aria-label="时长导入"
                      value={paste}
                      onChange={(e) => setPaste(e.target.value)}
                    />
                    <button
                      disabled={busy || !paste.trim()}
                      className="button secondary"
                      onClick={() => {
                        const lines = paste.trim().split(/\r?\n/);
                        const rows = lines.map((line) => {
                          const [number, hours] = line.split("\t");
                          return {
                            member_id:
                              members.find((m) => m.number === number)?.id ||
                              "",
                            hours: hours?.trim() ? Number(hours) : null,
                            recognized: null,
                            source,
                            reason,
                          };
                        });
                        void mutate("/hours", { rows }, "PUT");
                      }}
                    >
                      校验并导入时长
                    </button>
                  </>
                )}
              </section>
            )}
            {tab === "materials" && material && (
              <section className="panel workflow-panel">
                <h2>附件1</h2>
                {can("materials.write") ? (
                  <form
                    className="workflow-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate("/material", material, "PUT");
                    }}
                  >
                    <div className="workflow-grid">
                      {Object.entries(materialLabels).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type={
                              key.includes("password")
                                ? "password"
                                : key.includes("registration_")
                                  ? "date"
                                  : "text"
                            }
                            maxLength={key === "description" ? 500 : 2000}
                            value={String(
                              material[key as keyof Material] ?? "",
                            )}
                            onChange={(e) =>
                              setMaterial({
                                ...material,
                                [key]: e.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        预计每日最长小时
                        <input
                          min={0}
                          step={1}
                          type="number"
                          value={material.max_daily_hours ?? ""}
                          onChange={(e) =>
                            setMaterial({
                              ...material,
                              max_daily_hours:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        志愿者保障（用顿号分隔）
                        <input
                          value={material.guarantees.join("、")}
                          onChange={(e) =>
                            setMaterial({
                              ...material,
                              guarantees: e.target.value
                                .split("、")
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    </div>
                    <button className="button primary" disabled={busy}>
                      保存材料草稿
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void mutate("/material/generate", {})}
                    >
                      校验并生成正式 DOCX
                    </button>
                  </form>
                ) : (
                  <p>附件1由数据管理员编辑生成，可在下方下载已生成的版本。</p>
                )}
                <h3>材料历史版本</h3>
                {history.materials.length ? (
                  history.materials.map((file) => (
                    <p key={file.id}>
                      <a href={`/api/v1${base}/material/${file.id}`}>
                        {file.filename} · 版本 {file.version}
                      </a>{" "}
                      · {new Date(file.created_at).toLocaleString()}
                    </p>
                  ))
                ) : (
                  <p>暂无已生成的正式附件1。</p>
                )}
              </section>
            )}
            {tab === "review" && (
              <section className="panel workflow-panel">
                <h2>录入与审核</h2>
                <p>当前阶段：{data.project.status}</p>
                <p>审核意见：{data.state.review.opinion || "暂无"}</p>
                {data.state.review.published && (
                  <p>
                    已公布认定结果 ·{" "}
                    {data.state.review.approved_at &&
                      new Date(data.state.review.approved_at).toLocaleString()}
                  </p>
                )}
                {can("workflow.write") ? (
                  <form
                    className="workflow-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void mutate("/transition", {
                        status: stage,
                        reason,
                        external_result: external,
                      });
                    }}
                  >
                    <label>
                      目标阶段
                      <select
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      >
                        {[
                          "筹备",
                          "招募",
                          "进行",
                          "结项",
                          "意向",
                          "统计",
                          "数据",
                          "录入",
                          "审核",
                          "通过",
                          "驳回",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      处理依据 / 审核意见
                      <textarea
                        required
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <label>
                      外部录入结果与凭据说明
                      <textarea
                        value={external}
                        onChange={(e) => setExternal(e.target.value)}
                      />
                    </label>
                    <p>
                      按标准顺序流转；审核可退回统计、数据或录入，已通过或驳回项目可更正重开到统计或数据。
                    </p>
                    <button className="button primary" disabled={busy}>
                      确认流程处理
                    </button>
                  </form>
                ) : (
                  <p>后续统计、录入、时长认定及最终审核由数据管理员处理。</p>
                )}
              </section>
            )}
            {tab === "history" && (
              <section className="panel workflow-panel">
                <h2>操作记录</h2>
                {history.events.map((event) => (
                  <article key={event.id} className="workflow-session">
                    <strong>
                      {event.action} · 版本 {event.version}
                    </strong>
                    <p>
                      {event.actor} ·{" "}
                      {new Date(event.created_at).toLocaleString()} ·{" "}
                      {event.reason}
                    </p>
                  </article>
                ))}
              </section>
            )}
          </>
        )}
        {!data && !error && <p>正在读取服务器数据…</p>}
        <button
          className="button secondary"
          onClick={() => onNavigate("/projects")}
        >
          返回项目台账
        </button>
      </main>
    </WorkspaceShell>
  );
}
