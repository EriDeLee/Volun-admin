import type { AuthSession } from "../types.ts";
import { profileComplete } from "./profile.ts";
export const groupNames: Record<string, string> = {
  super_admin: "超管",
  data_admin: "数据管理员",
  activity_admin: "活动管理员",
  formal_user: "正式用户",
};

export const groupOptions = [
  "super_admin",
  "data_admin",
  "activity_admin",
  "formal_user",
] as const;

export const projectStatuses = [
  "立项",
  "筹备",
  "招募",
  "进行",
  "结项",
  "意向",
  "统计",
  "数据",
  "录入",
  "审核",
  "通过",
  "驳回",
];

export const pendingStatuses = ["立项", "筹备", "招募", "结项", "意向"];

export const ssoErrors: Record<string, string> = {
  unavailable: "学校统一认证暂未开放，请使用账号登录或联系管理员。",
  error: "暂时无法连接学校统一认证，请稍后重试。",
  failed: "学校统一认证未完成，请重新发起登录。",
};

export const canManage = (data: AuthSession | null) =>
  data?.user?.groups?.some((g) =>
    ["super_admin", "activity_admin", "data_admin"].includes(g),
  );

export const homePath = (data: AuthSession | null) =>
  canManage(data)
    ? "/activity"
    : data && profileComplete(data.user)
      ? "/recruitment"
      : "/profile";

export const managerPaths = [
  "/activity",
  "/projects",
  "/approvals",
  "/hours",
  "/materials",
];

export const isManagerPath = (path: string) =>
  managerPaths.includes(path) || path.startsWith("/projects/");

export const isSuperAdmin = (data: AuthSession | null) =>
  !!data?.user?.groups?.includes("super_admin");

export const isUsersPath = (path: string) => path === "/users";

export const canReadUsers = (data: AuthSession | null) => isSuperAdmin(data);
