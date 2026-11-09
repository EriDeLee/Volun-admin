import type { AuthSession } from "../types.ts";
import {
  canManage,
  groupNames,
  homePath,
  canReadUsers,
} from "../lib/constants.ts";
import Brand from "./Brand.tsx";
import Icon from "./Icon.tsx";

export default function Sidebar({
  session,
  route,
  onNavigate,
  open = false,
  onClose,
}: {
  session: AuthSession;
  route: string;
  onNavigate: (path: string) => void;
  open?: boolean;
  onClose: () => void;
}) {
  const groups = session.user.groups || [];
  const manager = canManage(session);
  const dataManager = groups.some(
    (g) => g === "super_admin" || g === "data_admin",
  );
  const name = session.user.name || session.user.username || "平台用户";
  const go = (path: string) => {
    onClose();
    onNavigate(path);
  };
  const work = manager
    ? [
        { path: "/activity", label: "工作台", icon: "grid" },
        { path: "/projects", label: "项目台账", icon: "folder" },
        ...(dataManager
          ? [
              { path: "/approvals", label: "项目审批", icon: "shield" },
              { path: "/hours", label: "时长管理", icon: "clock" },
              { path: "/materials", label: "项目材料", icon: "file" },
            ]
          : []),
      ]
    : [];
  const management = canReadUsers(session)
    ? [{ path: "/users", label: "成员管理", icon: "people" }]
    : [];
  const personal = [
    { path: "/signup", label: "公开问卷", icon: "file" },
    { path: "/profile", label: "个人信息", icon: "user" },
  ];
  const links = (items: typeof personal) =>
    items.map((item) => {
      const active =
        route === item.path ||
        (item.path === "/projects" && route.startsWith("/projects/"));
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
        </a>
      );
    });
  return (
    <>
      <aside
        className={`sidebar activity-sidebar ${open ? "is-open" : ""}`}
        aria-label="主导航"
      >
        <Brand onNavigate={() => go(homePath(session))} />
        <div className="organization">
          <Icon name="building" />
          北京航空航天大学
        </div>
        <nav aria-label="页面导航">
          {work.length > 0 && (
            <>
              <p className="nav-caption">工作空间</p>
              {links(work)}
            </>
          )}
          {management.length > 0 && (
            <>
              <p className="nav-caption activity-personal-caption">系统管理</p>
              {links(management)}
            </>
          )}
          <p className="nav-caption activity-personal-caption">个人空间</p>
          {links(personal)}
        </nav>
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
            <small>
              {groups.map((g) => groupNames[g] || "其他用户组").join("、") ||
                "暂未分配用户组"}
            </small>
          </div>
        </div>
      </aside>
      {open && (
        <button
          className="activity-menu-overlay"
          aria-label="收起导航"
          onClick={onClose}
        />
      )}
    </>
  );
}
