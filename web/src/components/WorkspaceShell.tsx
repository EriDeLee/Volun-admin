import type { AuthSession, WorkspaceProps } from "../types.ts";
import React, { useState } from "react";
import Icon from "./Icon.tsx";
import Sidebar from "./Sidebar.tsx";
import ThemeSelect from "./ThemeSelect.tsx";

export { default as Brand } from "./Brand.tsx";

export default function WorkspaceShell({
  session,
  route,
  crumb,
  onNavigate,
  logout,
  logoutPending,
  children,
  actions,
  space = "工作空间",
  contentClassName = "activity-content",
}: Omit<WorkspaceProps, "api" | "onSessionIssue" | "session"> & {
  session: AuthSession | null;
  route: string;
  crumb: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  projectCount?: number;
  space?: string;
  contentClassName?: string;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="activity-shell">
      <a className="skip-link" href="#workspace-content">
        跳到主要内容
      </a>
      <Sidebar
        session={session}
        route={route}
        onNavigate={onNavigate}
        open={menu}
        onClose={() => setMenu(false)}
      />
      <div className="profile-main">
        <header className="topbar activity-topbar">
          <button
            className="activity-icon-button activity-mobile-menu"
            aria-label="展开导航"
            aria-expanded={menu}
            aria-controls="workspace-navigation"
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
          <span>
            {space} <b>/</b> <strong>{crumb}</strong>
          </span>
          <div className="activity-top-actions">
            <ThemeSelect />
            <span className="activity-today">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            {actions}
            {session ? (
              <button
                className="button secondary"
                onClick={logout}
                disabled={logoutPending}
              >
                <Icon name="logout" />
                {logoutPending ? "正在退出…" : "退出登录"}
              </button>
            ) : (
              <a
                className="button secondary"
                href="/login"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate("/login");
                }}
              >
                登录平台
              </a>
            )}
          </div>
        </header>
        <main id="workspace-content" className={contentClassName} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
