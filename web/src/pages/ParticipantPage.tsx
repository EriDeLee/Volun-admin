import ValidatedForm from "../components/ValidatedForm.tsx";
import { VolunteerGuarantees } from "../components/VolunteerGuarantees.tsx";
import { useEffect, useRef, useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import {
  request,
  attendanceNames,
  memberAssignments,
} from "../lib/workflow.ts";
import AssignmentPicker from "../components/AssignmentPicker.tsx";
import PhoneBinding from "../components/PhoneBinding.tsx";
import { profileComplete } from "../lib/profile.ts";
import type { AuthSession } from "../types.ts";
import type {
  Member,
  ServiceSession,
  PublishedForm,
  Attendance,
  Hour,
  Assignment,
} from "../lib/workflow.ts";

export default function ParticipantPage({
  onNavigate = (path) => location.assign(path),
  onSessionChange,
}: {
  onNavigate?: (path: string) => void;
  onSessionChange?: (session: AuthSession | null) => void;
} = {}) {
  const lifetime = useRef({ active: false });
  const [loading, setLoading] = useState(true);
  const params = new URLSearchParams(location.search),
    project = params.get("project") || "",
    formID = params.get("form"),
    sessionID = params.get("attendance"),
    token = params.get("token") || "";
  const base = `/public/projects/${encodeURIComponent(project)}`;
  const [identity, setIdentity] = useState<AuthSession | null>(null);
  const updateIdentity = (session: AuthSession | null) => {
    if (!lifetime.current.active) return;
    setIdentity(session);
    onSessionChange?.(session);
  };
  const [entry, setEntry] = useState<"choose" | "password" | "manual">(
    "choose",
  );
  const [account, setAccount] = useState({ username: "", password: "" });
  const [form, setForm] = useState<{
    project: string;
    form: PublishedForm;
    guarantees?: string[];
    other_guarantee?: string;
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
  const [intent, setIntent] = useState(""),
    [platform, setPlatform] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const continueSetup = () => {
    if (!lifetime.current.active) return;
    sessionStorage.setItem(
      "participant_return",
      location.pathname + location.search,
    );
    location.href = "/set-password";
  };
  const refresh = async (current = lifetime.current) => {
    if (!current.active) return;
    // Restore navigation identity even when the linked form is closed or unavailable.
    try {
      const authenticated = await request<AuthSession>("/auth/me");
      if (!current.active) return;
      if (authenticated.password_setup_required) {
        continueSetup();
        return;
      }
      updateIdentity(authenticated);
      setMember((previous) => ({
        ...previous,
        name: authenticated.user.name || "",
        number: authenticated.user.id || "",
        phone: authenticated.user.phone || previous.phone,
      }));
    } catch (cause) {
      if (!current.active) return;
      if ((cause as { status?: number }).status !== 401) throw cause;
      updateIdentity(null);
    }
    if (formID) {
      const published = await request<NonNullable<typeof form>>(
        `${base}/forms/${formID}`,
      );
      if (!current.active) return;
      setForm(published);
    }
    if (sessionID) {
      const scanned = await request<NonNullable<typeof scan>>(
        `${base}/sessions/${sessionID}/scan?token=${encodeURIComponent(token)}`,
      );
      if (!current.active) return;
      setScan(scanned);
    }
    try {
      const me = await request<NonNullable<typeof own>>(`${base}/me`);
      if (!current.active) return;
      setOwn(me);
      setMember({ ...me.member, notes: me.member.notes || "" });
      setAssignments(memberAssignments(me.member));
      setIntent(me.member.intent === "未填写" ? "" : me.member.intent);
      setPlatform(me.member.platform);
    } catch (cause) {
      if (!current.active) return;
      const status = (cause as { status?: number }).status;
      if (status !== 401 && status !== 403 && status !== 404) throw cause;
      setOwn(null);
    }
  };
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    setLoading(true);
    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      const grant = hash.get("credential");
      if (grant) {
        history.replaceState(null, "", location.pathname + location.search);
        await request(`${base}/access`, { credential: grant });
        if (!current.active) return;
      }
      if (params.has("sso")) {
        setError("学校统一认证未完成，可重试，或使用账号密码登录、手动填写。");
      }
      await refresh(current);
    })()
      .catch((e) => {
        if (current.active) setError(e.message);
      })
      .finally(() => {
        if (current.active) setLoading(false);
      });
    return () => {
      current.active = false;
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
  const refreshAfterSave = async () => {
    try {
      await refresh();
    } catch {
      setError("已保存，页面刷新失败，请刷新页面。");
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
  const credentialFromLink = (value: string) => {
    try {
      const link = new URL(value);
      if (
        link.origin !== location.origin ||
        link.pathname !== "/signup" ||
        link.searchParams.get("project") !== project
      )
        return "";
      return new URLSearchParams(link.hash.slice(1)).get("credential") || "";
    } catch {
      return "";
    }
  };
  const returnURL =
    location.origin +
    `/signup?project=${encodeURIComponent(project)}#credential=${encodeURIComponent(savedCredential)}`;
  return (
    <WorkspaceShell
      session={identity}
      route={own ? "/my-services" : "/recruitment"}
      crumb={
        sessionID
          ? "现场出勤"
          : form?.kind === "intent"
            ? "时长意向"
            : own
              ? "报名记录"
              : "项目登记"
      }
      space="个人空间"
      contentClassName="public-page workflow-participant"
      onNavigate={onNavigate}
      logoutPending={loggingOut}
      logout={() =>
        void run(async () => {
          setLoggingOut(true);
          try {
            await request("/auth/logout", {});
            updateIdentity(null);
            onNavigate("/login");
          } finally {
            setLoggingOut(false);
          }
        })
      }
    >
      <header className="public-header">
        <h1>
          {scan?.project || form?.project || own?.project || "志愿服务登记"}
        </h1>
        <p>
          {loading
            ? "正在加载…"
            : scan
              ? `${attendanceNames[scan.action]} · 请确认本人报名记录`
              : form?.form.description ||
                (form?.kind === "recruit"
                  ? "填写姓名、学号和电话，选择参加场次及岗位即可报名。"
                  : "")}
        </p>
      </header>
      {form && <VolunteerGuarantees value={form} />}
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
              <ValidatedForm
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
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
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
              </ValidatedForm>
            )}
          </article>
        )}
        {form?.kind === "recruit" && !own && identity && (
          <p className="success">
            已登录：{identity.user.name} · {identity.user.id}
            。姓名和学号已自动填入，无需人工核实身份。
          </p>
        )}
        {form?.kind === "recruit" &&
          !own &&
          identity &&
          !profileComplete(identity.user) && (
            <article className="workflow-session">
              <h2>完善报名资料</h2>
              <p>
                报名前需要姓名、学号和绑定手机号。姓名或学号缺失请联系管理员补全。
              </p>
              <a
                className="button secondary"
                href="/profile"
                onClick={() =>
                  sessionStorage.setItem(
                    "volunteer_return",
                    location.pathname + location.search,
                  )
                }
              >
                前往个人信息
              </a>
              <PhoneBinding
                onBound={(authenticated) => {
                  updateIdentity(authenticated);
                  setMember((previous) => ({
                    ...previous,
                    phone: authenticated.user.phone || "",
                  }));
                }}
              />
            </article>
          )}
        {!loading && !own && (!formID || form?.kind === "intent") && (
          <>
            <button className="button primary" onClick={login}>
              学校 SSO 登录并验证本人报名
            </button>
            <p>也可使用报名时保存的修改链接。</p>
            <ValidatedForm
              className="workflow-form"
              validateField={(field) =>
                field.name !== "registration-link" ||
                !!credentialFromLink(field.value)
              }
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  try {
                    await request(`${base}/access`, {
                      credential: credentialFromLink(credential),
                    });
                  } catch (cause) {
                    if ((cause as { status?: number }).status === 403)
                      throw new Error("报名修改链接已失效。");
                    throw cause;
                  }
                  setCredential("");
                  await refresh();
                  setNotice("已打开报名记录。");
                });
              }}
            >
              <label>
                报名修改链接
                <input
                  type="url"
                  name="registration-link"
                  required
                  autoComplete="off"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                />
              </label>
              <button disabled={busy} className="button secondary">
                打开报名记录
              </button>
            </ValidatedForm>
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
                  return `${session?.name || "场次已移除"} / ${session?.positions.find((p) => p.id === a.position_id)?.name || "岗位已移除"}`;
                })
                .join("、")}
            </p>
            {identity && !own.member.identity_verified && (
              <button
                disabled={busy}
                className="button secondary"
                onClick={() =>
                  void run(async () => {
                    await request(`${base}/me/bind`, {});
                    await refresh();
                    setNotice("报名已关联当前账号。");
                  })
                }
              >
                关联当前账号
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
                : "请先登录，或使用报名修改链接。"}
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
          (own ||
            (identity && profileComplete(identity.user)) ||
            (!identity && entry === "manual")) && (
            <ValidatedForm
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
                    setNotice("已保存。");
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
                    setNotice("报名成功。");
                  }
                  await refreshAfterSave();
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
                      (field === "phone" && !own && !!identity?.user.phone) ||
                      ((field === "name" || field === "number") &&
                        (!!own?.member.identity_verified ||
                          (!own && !!identity)))
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
              <button disabled={busy} className="button primary">
                {own ? "保存" : "提交报名"}
              </button>
            </ValidatedForm>
          )}
        {savedCredential && (
          <div className="workflow-session">
            <h2>报名修改链接</h2>
            <p>请本人保存，勿转发。</p>
            <textarea readOnly aria-label="报名修改链接" value={returnURL} />
            <button
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(returnURL)
                  .then(() => setNotice("已复制。"))
                  .catch(() => setError("复制失败，请手动复制链接。"))
              }
            >
              复制报名修改链接
            </button>
          </div>
        )}
        {form?.kind === "intent" && (
          <ValidatedForm
            className="workflow-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await request(
                  `${base}/me`,
                  { name: "", department: "", phone: "", intent, platform },
                  "PUT",
                );
                setNotice("已保存。");
                await refreshAfterSave();
              });
            }}
          >
            <h2>时长录入意向</h2>
            <label>
              是否申请录入时长
              <select
                required
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              >
                <option value="">请选择</option>
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
              保存
            </button>
          </ValidatedForm>
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
              <p key={h.member_id}>
                认定时长：
                {h.recognized == null ? "未认定" : `${h.recognized} 小时`}
              </p>
            ))}
          </>
        )}
      </section>
    </WorkspaceShell>
  );
}
