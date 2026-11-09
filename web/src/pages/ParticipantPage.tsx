import { useEffect, useState } from "react";
import { Brand } from "../components/WorkspaceShell.tsx";
import { request, attendanceNames } from "../lib/workflow.ts";
import type {
  Member,
  ServiceSession,
  PublishedForm,
  Attendance,
  Hour,
} from "../lib/workflow.ts";

export default function ParticipantPage() {
  const params = new URLSearchParams(location.search),
    project = params.get("project") || "",
    formID = params.get("form"),
    sessionID = params.get("attendance"),
    token = params.get("token") || "";
  const base = `/public/projects/${encodeURIComponent(project)}`;
  const [form, setForm] = useState<{
    project: string;
    form: PublishedForm;
    kind: string;
    sessions: ServiceSession[];
  } | null>(null);
  const [own, setOwn] = useState<{
    member: Member;
    sessions: ServiceSession[];
    attendance: Attendance[];
    hours: Hour[];
    project: string;
  } | null>(null);
  const [scan, setScan] = useState<{
    project: string;
    session_id: string;
    action: string;
    member: Member | null;
  } | null>(null);
  const [member, setMember] = useState({
    name: "",
    number: "",
    department: "",
    phone: "",
    session_id: "",
    position_id: "",
  });
  const [credential, setCredential] = useState(""),
    [savedCredential, setSavedCredential] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState("申请录入"),
    [platform, setPlatform] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const refresh = async () => {
    if (formID) setForm(await request(`${base}/forms/${formID}`));
    if (sessionID)
      setScan(
        await request(
          `${base}/sessions/${sessionID}/scan?token=${encodeURIComponent(token)}`,
        ),
      );
    try {
      const me = await request<NonNullable<typeof own>>(`${base}/me`);
      setOwn(me);
      setMember(me.member);
      setIntent(me.member.intent === "未填写" ? "申请录入" : me.member.intent);
      setPlatform(me.member.platform);
    } catch {
      /* Anonymous visitors may read the form, never another response. */
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      const grant = hash.get("credential");
      if (grant) {
        history.replaceState(null, "", location.pathname + location.search);
        await request(`${base}/access`, { credential: grant });
        if (active) setNotice("本人访问凭证已验证。");
      }
      await refresh();
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [project, formID, sessionID]);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const login = () => {
    sessionStorage.setItem(
      "participant_return",
      location.pathname + location.search,
    );
    location.href = `/api/v1/auth/sso/start?return_to=${encodeURIComponent(location.pathname + location.search)}`;
  };
  const change = (field: string, value: string) =>
    setMember((m) => ({
      ...m,
      [field]: value,
      ...(field === "session_id" ? { position_id: "" } : {}),
    }));
  const returnURL =
    location.origin +
    `/signup?project=${encodeURIComponent(project)}#credential=${encodeURIComponent(savedCredential)}`;
  return (
    <main className="public-page workflow-participant">
      <div className="public-brand">
        <Brand />
        <span className="activity-badge">
          {sessionID
            ? "现场出勤"
            : form?.kind === "intent"
              ? "时长意向"
              : "项目登记"}
        </span>
      </div>
      <header className="public-header">
        <h1>
          {scan?.project || form?.project || own?.project || "志愿服务登记"}
        </h1>
        <p>
          {scan
            ? `${attendanceNames[scan.action]} · 请确认本人报名记录`
            : form?.form.description ||
              "使用学校账号或专属报名凭证访问本人记录。"}
        </p>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <section className="public-form workflow-panel">
        {!own && (
          <>
            <button className="button primary" onClick={login}>
              学校 SSO 登录并验证本人报名
            </button>
            <p>
              本校成员登录后自动匹配系统中已关联的报名记录。未关联的登记需验证原报名凭证或由数据管理员核实。
            </p>
            <form
              className="workflow-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await request(`${base}/access`, { credential });
                  setCredential("");
                  await refresh();
                  setNotice("本人访问凭证已验证。");
                });
              }}
            >
              <label>
                报名专属凭证
                <input
                  type="password"
                  autoComplete="off"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !credential}
                className="button secondary"
              >
                验证报名凭证
              </button>
            </form>
          </>
        )}
        {own && (
          <article className="workflow-session">
            <h2>本人报名记录</h2>
            <p>
              {own.member.name} · {own.member.number} ·{" "}
              {own.sessions.find((s) => s.id === own.member.session_id)?.name}
            </p>
            <button
              disabled={busy}
              className="button secondary"
              onClick={() =>
                void run(async () => {
                  await request(`${base}/me/bind`, {});
                  setNotice("已验证学校身份并关联本人报名。");
                })
              }
            >
              核对并关联当前学校身份
            </button>
          </article>
        )}
        {scan && (
          <article className="workflow-session">
            <h2>现场{attendanceNames[scan.action]}</h2>
            <p>
              {own
                ? `确认 ${own.member.name} 的本场次${attendanceNames[scan.action]}`
                : "请先使用学校身份登录，或验证本人报名凭证。"}
            </p>
            <button
              className="button primary"
              disabled={busy || !own}
              onClick={() =>
                void run(async () => {
                  const fact = await request<Attendance>(
                    `${base}/sessions/${sessionID}/scan`,
                    { token },
                  );
                  await refresh();
                  setNotice(
                    `${attendanceNames[fact.action]}成功 · ${new Date(fact.at).toLocaleString("zh-CN")}`,
                  );
                })
              }
            >
              确认{attendanceNames[scan.action]}
            </button>
            <p>重复扫码不会重复登记，也不会自动产生服务时长。</p>
          </article>
        )}
        {form?.kind === "recruit" && (
          <form
            className="workflow-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (own) {
                  await request(
                    `${base}/me`,
                    {
                      name: member.name,
                      department: member.department,
                      phone: member.phone,
                      intent: "",
                      platform: "",
                    },
                    "PUT",
                  );
                  setNotice("本人信息已更新。");
                } else {
                  const result = await request<{
                    member: Member;
                    credential: string;
                  }>(`${base}/forms/${formID}/responses`, { member, key });
                  setSavedCredential(result.credential);
                  setNotice("报名成功，请保存下方本人修改入口。");
                }
                await refresh();
              });
            }}
          >
            <h2>{own ? "修改本人信息" : "志愿者报名"}</h2>
            {["name", "number", "department", "phone"].map((field) => (
              <label key={field}>
                {
                  (
                    {
                      name: "姓名",
                      number: "学号 / 人员编号",
                      department: "部门",
                      phone: "联系电话",
                    } as Record<string, string>
                  )[field]
                }
                <input
                  required={field === "name" || field === "number"}
                  disabled={!!own && field === "number"}
                  value={member[field as keyof typeof member]}
                  onChange={(e) => change(field, e.target.value)}
                />
              </label>
            ))}
            <label>
              场次
              <select
                required
                disabled={!!own}
                value={member.session_id}
                onChange={(e) => change("session_id", e.target.value)}
              >
                <option value="">请选择</option>
                {form.sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              岗位
              <select
                required
                disabled={!!own}
                value={member.position_id}
                onChange={(e) => change("position_id", e.target.value)}
              >
                <option value="">请选择</option>
                {form.sessions
                  .find((s) => s.id === member.session_id)
                  ?.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>报名不会自动产生时长。学校身份与报名凭证仅用于本人记录验证。</p>
            <button disabled={busy} className="button primary">
              {own ? "保存本人修改" : "提交报名"}
            </button>
          </form>
        )}
        {savedCredential && (
          <div className="workflow-session">
            <h2>保存本人修改入口</h2>
            <p>凭此入口可访问并修改本人登记，请自行保存。</p>
            <textarea readOnly aria-label="本人修改入口" value={returnURL} />
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(returnURL)
                  .then(() => setNotice("本人修改入口已复制。"))
              }
            >
              复制本人修改入口
            </button>
          </div>
        )}
        {form?.kind === "intent" && (
          <form
            className="workflow-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await request(
                  `${base}/me`,
                  { name: "", department: "", phone: "", intent, platform },
                  "PUT",
                );
                await refresh();
                setNotice("时长录入意向已保存。");
              });
            }}
          >
            <h2>时长录入意向</h2>
            <label>
              是否申请录入
              <select
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              >
                {["申请录入", "不申请", "待核实"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              拟录入平台
              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || !own}>
              确认本人信息并保存意向
            </button>
          </form>
        )}
        {own && (
          <>
            <h2>本人出勤与已公布时长</h2>
            {own.attendance.map((a) => (
              <p key={a.id}>
                {attendanceNames[a.action]} · {new Date(a.at).toLocaleString()}
              </p>
            ))}
            {own.hours.map((h) => (
              <p key={h.member_id}>认定时长：{h.recognized ?? "未认定"} 小时</p>
            ))}
          </>
        )}
      </section>
    </main>
  );
}
