import { useEffect, useState } from "react";
import { Brand } from "../components/WorkspaceShell.tsx";
import {
  request,
  attendanceNames,
  memberAssignments,
} from "../lib/workflow.ts";
import AssignmentPicker from "../components/AssignmentPicker.tsx";
import ThemeSelect from "../components/ThemeSelect.tsx";
import type { AuthSession } from "../types.ts";
import type {
  Member,
  ServiceSession,
  PublishedForm,
  Attendance,
  Hour,
  Assignment,
} from "../lib/workflow.ts";

export default function ParticipantPage() {
  const [loading, setLoading] = useState(true);
  const params = new URLSearchParams(location.search),
    project = params.get("project") || "",
    formID = params.get("form"),
    sessionID = params.get("attendance"),
    token = params.get("token") || "";
  const base = `/public/projects/${encodeURIComponent(project)}`;
  const [identity, setIdentity] = useState<AuthSession | null>(null);
  const [entry, setEntry] = useState<"choose" | "password" | "manual">(
    "choose",
  );
  const [account, setAccount] = useState({ username: "", password: "" });
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
    notes: "",
  });
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [credential, setCredential] = useState(""),
    [savedCredential, setSavedCredential] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState("申请录入"),
    [platform, setPlatform] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const continueSetup = () => {
    sessionStorage.setItem(
      "participant_return",
      location.pathname + location.search,
    );
    location.href = "/set-password";
  };
  const refresh = async () => {
    if (formID) setForm(await request(`${base}/forms/${formID}`));
    try {
      const authenticated = await request<AuthSession>("/auth/me");
      if (authenticated.password_setup_required) {
        continueSetup();
        return;
      }
      setIdentity(authenticated);
      setMember((previous) => ({
        ...previous,
        name: authenticated.user.name || "",
        number: authenticated.user.id || "",
      }));
    } catch (cause) {
      if ((cause as { status?: number }).status !== 401) throw cause;
      setIdentity(null);
    }
    if (sessionID)
      setScan(
        await request(
          `${base}/sessions/${sessionID}/scan?token=${encodeURIComponent(token)}`,
        ),
      );
    try {
      const me = await request<NonNullable<typeof own>>(`${base}/me`);
      setOwn(me);
      setMember({ ...me.member, notes: me.member.notes || "" });
      setAssignments(memberAssignments(me.member));
      setIntent(me.member.intent === "未填写" ? "申请录入" : me.member.intent);
      setPlatform(me.member.platform);
    } catch {
      /* Anonymous visitors may read the form, never another response. */
    }
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      const grant = hash.get("credential");
      if (grant) {
        history.replaceState(null, "", location.pathname + location.search);
        await request(`${base}/access`, { credential: grant });
        if (active) setNotice("本人访问凭证已验证。");
      }
      if (params.has("sso")) {
        setError("学校统一认证未完成，可重试，或使用账号密码登录、手动填写。");
      }
      await refresh();
    })()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
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
        <ThemeSelect />
      </div>
      <header className="public-header">
        <h1>
          {scan?.project || form?.project || own?.project || "志愿服务登记"}
        </h1>
        <p>
          {loading
            ? "正在读取项目登记信息，请稍候。"
            : scan
              ? `${attendanceNames[scan.action]} · 请确认本人报名记录`
              : form?.form.description ||
                (form?.kind === "recruit"
                  ? "填写姓名、学号和电话，选择参加场次及岗位即可报名。"
                  : "使用学校账号或专属报名凭证访问本人记录。")}
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
      {loading && <p role="status">正在加载登记信息…</p>}
      <section
        className="public-form workflow-panel"
        hidden={loading || (!!formID && !form)}
      >
        {form?.kind === "recruit" && !own && !identity && (
          <article className="workflow-session">
            <h2>先确认报名身份</h2>
            <p>登录后自动填入姓名和学号，无需再次核实身份。</p>
            <div className="activity-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={login}
              >
                学校 SSO 登录
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setEntry("password")}
              >
                账号密码登录
              </button>
              <button
                className="activity-text-button"
                disabled={busy}
                onClick={() => setEntry("manual")}
              >
                手动填写
              </button>
            </div>
            {entry === "manual" && (
              <p>手动填写的身份信息将在报名后由管理员核实。</p>
            )}
            {entry === "password" && (
              <form
                className="workflow-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    let authenticated: AuthSession;
                    try {
                      authenticated = await request<AuthSession>(
                        "/auth/login",
                        account,
                      );
                    } finally {
                      setAccount((previous) => ({ ...previous, password: "" }));
                    }
                    if (authenticated.password_setup_required) {
                      continueSetup();
                      return;
                    }
                    await refresh();
                    setNotice("登录成功，已自动填入账号身份信息。");
                  });
                }}
              >
                <label>
                  平台账号
                  <input
                    required
                    autoComplete="username"
                    value={account.username}
                    onChange={(event) =>
                      setAccount({ ...account, username: event.target.value })
                    }
                  />
                </label>
                <label>
                  平台密码
                  <input
                    required
                    type="password"
                    autoComplete="current-password"
                    value={account.password}
                    onChange={(event) =>
                      setAccount({ ...account, password: event.target.value })
                    }
                  />
                </label>
                <button className="button primary" disabled={busy}>
                  登录并继续报名
                </button>
              </form>
            )}
          </article>
        )}
        {form?.kind === "recruit" && !own && identity && (
          <p className="success">
            已登录：{identity.user.name} · {identity.user.id}
            。姓名和学号已自动填入，无需人工核实身份。
          </p>
        )}
        {!loading && !own && (!formID || form?.kind === "intent") && (
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
              {memberAssignments(own.member)
                .map((a) => {
                  const session = own.sessions.find(
                    (s) => s.id === a.session_id,
                  );
                  return `${session?.name || a.session_id} / ${session?.positions.find((p) => p.id === a.position_id)?.name || a.position_id}`;
                })
                .join("、")}
            </p>
            {!own.member.identity_verified && (
              <button
                disabled={busy}
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    await request(`${base}/me/bind`, {});
                    await refresh();
                    setNotice("已验证学校身份并关联本人报名。");
                  })
                }
              >
                核对并关联当前学校身份
              </button>
            )}
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
        {form?.kind === "recruit" &&
          (own || identity || entry === "manual") && (
            <form
              className="workflow-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!assignments.length) {
                  setError("请至少选择一个参加场次和岗位。");
                  return;
                }
                void run(async () => {
                  if (own) {
                    await request(
                      `${base}/me`,
                      {
                        name: member.name,
                        department: member.department,
                        phone: member.phone,
                        notes: member.notes,
                        assignments,
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
                    }>(`${base}/forms/${formID}/responses`, {
                      member: {
                        ...member,
                        session_id: assignments[0].session_id,
                        position_id: assignments[0].position_id,
                        assignments,
                      },
                      key,
                    });
                    setSavedCredential(result.credential);
                    setNotice("报名成功，请保存下方本人修改入口。");
                  }
                  await refresh();
                });
              }}
            >
              <h2>{own ? "修改本人信息" : "志愿者报名"}</h2>
              {["name", "number", "phone"].map((field) => (
                <label key={field}>
                  {
                    (
                      {
                        name: "姓名",
                        number: "学号",
                        department: "部门",
                        phone: "联系电话",
                      } as Record<string, string>
                    )[field]
                  }
                  <input
                    required
                    type={field === "phone" ? "tel" : "text"}
                    maxLength={
                      field === "phone" ? 50 : field === "name" ? 80 : 120
                    }
                    readOnly={
                      (field === "name" || field === "number") &&
                      (!!own?.member.identity_verified || (!own && !!identity))
                    }
                    disabled={!!own && field === "number"}
                    value={member[field as keyof typeof member]}
                    onChange={(e) => change(field, e.target.value)}
                  />
                </label>
              ))}
              <AssignmentPicker
                sessions={form.sessions}
                value={assignments}
                onChange={setAssignments}
                disabled={
                  busy ||
                  (!!own && (own.attendance.length > 0 || own.hours.length > 0))
                }
              />
              <label>
                其他备注
                <textarea
                  maxLength={1000}
                  rows={3}
                  value={member.notes}
                  onChange={(e) => change("notes", e.target.value)}
                  placeholder="可填写参加安排或其他需要说明的情况（选填）"
                />
              </label>
              <p>
                报名不会自动产生时长。学校身份与报名凭证仅用于本人记录验证。
              </p>
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
