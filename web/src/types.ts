import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "./components/Icon.tsx";

export interface User {
  name?: string;
  username?: string;
  id?: string;
  groups: string[];
}
export interface AuthSession {
  user: User;
  password_setup_required?: boolean;
  auth_method?: "password" | "sso" | "session";
}
export interface Project {
  id: string;
  code: string;
  name: string;
  department: string;
  starts_on: string;
  ends_on: string;
  location: string;
  description: string;
  status: string;
  owner_name: string;
  approval?: string;
  created_at?: string;
  updated_at?: string;
}
export interface CreateProject {
  name: string;
  department: string;
  starts_on: string;
  ends_on: string;
  location: string;
  description: string;
}
export interface ActivitySummary {
  project_count: number;
  recruiting_count: number;
  pending_count: number;
  recognized_hours: number | null;
}
export interface Dashboard {
  scope: string;
  generated_at: string;
  summary: ActivitySummary;
  tasks: {
    project_id: string;
    project_name: string;
    status: string;
    instruction: string;
  }[];
  recent_projects: Project[];
  stages: { status: string; count: number }[];
}
export interface ProjectList {
  items: Project[];
  total: number;
  page: number;
  page_size: number;
  summary: ActivitySummary;
  departments: string[];
  scope: string;
}
export interface AdminUser {
  username: string;
  name: string;
  id: string;
  groups: string[];
  status: "active" | "disabled" | string;
  password_setup_required: boolean;
  has_password: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface AdminUserList {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
  summary: {
    user_count: number;
    active_count: number;
    disabled_count: number;
    manager_count: number;
  };
}
export interface ApiError extends Error {
  status?: number;
  code?: number;
}
export interface ApiEnvelope<T> {
  data: T;
  errcode?: number;
  message?: string;
}
export type ApiPath =
  | `/auth/${"me" | "login" | "setup-password" | "logout"}`
  | "/activity/dashboard"
  | "/activity/projects"
  | `/activity/projects?${string}`
  | `/activity/projects/${string}`
  | `/admin/users?${string}`
  | `/admin/users/${string}`;
export type ApiResult<P extends ApiPath> =
  P extends `/auth/${"me" | "login" | "setup-password"}`
    ? AuthSession
    : P extends "/auth/logout"
      ? unknown
      : P extends "/activity/dashboard"
        ? Dashboard
        : P extends `/activity/projects?${string}`
          ? ProjectList
          : P extends `/admin/users?${string}`
            ? AdminUserList
            : P extends `/admin/users/${string}`
              ? AdminUser
              : Project;
export type Api = <P extends ApiPath>(
  path: P,
  options?: RequestInit,
) => Promise<ApiResult<P>>;
export interface WorkspaceProps {
  session: AuthSession;
  api: Api;
  onNavigate: (path: string) => void;
  logout: () => void | Promise<void>;
  logoutPending?: boolean;
  parentError?: string;
  onSessionIssue: (error: ApiError) => void;
}
export interface ProjectPageProps extends WorkspaceProps {
  id?: string | null;
  search?: string;
}
export interface ActivityHomeProps extends WorkspaceProps {
  Icon: ComponentType<IconProps>;
  Brand: ComponentType;
  onOpenProject?: (id: string) => void;
}
export interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
}
export interface PersonDraft {
  name: string;
  number: string;
  department: string;
  position: string;
  session: string;
  id: string;
  source: string;
}
export interface SessionDraft {
  name: string;
  start: string;
  end: string;
  positions: string;
  capacity: string;
  id: string;
  max_hours: number;
}
export interface MaterialForm {
  name: string;
  department: string;
  owner: string;
  start: string;
  end: string;
  location: string;
  audience: string[];
  description: string;
  safety: string;
}
export interface ProjectDraft {
  people: PersonDraft[];
  sessions: SessionDraft[];
  hours: Record<string, Record<string, string>>;
  material: MaterialForm | null;
  saved: boolean;
}
export type DraftChange =
  Partial<ProjectDraft> | ((previous: ProjectDraft) => ProjectDraft);
