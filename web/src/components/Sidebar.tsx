import type { AuthSession } from "../types.ts";
import { useEffect, useRef } from "react";
import { useMediaQuery } from "../lib/useMediaQuery.ts";
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
  const mobile = useMediaQuery("(max-width: 760px)");
  const dialog = useRef<HTMLDialogElement>(null);
  const wasMobile = useRef(mobile);

  useEffect(() => {
    if (wasMobile.current && !mobile) onClose();
    wasMobile.current = mobile;
  }, [mobile, onClose]);

  useEffect(() => {
    const drawer = dialog.current;
    if (!mobile || !open || !drawer) return;
    drawer.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      drawer.close();
      document.body.style.overflow = overflow;
    };
  }, [mobile, open]);

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
    ? [
        {
          path: "/users",
          label: groups.includes("super_admin")
            ? "成员管理"
            : "账号目录（只读）",
          icon: "people",
        },
      ]
    : [];
  const personal = [
    { path: "/recruitment", label: "招募活动", icon: "heart" },
    { path: "/my-services", label: "我的服务", icon: "clock" },
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
  const content = (
    <>
      <div className="sidebar-heading">
        <Brand onNavigate={() => go(homePath(session))} />
        {mobile && (
          <button
            type="button"
            className="activity-icon-button"
            aria-label="收起导航"
            onClick={onClose}
            autoFocus
          >
            <Icon name="close" />
          </button>
        )}
      </div>
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
            <p className="nav-caption activity-personal-caption">
              {groups.includes("super_admin") ? "系统管理" : "账号查询"}
            </p>
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
    </>
  );

  return mobile ? (
    <dialog
      ref={dialog}
      id="workspace-navigation"
      className="sidebar activity-sidebar navigation-drawer"
      aria-label="主导航"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      {content}
    </dialog>
  ) : (
    <aside
      id="workspace-navigation"
      className="sidebar activity-sidebar"
      aria-label="主导航"
    >
      {content}
    </aside>
  );
}
