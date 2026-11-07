import type { WorkspaceProps } from "../types.ts";
import React, { useState } from "react";
import Icon from "./Icon.tsx";
import { groupNames } from "../lib/constants.ts";

const navItems = [
  { path: "/activity", label: "工作台", icon: "grid" },
  { path: "/projects", label: "项目台账", icon: "folder" },
  { path: "/hours", label: "时长管理", icon: "clock" },
  { path: "/materials", label: "项目材料", icon: "file" },
];

function Brand({ onNavigate }: { onNavigate?: (path: string) => void } = {}) {
  return (
    <a
      className="brand"
      href="/"
      aria-label="志愿服务项目管理平台"
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate("/activity");
            }
          : undefined
      }
    >
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

export { Brand };

export default function WorkspaceShell({
  session,
  route,
  crumb,
  onNavigate,
  logout,
  logoutPending,
  children,
  actions,
  projectCount,
}: Omit<WorkspaceProps, "api" | "onSessionIssue"> & {
  route: string;
  crumb: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  projectCount?: number;
}) {
  const [menu, setMenu] = useState(false);
  const name = session.user.name || session.user.username || "平台用户";
  const groups = Array.isArray(session.user.groups) ? session.user.groups : [];
  const roleLabel =
    groups
      .map((g) => groupNames[g] || g)
      .filter(Boolean)
      .join("、") || "平台用户";
  const isSuper = groups.includes("super_admin");
  const go = (path: string) => {
    setMenu(false);
    onNavigate(path);
  };

  return (
    <div className="activity-shell">
      <aside className={`sidebar activity-sidebar ${menu ? "is-open" : ""}`}>
        <Brand onNavigate={go} />
        <div className="organization">
          <Icon name="building" />
          北京航空航天大学
        </div>
        <p className="nav-caption">工作空间</p>
        {navItems.map((item) => {
          const active =
            item.path === "/projects"
              ? route === "/projects" || route.startsWith("/projects/")
              : route === item.path;
          return (
            <a
              key={item.path}
              className={`nav-item ${active ? "active" : ""}`}
              href={item.path}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(item.path);
              }}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.path === "/projects" && projectCount != null && (
                <span className="nav-count">{projectCount}</span>
              )}
            </a>
          );
        })}
        <p className="nav-caption activity-personal-caption">管理与协作</p>
        <a
          className="nav-item"
          href="/signup"
          onClick={(e) => {
            e.preventDefault();
            go("/signup");
          }}
        >
          <Icon name="file" />
          公开问卷
        </a>
        <a
          className={`nav-item ${route === "/profile" ? "active" : ""}`}
          href="/profile"
          onClick={(e) => {
            e.preventDefault();
            go("/profile");
          }}
        >
          <Icon name="user" />
          个人信息
        </a>
        <div className="sidebar-note">
          <Icon name="heart" />
          <strong>让每一份服务都有记录</strong>
          <p>
            从项目立项到时长归档，
            <br />
            让每一步协作更有条理。
          </p>
        </div>
        <div className="sidebar-user">
          <span className="avatar">{name.slice(0, 1)}</span>
          <div>
            <strong>{name}</strong>
            <small>{isSuper ? "超管" : roleLabel}</small>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="activity-menu-overlay"
          aria-label="收起导航"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="profile-main">
        <header className="topbar activity-topbar">
          <button
            className="activity-icon-button activity-mobile-menu"
            aria-label="展开导航"
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
