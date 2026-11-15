import { VolunteerGuarantees } from "./VolunteerGuarantees.tsx";
import type { Basics, Material } from "../lib/workflow.ts";

export const checkinRules = ["定位打卡", "扫动态码", "定位扫码"];
export const recruitments = ["免审密码招募", "公开招募", "定向招募"];
export default function AttachmentMaterialFields({
  value,
  basics,
  onChange,
}: {
  value: Material;
  basics: Basics;
  onChange: (value: Material) => void;
}) {
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
          活动描述
          <textarea
            data-max-length={500}
            rows={5}
            value={value.description || ""}
            onChange={(event) => update("description", event.target.value)}
            placeholder="写清日期、时间、岗位分工与每天拟录入时长。"
          />
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
            每人每日预计时长（小时）
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
          </label>
          {input("checkin_start", "系统自动开始打卡时间", "time")}
          {input("checkin_end", "系统自动截止打卡时间", "time")}
        </div>
      </fieldset>
      <fieldset className="material-section">
        <legend>附件招募信息与立项保障</legend>
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
        <p>志愿者保障请在立项中修改。</p>
        <VolunteerGuarantees value={basics} />
      </fieldset>
      <fieldset className="material-section">
        <legend>岗位设置</legend>
        {basics.sessions.flatMap((session) =>
          session.positions.map((position) => (
            <p key={`${session.id}:${position.id}`}>
              {session.name} / {position.name} · {position.capacity}人 ·{" "}
              {position.hours == null
                ? "时长未填写"
                : `预计 ${position.hours} 小时`}
            </p>
          )),
        )}
        {!basics.sessions.some((session) => session.positions.length) && (
          <p>尚未设置岗位，请先完善立项中的场次与岗位。</p>
        )}
        <p>场次与岗位请在立项中修改。</p>
      </fieldset>
      <fieldset className="material-section">
        <legend>联系人与附件补充</legend>
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
