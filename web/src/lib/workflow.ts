import type { Project } from "../types.ts";

export interface Position {
  id: string;
  name: string;
  capacity: number;
  description: string;
  hours: number | null;
}
export interface ServiceSession {
  id: string;
  name: string;
  start: string;
  end: string;
  positions: Position[];
}
export interface Basics {
  name: string;
  department: string;
  starts_on: string;
  ends_on: string;
  location: string;
  description: string;
  sessions: ServiceSession[];
}

export const basicsSnapshot = (basics: Basics) => {
  const instant = (value: string) => {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : value;
  };
  return JSON.stringify([
    basics.name,
    basics.department,
    basics.starts_on,
    basics.ends_on,
    basics.location,
    basics.description,
    basics.sessions.map((session) => [
      session.id,
      session.name,
      instant(session.start),
      instant(session.end),
      session.positions.map((position) => [
        position.id,
        position.name,
        position.capacity,
        position.description,
        position.hours ?? null,
      ]),
    ]),
  ]);
};
export interface Assignment {
  session_id: string;
  position_id: string;
}
export interface Member {
  account_username?: string;
  id: string;
  name: string;
  number: string;
  department: string;
  phone: string;
  session_id: string;
  position_id: string;
  source: string;
  intent: string;
  platform: string;
  notes?: string;
  assignments?: Assignment[];
  identity_source?: "account" | "manual";
  identity_verified?: boolean;
}

export const memberAssignments = (
  member: Pick<Member, "session_id" | "position_id" | "assignments">,
): Assignment[] =>
  member.assignments?.length
    ? member.assignments
    : member.session_id && member.position_id
      ? [{ session_id: member.session_id, position_id: member.position_id }]
      : [];
export interface Attendance {
  id: string;
  member_id: string;
  session_id: string;
  action: string;
  source: string;
  reason: string;
  actor: string;
  at: string;
}
export interface Hour {
  member_id: string;
  hours: number | null;
  recognized: number | null;
  reason: string;
  source: string;
}
export interface PublishedForm {
  id: string;
  published: boolean;
  title: string;
  description: string;
  deadline: string;
}
export interface AttendanceWindow {
  session_id: string;
  action: string;
  mode: string;
  open: boolean;
  start: string;
  end: string;
  token?: string;
}
export interface Material {
  team: string;
  audience: string;
  registration_start: string;
  registration_end: string;
  checkin_rule: string;
  checkin_start: string;
  checkin_end: string;
  max_daily_hours: number | null;
  recruitment: string;
  password: string;
  guarantees: string[];
  other_guarantee: string;
  description: string;
  contact_name: string;
  contact_phone: string;
  contact_mobile: string;
  contact_email: string;
  notes: string;
  training: string;
}
export interface Workflow {
  project: Project;
  version: number;
  approval: string;
  capabilities: string[];
  state: {
    basics: Basics;
    draft: Basics | null;
    applications: {
      id: string;
      kind: string;
      status: string;
      basics: Basics;
      applicant: string;
      reviewer: string;
      reason: string;
      review_reason?: string;
      reviewed_at?: string;
      created_at: string;
    }[];
    members: Member[];
    windows: AttendanceWindow[];
    attendance: Attendance[];
    hours: Hour[] | null;
    form: PublishedForm;
    intent_form: PublishedForm;
    material: Material;
    review: {
      external_result: string;
      opinion: string;
      published: boolean;
      approved_at: string | null;
    };
    legacy: boolean;
  };
}
export interface History {
  events: {
    id: string;
    version: number;
    action: string;
    actor: string;
    reason: string;
    created_at: string;
  }[];
  materials: {
    id: string;
    version: number;
    filename: string;
    checksum: string;
    template_checksum: string;
    created_at: string;
  }[];
}

export function workflowAvailability(data: Workflow, now = Date.now()) {
  const approved = data.approval === "approved";
  const attendance =
    approved &&
    [
      "进行",
      "结项",
      "意向",
      "统计",
      "数据",
      "录入",
      "审核",
      "通过",
      "驳回",
    ].includes(data.project.status);
  let first: ServiceSession | undefined;
  for (const session of data.state.basics.sessions) {
    const start = Date.parse(session.start),
      end = Date.parse(session.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      first = undefined;
      break;
    }
    if (!first || Date.parse(session.start) < Date.parse(first.start))
      first = session;
  }
  const firstEnd = first ? Date.parse(first.end) : NaN;
  const hours = attendance && Number.isFinite(firstEnd) && now >= firstEnd;
  return { approved, attendance, hours, first, firstEnd };
}

export async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
  version?: number,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    cache: "no-store",
    method: body === undefined ? "GET" : method,
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            ...(version === undefined
              ? {}
              : { "X-Workflow-Version": String(version) }),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.errcode) {
    const error = Object.assign(
      new Error(result.message || "请求失败，请重试"),
      { status: response.status, code: result.errcode },
    );
    throw error;
  }
  return result.data as T;
}
export const approvalNames: Record<string, string> = {
  draft: "立项草稿",
  pending: "待立项审核",
  approved: "立项通过",
  returned: "立项退回",
};
export const attendanceNames: Record<string, string> = {
  checkin: "签到",
  checkout: "签退",
  absent: "缺席",
};
export const iso = (value: string) =>
  value ? new Date(value).toISOString() : "";

export function sessionRangeError(basics: Basics): string {
  if (basics.ends_on < basics.starts_on)
    return "项目结束日期不能早于开始日期。";
  if (!basics.sessions.length) return "请至少添加一个场次和岗位。";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateOf = (date: Date) => {
    const parts = formatter.formatToParts(date);
    return ["year", "month", "day"]
      .map((key) => parts.find((p) => p.type === key)?.value)
      .join("-");
  };
  for (const [index, session] of basics.sessions.entries()) {
    const name = session.name || `第${index + 1}场`;
    const start = new Date(session.start),
      end = new Date(session.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
      return `场次“${name}”：请填写有效的开始和结束时间。`;
    if (end <= start) return `场次“${name}”：结束时间必须晚于开始时间。`;
    if (dateOf(start) < basics.starts_on || dateOf(end) > basics.ends_on)
      return `场次“${name}”的时间超出项目日期（${basics.starts_on} 至 ${basics.ends_on}，按北京时间）。请调整场次时间或项目起止日期。`;
  }
  return "";
}
export const localTime = (value: string) => {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
