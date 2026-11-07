import React, { useEffect, useRef, useState } from "react";
import "./style.css";

const groupNames = {
  super_admin: "超管",
  data_admin: "数据管理员",
  activity_admin: "活动管理员",
  formal_user: "正式用户",
};
const ssoErrors = {
  unavailable: "学校统一认证暂未开放，请使用账号登录或联系管理员。",
  error: "暂时无法连接学校统一认证，请稍后重试。",
  failed: "学校统一认证未完成，请重新发起登录。",
};
function Icon({ name, ...props }) {
  const paths = {
    heart: (
      <>
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
        <path d="m7 11 3 3 7-7" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 10-8 10S4 17 4 12V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    logout: <path d="M9 4H4v16h5m5-13 5 5-5 5M8 12h12" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10h.01" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.user}
    </svg>
  );
}
function Brand() {
  return (
    <a className="brand" href="/" aria-label="志愿服务项目管理平台">
      <span className="logo">
        <Icon name="heart" />
      </span>
      <span>
        <strong>志愿服务</strong>
        <small>项目管理平台</small>
      </span>
    </a>
  );
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("网络连接失败，请检查网络后重试。");
  }
  const body = await response.json().catch(() => null);
  if (
    !response.ok ||
    !body ||
    (body.errcode !== undefined && body.errcode !== 0)
  ) {
    const error = new Error(
      response.status === 401
        ? "账号或密码不正确，或登录状态已失效。"
        : response.status === 403
          ? "当前账号没有访问权限，请联系管理员。"
          : response.status >= 500
            ? "服务暂时不可用，请稍后重试。"
            : body?.message || "请求失败，请重试。",
    );
    error.status = response.status;
    throw error;
  }
  return body.data;
}
export default function App() {
  const [session, setSession] = useState(null),
    [checking, setChecking] = useState(true),
    [startupError, setStartupError] = useState("");
  const [error, setError] = useState(
    () => ssoErrors[new URLSearchParams(location.search).get("sso")] || "",
  );
  const [form, setForm] = useState({ username: "", password: "" }),
    [visible, setVisible] = useState(false),
    [pending, setPending] = useState("");
  const [notice, setNotice] = useState(""),
    [updated, setUpdated] = useState(null);
  const busy = useRef(false);
  const setPath = (path) => {
    if (location.pathname !== path || location.search)
      history.replaceState(null, "", path);
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
      setPath("/profile");
      if (!initial) setNotice("个人信息已更新。");
    } catch (e) {
      if (e.status === 401) {
        setSession(null);
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
    loadSession(true);
  }, []);
  const login = async (e) => {
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
      setPath("/profile");
    } catch (e) {
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
      setForm({ username: "", password: "" });
      setVisible(false);
      setUpdated(null);
      setPath("/login");
    } catch (e) {
      if (e.status === 401) {
        setSession(null);
        setPath("/login");
      } else setError("退出未完成。" + e.message);
    } finally {
      busy.current = false;
      setPending("");
    }
  };
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
                {["项目立项", "志愿招募", "时长记录", "审核归档"].map(
                  (s, i) => (
                    <li key={s}>
                      <span>{i < 2 ? <Icon name="check" /> : i + 1}</span>
                      {s}
                    </li>
                  ),
                )}
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
              href="/api/v1/auth/sso/start?return_to=%2Fprofile"
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
  const user = session.user,
    name = user.name || user.username || "平台用户",
    groups = Array.isArray(user.groups) ? user.groups : [];
  const authLabel =
    {
      password: "账号密码登录",
      sso: "学校统一认证",
      session: "已通过会话验证",
    }[session.auth_method] || "已通过会话验证";
  return (
    <div className="profile-shell">
      <aside className="sidebar">
        <Brand />
        <div className="organization">北京航空航天大学</div>
        <p className="nav-caption">个人空间</p>
        <a className="nav-item active" href="/profile" aria-current="page">
          <Icon name="user" />
          个人信息
        </a>
        <div className="sidebar-note">
          <Icon name="heart" />
          <strong>让每一份服务都有记录</strong>
          <p>
            用热心参与，用行动连接。
            <br />
            从这里认识你的志愿服务身份。
          </p>
        </div>
        <div className="sidebar-user">
          <span className="avatar">{name.slice(0, 1)}</span>
          <div>
            <strong>{name}</strong>
            <small>
              {groups.map((g) => groupNames[g] || "其他用户组").join("、") ||
                "暂未分配用户组"}
            </small>
          </div>
        </div>
      </aside>
      <div className="profile-main">
        <header className="topbar">
          <span>
            个人空间 <b>/</b> <strong>个人信息</strong>
          </span>
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
                <div>
                  <dt>平台用户标识</dt>
                  <dd className="identifier">{user.sub || "未提供"}</dd>
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
