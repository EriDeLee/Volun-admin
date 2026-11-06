import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const api = async (path, options = {}) => {
  const r = await fetch(`/api/v1${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(b.message || "请求失败");
  return b;
};
function App() {
  const [user, setUser] = useState(null),
    [form, setForm] = useState({ username: "admin", password: "change-me" }),
    [error, setError] = useState(() => {
      const status = new URLSearchParams(window.location.search).get("sso");
      return (
        {
          unavailable:
            "学校统一认证未配置：请在后端配置 SSO_CLIENT_ID 和 SSO_CLIENT_SECRET 后重启服务。",
          error: "无法发起学校统一认证，请查看后端日志并重试。",
          failed: "学校统一认证未完成，请重新登录并核对回调配置。",
        }[status] || ""
      );
    }),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/auth/me")
      .then((x) => setUser(x.data.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const login = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const x = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setUser(x.data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };
  if (loading) return <main className="center">正在检查登录状态…</main>;
  if (!user)
    return (
      <main className="center">
        <section className="panel">
          <p className="eyebrow">VOLUN DATA</p>
          <h1>登录平台</h1>
          <p className="muted">开发环境默认账号：admin / change-me</p>
          <form onSubmit={login}>
            <label>
              账号
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                autoComplete="username"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="current-password"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button disabled={loading}>账号密码登录</button>
          </form>
          <div className="divider">或</div>
          <a className="sso" href="/api/v1/auth/sso/start?return_to=/">
            学校统一认证登录
          </a>
        </section>
      </main>
    );
  return (
    <main className="center">
      <section className="panel">
        <p className="eyebrow">WORKSPACE</p>
        <h1>欢迎回来，{user.name || user.username}</h1>
        <p className="muted">当前账号：{user.username}</p>
        <div className="groups">
          {user.groups.map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
        <button className="secondary" onClick={logout}>
          退出登录
        </button>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
