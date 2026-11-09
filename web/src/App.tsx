import Sidebar from "./components/Sidebar.tsx";
import type { AuthSession, ApiError } from "./types.ts";
import { asApiError } from "./lib/api.ts";
import React, { useEffect, useRef, useState } from "react";
import "./style.css";
import ActivityHome from "./ActivityHome.tsx";
import ProjectsPage from "./pages/ProjectsPage.tsx";
import ApprovalsPage from "./pages/ApprovalsPage.tsx";
import ProjectDetail from "./pages/WorkflowPage.tsx";
import ParticipantPage from "./pages/ParticipantPage.tsx";
import SignupPage from "./pages/SignupPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";
import { DraftProvider } from "./lib/drafts.tsx";
import { isManagerPath, canReadUsers } from "./lib/constants.ts";
import "./workspace.css";
import "./theme.css";
import ThemeSelect from "./components/ThemeSelect.tsx";
import Icon from "./components/Icon.tsx";
import { Brand } from "./components/WorkspaceShell.tsx";
import { api } from "./lib/api.ts";
import { useDraftStore } from "./lib/drafts.tsx";

const canManage = (data: AuthSession | null) =>
  data?.user?.groups?.some((g) =>
    ["super_admin", "activity_admin", "data_admin"].includes(g),
  );
const homePath = (data: AuthSession) =>
  canManage(data) ? "/activity" : "/profile";

const groupNames: Record<string, string> = {
  super_admin: "超管",
  data_admin: "数据管理员",
  activity_admin: "活动管理员",
  formal_user: "正式用户",
};
const ssoErrors: Record<string, string> = {
  unavailable: "学校统一认证暂未开放，请使用账号登录或联系管理员。",
  error: "暂时无法连接学校统一认证，请稍后重试。",
  failed: "学校统一认证未完成，请重新发起登录。",
};
export default function App() {
  return (
    <DraftProvider>
      <Application />
    </DraftProvider>
  );
}
function Application() {
  const { reset: resetDrafts } = useDraftStore();
  const [menu, setMenu] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null),
    [checking, setChecking] = useState(true),
    [startupError, setStartupError] = useState("");
  const [error, setError] = useState(
    () =>
      ssoErrors[new URLSearchParams(location.search).get("sso") || ""] || "",
  );
  const [form, setForm] = useState({ username: "", password: "" }),
    [visible, setVisible] = useState(false),
    [pending, setPending] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState(""),
    [updated, setUpdated] = useState<Date | null>(null);
  const busy = useRef(false);
  const [route, setRoute] = useState(() => location.pathname + location.search);
  const pathname = route.split("?")[0];
  const routeSearch = route.includes("?")
    ? route.slice(route.indexOf("?"))
    : "";
  useEffect(() => {
    const onPopState = () => {
      setRoute(location.pathname + location.search);
      setError("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const setPath = (path: string) => {
    if (location.pathname !== path || location.search)
      history.replaceState(null, "", path);
    setRoute(path);
  };
  const navigate = (path: string) => {
    history.pushState(null, "", path);
    setRoute(path);
    setError("");
    setNotice("");
  };
  const loadSession = async (initial = false) => {
    if (busy.current) return;
    busy.current = true;
    if (initial) {
      setChecking(true);
      setStartupError("");
    } else {
      setPending("refresh");
      setError("");
      setNotice("");
    }
    try {
      const data = await api("/auth/me");
      if (!data?.user) throw new Error("无法读取账号信息，请重试。");
      setSession(data);
      setUpdated(new Date());
      setPath(
        data.password_setup_required
          ? "/set-password"
          : location.pathname === "/profile"
            ? "/profile"
            : canManage(data) && isManagerPath(location.pathname)
              ? location.pathname + location.search
              : canReadUsers(data) && location.pathname === "/users"
                ? "/users"
                : homePath(data),
      );
      if (!initial) setNotice("个人信息已更新。");
    } catch (cause) {
      const e = asApiError(cause);
      if (e.status === 401) {
        setSession(null);
        resetDrafts();
        setPath("/login");
        if (!initial) setError("登录已失效，请重新登录。");
      } else if (initial) setStartupError(e.message);
      else setError(e.message);
    } finally {
      busy.current = false;
      setChecking(false);
      setPending("");
    }
  };
  useEffect(() => {
    if (location.pathname === "/signup") setChecking(false);
    else loadSession(true);
  }, []);
  const login = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending("login");
    setError("");
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
        }),
      });
      if (!data?.user) throw new Error("未能获取登录信息，请重试。");
      setSession(data);
      setUpdated(new Date());
      setForm({ username: "", password: "" });
      setVisible(false);
      setPath(data.password_setup_required ? "/set-password" : homePath(data));
    } catch (cause) {
      const e = asApiError(cause);
      setError(e.message);
      setForm((f) => ({ ...f, password: "" }));
    } finally {
      busy.current = false;
      setPending("");
    }
  };
  const logout = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending("logout");
    setError("");
    setNotice("");
    try {
      await api("/auth/logout", { method: "POST" });
      setSession(null);
      resetDrafts();
      setForm({ username: "", password: "" });
      setVisible(false);
      setUpdated(null);
      setNewPassword("");
      setConfirmPassword("");
      setPath("/login");
    } catch (cause) {
      const e = asApiError(cause);
      if (e.status === 401) {
        setSession(null);
        resetDrafts();
        setPath("/login");
      } else setError("退出未完成。" + e.message);
    } finally {
      busy.current = false;
      setPending("");
    }
  };
  const setInitialPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current) return;
    setError("");
    const length = new TextEncoder().encode(newPassword).length;
    if (length < 12 || length > 72) {
      setError("密码需为 12 至 72 个字节。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的密码不一致，请重新确认。");
      return;
    }
    busy.current = true;
    setPending("set-password");
    try {
      const data = await api("/auth/setup-password", {
        method: "POST",
        body: JSON.stringify({ password: newPassword }),
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (data.password_setup_required)
        throw new Error("密码尚未设置成功，请重试。");
      setSession(data);
      setUpdated(new Date());
      setNewPassword("");
      setConfirmPassword("");
      const participantReturn = sessionStorage.getItem("participant_return");
      if (participantReturn?.startsWith("/signup?")) {
        sessionStorage.removeItem("participant_return");
        setPath(participantReturn);
      } else setPath(homePath(data));
    } catch (cause) {
      const e = asApiError(cause);
      setError(
        e.status === 401
          ? "登录已失效，请重新使用学校统一认证。"
          : e.status === 409
            ? "密码已设置，请重新登录。"
            : e.status === 400
              ? "密码格式不符合要求，请检查后重试。"
              : e.message,
      );
    } finally {
      busy.current = false;
      setPending("");
    }
  };
  const onSessionIssue = (e: ApiError) => {
    if (e.status === 401) {
      setSession(null);
      resetDrafts();
      setPath("/login");
      setError("登录已失效，请重新登录。");
    } else loadSession(true);
  };
  const workspaceProps = {
    session,
    api,
    onNavigate: navigate,
    logout,
    logoutPending: pending === "logout",
    parentError: error,
    onSessionIssue,
  };
  if (pathname === "/signup") {
    const params = new URLSearchParams(routeSearch);
    if (
      params.get("project") &&
      (params.has("form") || params.has("attendance") || !params.has("preview"))
    )
      return <ParticipantPage />;
    return <SignupPage {...workspaceProps} search={routeSearch} />;
  }
  if (session?.password_setup_required)
    return (
      <main className="setup-page">
        <header className="setup-header">
          <Brand />
          <ThemeSelect />
          <span className="setup-verified">
            <Icon name="check" />
            学校身份已验证
          </span>
        </header>
        <section className="setup-card">
          <span className="setup-icon">
            <Icon name="shield" />
          </span>
          <p className="setup-eyebrow">首次登录 · 完成账号设置</p>
          <h1>请设置登录密码</h1>
          <p className="setup-intro">
            学校身份验证已完成。设置平台密码后，即可使用学校统一认证或账号密码登录。
          </p>
          <div className="setup-account">
            <span className="avatar">
              {(session.user.name || session.user.username || "用").slice(0, 1)}
            </span>
            <div>
              <strong>{session.user.name || "学校认证用户"}</strong>
              <small>
                平台登录账号：{session.user.username || "请联系管理员确认"}
              </small>
            </div>
          </div>
          <form onSubmit={setInitialPassword} className="setup-form">
            <label htmlFor="new-password">新密码</label>
            <div className="password-field">
              <input
                id="new-password"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={72}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 12 个字符"
                disabled={!!pending}
              />
              <button
                className="password-toggle"
                type="button"
                aria-label={visible ? "隐藏密码" : "显示密码"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                <Icon name="eye" />
              </button>
            </div>
            <label htmlFor="confirm-password">确认新密码</label>
            <input
              id="confirm-password"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              disabled={!!pending}
            />
            <p className="password-hint">
              <Icon name="info" />
              密码长度为 12 至 72
              字节（中文字符会占用多个字节）。请勿使用学校账号密码。
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary"
              type="submit"
              disabled={!!pending}
            >
              {pending === "set-password" ? "正在安全保存…" : "设置密码并继续"}
              <Icon name="arrow" />
            </button>
          </form>
          <button
            className="setup-logout"
            onClick={logout}
            disabled={!!pending}
          >
            <Icon name="logout" />
            退出并稍后设置
          </button>
        </section>
        <footer className="setup-footer">
          北京航空航天大学 · 志愿服务项目管理平台
        </footer>
      </main>
    );
  if (checking || startupError)
    return (
      <main className="loading-page">
        <Brand />
        <section className="loading-card">
          <Icon name={startupError ? "info" : "shield"} />
          <h1>{startupError ? "暂时无法确认登录状态" : "正在确认登录状态"}</h1>
          <p>{startupError || "正在安全连接到你的志愿服务工作空间…"}</p>
          {startupError && (
            <button
              className="button primary"
              onClick={() => loadSession(true)}
            >
              重新连接
            </button>
          )}
        </section>
      </main>
    );
  if (!session)
    return (
      <main className="login-page">
        <ThemeSelect standalone />
        <section className="login-story">
          <Brand />
          <div className="story-copy">
            <h1>
              把热心汇聚成行动，
              <br />
              让服务留下印记。
            </h1>
            <p>
              连接项目、志愿者与每一小时的付出。
              <br />
              为校园志愿服务提供清晰、有序的协作空间。
            </p>
            <div className="journey">
              <div className="journey-title">
                <Icon name="heart" />
                <strong>一项服务，从这里开始</strong>
              </div>
              <ol>
                {(
                  ["项目立项", "志愿招募", "时长记录", "审核归档"] as const
                ).map((s, i) => (
                  <li key={s}>
                    <span>{i < 2 ? <Icon name="check" /> : i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
              <p>统一台账 · 公开问卷 · 人工时长 · 规范材料</p>
            </div>
          </div>
          <footer>北京航空航天大学 · 志愿服务项目管理平台</footer>
        </section>
        <section className="login-side">
          <div className="login-form">
            <span className="school-label">
              <Icon name="shield" />
              校园志愿服务协作空间
            </span>
            <h2>欢迎回到志愿服务</h2>
            <p className="muted">登录后查看身份信息，开启志愿服务协作。</p>
            <div className="form-heading">账号登录</div>
            <form onSubmit={login}>
              <label htmlFor="username">账号</label>
              <input
                id="username"
                name="username"
                required
                autoComplete="username"
                placeholder="请输入账号"
                value={form.username}
                disabled={!!pending}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <label htmlFor="password">密码</label>
              <div className="password-field">
                <input
                  id="password"
                  name="password"
                  type={visible ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={form.password}
                  disabled={!!pending}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={visible ? "隐藏密码" : "显示密码"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name="eye" />
                </button>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary"
                disabled={!!pending}
                type="submit"
              >
                {pending === "login" ? "正在登录…" : "登录平台"}
                <Icon name="arrow" />
              </button>
            </form>
            <div className="divider">或使用学校账号</div>
            <a
              className={`button secondary ${pending ? "disabled" : ""}`}
              aria-disabled={!!pending}
              onClick={(e) => {
                if (pending) e.preventDefault();
              }}
              href="/api/v1/auth/sso/start?return_to=%2F"
            >
              <Icon name="shield" />
              学校统一认证
            </a>
            <div className="login-note">
              <Icon name="info" />
              <p>
                校内师生可使用学校统一认证。
                <br />
                账号及权限问题请联系平台管理员。
              </p>
            </div>
          </div>
          <footer>登录即进入平台授权范围内的工作空间</footer>
        </section>
      </main>
    );
  if (
    pathname !== "/profile" &&
    (canManage(session) || (pathname === "/users" && canReadUsers(session)))
  ) {
    const managerProps = { ...workspaceProps, session };
    if (pathname === "/users" && canReadUsers(session))
      return <UsersPage {...managerProps} />;
    if (pathname === "/projects") return <ProjectsPage {...managerProps} />;
    if (
      pathname === "/approvals" &&
      session.user.groups.some((g) => ["super_admin", "data_admin"].includes(g))
    )
      return <ApprovalsPage {...managerProps} />;
    const detailMatch = pathname.match(/^\/projects\/([^/]+)$/);
    if (detailMatch)
      return (
        <ProjectDetail
          key={detailMatch[1]}
          {...managerProps}
          id={detailMatch[1]}
          search={routeSearch}
        />
      );
    const selectedID = new URLSearchParams(routeSearch).get("project");
    if (pathname === "/hours" || pathname === "/materials")
      return selectedID ? (
        <ProjectDetail
          key={pathname + selectedID}
          {...managerProps}
          id={selectedID}
          initialTab={pathname === "/hours" ? "hours" : "materials"}
        />
      ) : (
        <ProjectsPage
          {...managerProps}
          section={pathname === "/hours" ? "hours" : "materials"}
        />
      );
    return (
      <ActivityHome
        {...managerProps}
        Icon={Icon}
        Brand={Brand}
        onOpenProject={(id) => navigate(`/projects/${encodeURIComponent(id)}`)}
      />
    );
  }
  const user = session.user,
    name = user.name || user.username || "平台用户",
    groups = Array.isArray(user.groups) ? user.groups : [];
  const authLabel =
    {
      password: "账号密码登录",
      sso: "学校统一认证",
      session: "已通过会话验证",
    }[session.auth_method || "session"] || "已通过会话验证";
  return (
    <div className="profile-shell activity-shell">
      <Sidebar
        session={session}
        route="/profile"
        onNavigate={navigate}
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
            <Icon name="menu" />
          </button>
          <span>
            个人空间 <b>/</b> <strong>个人信息</strong>
          </span>
          <ThemeSelect />
          <button
            className="button secondary"
            onClick={logout}
            disabled={!!pending}
          >
            <Icon name="logout" />
            {pending === "logout" ? "正在退出…" : "退出登录"}
          </button>
        </header>
        <main className="profile-content">
          <div className="page-heading">
            <div>
              <h1>个人信息</h1>
              {canManage(session) && (
                <a
                  className="activity-text-button"
                  href="/activity"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/activity");
                  }}
                >
                  返回活动工作台
                </a>
              )}
              <p>查看你的平台身份、用户组与登录状态。</p>
            </div>
            <button
              className="button secondary"
              onClick={() => loadSession()}
              disabled={!!pending}
            >
              <Icon name="refresh" />
              {pending === "refresh" ? "正在刷新…" : "刷新信息"}
            </button>
          </div>
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
          <section className="identity-banner">
            <span className="avatar large">{name.slice(0, 1)}</span>
            <div>
              <div className="identity-name">
                <h2>{name}</h2>
                <span className="badge">
                  <Icon name="check" />
                  已登录
                </span>
              </div>
              <p>{user.username || "学校统一认证用户"}</p>
              <div className="group-list">
                {groups.map((g) => (
                  <span key={g} className="badge white">
                    {groupNames[g] || g}
                  </span>
                ))}
              </div>
            </div>
            <Icon name="shield" className="identity-shield" />
          </section>
          <div className="profile-grid">
            <section className="panel">
              <div className="panel-heading">
                <Icon name="user" />
                <h2>基本资料</h2>
                <span>当前账号</span>
              </div>
              <dl className="details">
                <div>
                  <dt>姓名</dt>
                  <dd>{user.name || "未提供"}</dd>
                </div>
                <div>
                  <dt>登录账号</dt>
                  <dd>{user.username || "未提供"}</dd>
                </div>
                <div>
                  <dt>学号 / 人员编号</dt>
                  <dd>{user.id || "未提供"}</dd>
                </div>
              </dl>
              <p className="panel-note">
                <Icon name="info" />
                资料来自当前账号记录，如需更正请联系管理员。
              </p>
            </section>
            <div className="right-column">
              <section className="panel">
                <div className="panel-heading">
                  <Icon name="shield" />
                  <h2>账号与访问</h2>
                </div>
                <dl className="details compact">
                  <div>
                    <dt>登录状态</dt>
                    <dd>
                      <span className="status-dot" />
                      会话有效
                    </dd>
                  </div>
                  <div>
                    <dt>验证方式</dt>
                    <dd>{authLabel}</dd>
                  </div>
                  <div>
                    <dt>最近读取</dt>
                    <dd>
                      {updated?.toLocaleTimeString("zh-CN", {
                        hour12: false,
                      }) || "—"}
                    </dd>
                  </div>
                </dl>
                <p className="panel-note">
                  退出平台会撤销当前平台会话，不会退出学校其他系统。
                </p>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <Icon name="user" />
                  <h2>所属用户组</h2>
                </div>
                <div className="permission-body">
                  <div className="group-list">
                    {groups.length ? (
                      groups.map((g) => (
                        <span className="badge" key={g}>
                          {groupNames[g] || g}
                        </span>
                      ))
                    ) : (
                      <span className="muted">暂未分配用户组</span>
                    )}
                  </div>
                  <p>
                    用户组由平台管理员分配。项目的实际访问范围以具体授权为准。
                  </p>
                </div>
              </section>
            </div>
          </div>
          <footer className="page-footer">
            北京航空航天大学 · 志愿服务项目管理平台
          </footer>
        </main>
      </div>
    </div>
  );
}
