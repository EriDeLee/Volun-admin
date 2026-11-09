import type { WorkspaceProps } from "../types.ts";
import React, { useState } from "react";
import Icon from "./Icon.tsx";
import Sidebar from "./Sidebar.tsx";

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
}: Omit<WorkspaceProps, "api" | "onSessionIssue"> & {
  route: string;
  crumb: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  projectCount?: number;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="activity-shell">
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
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
          <span>
            工作空间 <b>/</b> <strong>{crumb}</strong>
          </span>
          <div className="activity-top-actions">
            <span className="activity-today">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            {actions}
            <button
              className="button secondary"
              onClick={logout}
              disabled={logoutPending}
            >
              <Icon name="logout" />
              {logoutPending ? "正在退出…" : "退出登录"}
            </button>
          </div>
        </header>
        <main className="activity-content">{children}</main>
      </div>
    </div>
  );
}
