import type { Basics } from "../lib/workflow.ts";
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

type GuaranteeInfo = Pick<Basics, "guarantees" | "other_guarantee">;
export function VolunteerGuarantees({ value }: { value: GuaranteeInfo }) {
  return (
    <section aria-label="志愿者保障">
      <h3>志愿者保障</h3>
      <p>
        {[
          ...(value.guarantees || []).filter((option) => option !== "其他"),
          value.other_guarantee,
        ]
          .filter(Boolean)
          .join("、") || "暂未公布保障信息"}
      </p>
    </section>
  );
}
export function VolunteerGuaranteesEditor({
  value,
  onChange,
}: {
  value: Basics;
  onChange: (value: Basics) => void;
}) {
  return (
    <fieldset className="material-guarantees">
      <legend>志愿者保障（可多选）</legend>
      <p>审批通过后将在招募平台、报名问卷和附件1中统一展示。</p>
      <div className="material-option-grid">
        {guarantees.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={(value.guarantees || []).includes(option)}
              onChange={(e) =>
                onChange({
                  ...value,
                  guarantees: e.target.checked
                    ? [...(value.guarantees || []), option]
                    : (value.guarantees || []).filter(
                        (item) => item !== option,
                      ),
                })
              }
            />
            {option}
          </label>
        ))}
      </div>
      <label>
        其他保障
        <input
          maxLength={2000}
          value={value.other_guarantee || ""}
          onChange={(e) =>
            onChange({
              ...value,
              guarantees: value.guarantees || [],
              other_guarantee: e.target.value,
            })
          }
        />
      </label>
    </fieldset>
  );
}
