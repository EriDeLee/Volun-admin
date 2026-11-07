import type { ProjectPageProps, MaterialForm } from "../types.ts";
import React, { useState } from "react";
import WorkspaceShell from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import {
  DraftNotice,
  ProjectPicker,
  useProject,
} from "../components/ProjectContext.tsx";
import { downloadText, escapeHTML, useDraft } from "../lib/drafts.tsx";

export function materialRows(form: MaterialForm) {
  return [
    ["项目名称", form.name],
    ["主办部门", form.department],
    ["活动负责人", form.owner],
    ["活动时间", `${form.start} 至 ${form.end}`],
    ["活动地点", form.location],
    ["服务对象", form.audience.join("、")],
    ["活动内容", form.description],
    ["组织保障", form.safety],
    ["审核意见", "（待正式审核）"],
  ];
}

export function materialHTML(form: MaterialForm) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>志愿服务活动立项申请表 · 版式草稿</title><style>body{font-family:SimSun,serif;max-width:800px;margin:40px auto;padding:24px;line-height:1.8;color:#222}h1{text-align:center;font-size:24px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #333;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}th{width:105px;font-weight:400}footer{text-align:center;font-size:12px;margin-top:24px}@media print{body{margin:0}}</style></head><body><small>附件1 · 版式草稿</small><h1>北京航空航天大学<br>志愿服务活动立项申请表</h1><table>${materialRows(
    form,
  )
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHTML(key)}</th><td>${escapeHTML(value)}</td></tr>`,
    )
    .join(
      "",
    )}</table><footer>版式预览 · 非学校正式模板 · 下载不代表立项或审核通过</footer></body></html>`;
}

export default function MaterialsPage(props: ProjectPageProps) {
  const { id, api, onSessionIssue, onNavigate } = props;
  const {
    project: p,
    error,
    loading,
    retry,
  } = useProject({ id, api, onSessionIssue });
  const [draft, update] = useDraft(id);
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const form =
    draft.material ||
    (p
      ? {
          name: p.name,
          department: p.department,
          owner: p.owner_name || "",
          start: p.starts_on,
          end: p.ends_on,
          location: p.location,
          audience: [],
          description: p.description || "",
          safety: "",
        }
      : null);
  const change = <K extends keyof MaterialForm>(
    key: K,
    value: MaterialForm[K],
  ) => {
    if (!form) return;
    update({ material: { ...form, [key]: value } });
    setNotice("");
    setValidation("");
  };
  const generate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      !form ||
      form.end < form.start ||
      !form.audience.length ||
      !form.name.trim() ||
      !form.department.trim() ||
      !form.owner.trim() ||
      !form.location.trim() ||
      !form.description.trim() ||
      !form.safety.trim()
    ) {
      setValidation(
        "请填写完整信息、选择服务对象，并检查结束日期不早于开始日期。",
      );
      return;
    }
    downloadText(
      "附件1-立项申请表-版式草稿.html",
      materialHTML(form),
      "text/html;charset=utf-8",
    );
    setValidation("");
    setNotice(
      "已下载申请表版式草稿，项目状态未改变。正式学校模板、版本归档与服务器保存待接入。",
    );
  };
  return (
    <WorkspaceShell {...props} route="/materials" crumb="项目材料">
      <div className="page-heading">
        <div>
          <h1>项目材料</h1>
          <p>
            {p
              ? `${p.name} · 附件1：志愿服务活动立项申请表`
              : "填写立项申请信息，实时核对材料版式。"}
          </p>
        </div>
        <div className="activity-actions">
          {id && (
            <button
              className="button secondary"
              onClick={() => onNavigate(`/projects/${encodeURIComponent(id)}`)}
            >
              返回项目详情
            </button>
          )}
          {p && (
            <button
              className="button primary"
              type="submit"
              form="material-form"
            >
              <Icon name="download" />
              下载版式草稿
            </button>
          )}
        </div>
      </div>
      {props.parentError && (
        <p className="error" role="alert">
          {props.parentError}
        </p>
      )}
      {!id ? (
        <ProjectPicker
          {...props}
          onSelect={(value) =>
            onNavigate(`/materials?project=${encodeURIComponent(value)}`)
          }
        />
      ) : loading ? (
        <section className="panel activity-loading" role="status">
          正在读取项目信息…
        </section>
      ) : error ? (
        <section className="panel activity-error" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={retry}>
            重新加载
          </button>
        </section>
      ) : (
        form && (
          <>
            <DraftNotice />
            {notice && (
              <p className="success" role="status">
                {notice}
              </p>
            )}
            {validation && (
              <p className="error" role="alert">
                {validation}
              </p>
            )}
            <div className="material-layout">
              <section className="panel">
                <div className="activity-panel-heading">
                  <div>
                    <h2>立项申请信息</h2>
                    <p>编辑左侧信息，右侧实时预览。</p>
                  </div>
                  <span className="activity-badge gray">会话草稿</span>
                </div>
                <form
                  id="material-form"
                  className="activity-project-form"
                  onSubmit={generate}
                >
                  <div className="activity-form-fields">
                    {(
                      [
                        ["name", "项目名称", "text", true],
                        ["department", "主办部门", "text"],
                        ["owner", "活动负责人", "text"],
                        ["start", "开始日期", "date"],
                        ["end", "结束日期", "date"],
                        ["location", "活动地点", "text", true],
                      ] as const
                    ).map(([key, label, type, full]) => (
                      <label key={key} className={full ? "full" : ""}>
                        {label} *
                        <input
                          required
                          type={type}
                          maxLength={160}
                          min={key === "end" ? form.start : undefined}
                          value={form[key]}
                          onChange={(e) => change(key, e.target.value)}
                        />
                      </label>
                    ))}
                    <fieldset className="full workspace-fieldset">
                      <legend>服务对象 *</legend>
                      <div className="check-options">
                        {(
                          [
                            "校内师生",
                            "来访学生",
                            "家长",
                            "社会公众",
                            "社区长者",
                            "青少年",
                          ] as const
                        ).map((a) => (
                          <label key={a}>
                            <input
                              type="checkbox"
                              checked={form.audience.includes(a)}
                              onChange={(e) =>
                                change(
                                  "audience",
                                  e.target.checked
                                    ? [...form.audience, a]
                                    : form.audience.filter((v) => v !== a),
                                )
                              }
                            />
                            {a}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {(
                      [
                        ["description", "活动内容与实施安排"],
                        ["safety", "组织保障与安全措施"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="full">
                        {label} *
                        <textarea
                          rows={5}
                          required
                          maxLength={5000}
                          value={form[key]}
                          onChange={(e) => change(key, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="password-hint">
                    这里的编辑只用于材料草稿，不修改项目基础信息。正式附件1模板与免审密码字段将在学校模板确认后接入。
                  </p>
                </form>
              </section>
              <section className="panel">
                <div className="activity-panel-heading">
                  <h2>申请表预览</h2>
                  <span className="activity-badge gray">
                    版式示意 · 非正式材料
                  </span>
                </div>
                <div className="paper-stage">
                  <article className="material-paper">
                    <small>附件1 · 版式草稿</small>
                    <h2>
                      北京航空航天大学
                      <br />
                      志愿服务活动立项申请表
                    </h2>
                    <table>
                      <tbody>
                        {materialRows(form).map(([label, value]) => (
                          <tr key={label}>
                            <th>{label}</th>
                            <td>{value || "待填写"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>版式预览 · 非学校正式模板 · 下载不代表立项或审核通过</p>
                  </article>
                </div>
                <div className="paper-caption">
                  HTML 实时预览 · 可下载独立 HTML 草稿后打印
                </div>
              </section>
            </div>
          </>
        )
      )}
      <footer className="activity-footer">
        北京航空航天大学 · 志愿服务项目管理平台
      </footer>
    </WorkspaceShell>
  );
}
