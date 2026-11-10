import type { ReactNode } from "react";
import { useId } from "react";
import type { Basics, Material } from "../lib/workflow.ts";

export const checkinRules = ["定位打卡", "扫动态码", "定位扫码"];
export const recruitments = ["免审密码招募", "公开招募", "定向招募"];
export const guarantees = [
  "志愿者保险",
  "集中乘车",
  "交通补贴",
  "餐饮或食物",
  "提供饮水",
  "提供住宿",
  "志愿者服装",
  "志愿服务工具",
  "免费体检",
  "专项培训",
  "志愿服务证书",
];

export default function AttachmentMaterialFields({
  value,
  basics,
  onChange,
  onEditPositions,
  positionsExpanded = false,
  positionDetails,
}: {
  value: Material;
  basics: Basics;
  onChange: (value: Material) => void;
  onEditPositions: () => void;
  positionsExpanded?: boolean;
  positionDetails?: ReactNode;
}) {
  const positionDetailsID = useId();
  const update = (key: keyof Material, next: unknown) =>
    onChange({ ...value, [key]: next });
  const input = (
    key: keyof Material,
    label: string,
    type = "text",
    readOnly = false,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        readOnly={readOnly}
        value={String(value[key] ?? "")}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  return (
    <>
      <fieldset className="material-section">
        <legend>项目基本信息</legend>
        <p>项目名称、服务地点与立项信息保持一致。</p>
        <div className="workflow-grid">
          <label>
            项目名称
            <input readOnly value={basics.name} />
          </label>
          {input("team", "团队名称")}
          {input("audience", "服务对象")}
          <label>
            服务地点
            <input readOnly value={basics.location} />
          </label>
        </div>
        <label>
          活动描述（500字以内）
          <textarea
            maxLength={500}
            rows={5}
            value={value.description || ""}
            onChange={(event) => update("description", event.target.value)}
            placeholder="写清日期、时间、岗位分工与每天拟录入时长。"
          />
          <small>{(value.description || "").length} / 500</small>
        </label>
      </fieldset>
      <fieldset className="material-section">
        <legend>时间与签到</legend>
        <div className="workflow-grid">
          {input("registration_start", "报名起始日期", "date")}
          {input("registration_end", "报名截止日期", "date")}
          <label>
            服务开始日期
            <input type="date" readOnly value={basics.starts_on} />
          </label>
          <label>
            服务结束日期
            <input type="date" readOnly value={basics.ends_on} />
          </label>
          <label>
            打卡规则
            <select
              value={value.checkin_rule || ""}
              onChange={(event) => update("checkin_rule", event.target.value)}
            >
              <option value="">请选择</option>
              {checkinRules.map((rule) => (
                <option key={rule}>{rule}</option>
              ))}
            </select>
          </label>
          <label>
            每日每人预计最长时长
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={value.max_daily_hours ?? ""}
              onChange={(event) =>
                update(
                  "max_daily_hours",
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
            />
            <small>小时</small>
          </label>
          {input("checkin_start", "系统自动开始打卡时间", "time")}
          {input("checkin_end", "系统自动截止打卡时间", "time")}
        </div>
      </fieldset>
      <fieldset className="material-section">
        <legend>招募与保障</legend>
        <div className="workflow-grid">
          <label>
            志愿者招募范围
            <select
              value={value.recruitment || ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  recruitment: event.target.value,
                  password:
                    event.target.value === "免审密码招募" ? value.password : "",
                })
              }
            >
              <option value="">请选择</option>
              {recruitments.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            免审密码
            <input
              type="password"
              autoComplete="new-password"
              disabled={value.recruitment !== "免审密码招募"}
              value={value.password || ""}
              onChange={(event) => update("password", event.target.value)}
              placeholder="如有，请填写"
            />
          </label>
        </div>
        <fieldset className="material-guarantees">
          <legend>志愿者保障（可多选）</legend>
          <div className="material-option-grid">
            {guarantees.map((option) => (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={(value.guarantees || []).includes(option)}
                  onChange={(event) =>
                    update(
                      "guarantees",
                      event.target.checked
                        ? [...(value.guarantees || []), option]
                        : value.guarantees.filter((item) => item !== option),
                    )
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        {input("other_guarantee", "其他保障")}
      </fieldset>
      <fieldset className="material-section">
        <legend>岗位设置</legend>
        <p>
          岗位名称、人数和填写的岗位描述将写入附件1，描述不自动追加工作时间或拟录入时长。
        </p>
        {basics.sessions.flatMap((session) =>
          session.positions.map((position) => (
            <p key={`${session.id}:${position.id}`}>
              {session.name} / {position.name} · {position.capacity}人 · 拟录入
              {position.hours ?? "未填写"}小时
            </p>
          )),
        )}
        {!basics.sessions.some((session) => session.positions.length) && (
          <p>尚未设置岗位，请先完善立项中的场次与岗位。</p>
        )}
        <button
          type="button"
          className="button secondary"
          onClick={onEditPositions}
          aria-expanded={positionsExpanded}
          aria-controls={positionDetailsID}
        >
          {positionsExpanded ? "收起场次与岗位" : "查看场次与岗位"}
        </button>
        <div id={positionDetailsID} hidden={!positionsExpanded}>
          {positionsExpanded && positionDetails}
        </div>
      </fieldset>
      <fieldset className="material-section">
        <legend>联系人与附件补充</legend>
        <p>联系方式由环境配置统一提供；其他补充说明和培训信息可继续填写。</p>
        <div className="workflow-grid">
          {input("contact_name", "联系人姓名", "text", true)}
          {input("contact_phone", "联系人电话", "tel", true)}
          {input("contact_mobile", "联系人手机", "tel", true)}
          {input("contact_email", "联系人邮箱", "email", true)}
        </div>
        {(
          [
            ["notes", "其他补充说明"],
            ["training", "培训信息"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              rows={3}
              value={value[key] || ""}
              onChange={(event) => update(key, event.target.value)}
              placeholder="没有可留空"
            />
          </label>
        ))}
      </fieldset>
    </>
  );
}
