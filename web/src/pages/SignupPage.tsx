import type { AuthSession, WorkspaceProps } from "../types.ts";
import React, { useState } from "react";
import { Brand } from "../components/WorkspaceShell.tsx";
import Icon from "../components/Icon.tsx";
import ThemeSelect from "../components/ThemeSelect.tsx";
import { useProject } from "../components/ProjectContext.tsx";

export default function SignupPage({
  session,
  api,
  onSessionIssue,
  onNavigate,
  search = "",
}: Omit<WorkspaceProps, "session" | "logout"> & {
  session: AuthSession | null;
  search?: string;
}) {
  const params = new URLSearchParams(search);
  const preview = params.get("preview") === "1";
  const requestedID = params.get("project");
  const id = session && requestedID ? requestedID : null;
  const { project, loading, error, retry } = useProject({
    id,
    api,
    onSessionIssue,
  });
  const [form, setForm] = useState({
    name: "",
    number: "",
    department: "",
    phone: "",
    position: "",
    session: "",
    note: "",
    consent: false,
  });
  const [saved, setSaved] = useState(false);
  const [validation, setValidation] = useState("");
  const title = project?.name || "志愿服务项目 · 报名版式预览";
  const change = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((f) => ({ ...f, [key]: value }));
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (
      !(["name", "number", "department", "position", "session"] as const).every(
        (k) => form[k].trim(),
      ) ||
      !form.consent
    ) {
      setValidation("请填写完整的必填信息，并确认预览说明。");
      return;
    }
    setValidation("");
    setSaved(true);
  };
  return (
    <main className="public-page">
      <div className="public-brand">
        <Brand />
        <span className="activity-badge">
          {preview ? "填写预览" : "公开报名"}
        </span>
        <ThemeSelect />
      </div>
      {!preview ? (
        <>
          <header className="public-header">
            <span className="activity-badge gray">尚未开放</span>
            <h1>公开报名</h1>
            <p>
              项目招募问卷将在发布后提供专属填写链接。正式报名与本人修改入口尚未开放。
            </p>
          </header>
          <section className="public-form">
            <div className="public-empty">
              <Icon name="file" />
              <h2>请使用项目发布的报名链接</h2>
              <p>
                本页可查看表单版式，填写预览不会提交报名，也不会生成服务时长。
              </p>
              <div className="activity-actions">
                <button
                  className="button primary"
                  onClick={() => onNavigate("/signup?preview=1")}
                >
                  查看填写预览
                  <Icon name="arrow" />
                </button>
                <button
                  className="button secondary"
                  onClick={() => onNavigate(session ? "/activity" : "/login")}
                >
                  {session ? "返回工作空间" : "管理员登录"}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <header className="public-header">
            <span className="activity-badge">报名表单预览</span>
            <h1>{title}</h1>
            <p>
              {project?.description ||
                "用一份热心，参与一次服务。以下只展示信息填写与修改流程，请使用虚构信息体验。"}
            </p>
            <div className="public-info">
              <span>
                <Icon name="calendar" />
                {project
                  ? `${project.starts_on} 至 ${project.ends_on}`
                  : "场次时间以正式发布为准"}
              </span>
              <span>
                <Icon name="location" />
                {project?.location || "地点以正式发布为准"}
              </span>
            </div>
          </header>
          {loading ? (
            <section className="public-form" role="status">
              正在读取项目…
            </section>
          ) : error ? (
            <section className="public-form" role="alert">
              <h2>无法读取项目预览</h2>
              <p>{error}</p>
              <button className="button secondary" onClick={retry}>
                重新加载
              </button>
            </section>
          ) : (
            <section className="public-form">
              {saved ? (
                <div className="public-success">
                  <span className="public-success-mark">
                    <Icon name="check" />
                  </span>
                  <h2>填写预览已完成</h2>
                  <p>
                    本次内容仅保留在当前页面，没有发送报名。正式系统将由服务器确认提交结果，并提供本人修改入口。
                  </p>
                  <dl className="workspace-kv">
                    <div>
                      <dt>姓名</dt>
                      <dd>{form.name}</dd>
                    </div>
                    <div>
                      <dt>人员编号</dt>
                      <dd>{form.number}</dd>
                    </div>
                    <div>
                      <dt>意向岗位</dt>
                      <dd>{form.position}</dd>
                    </div>
                  </dl>
                  <button
                    className="button primary"
                    onClick={() => setSaved(false)}
                  >
                    修改本次预览
                  </button>
                </div>
              ) : (
                <>
                  <h2>填写报名信息</h2>
                  <div className="workspace-info">
                    <Icon name="info" />
                    <p>
                      无需登录的填写版式预览。请勿填写真实个人信息；本页不会提交报名，刷新或离开后清除。
                    </p>
                  </div>
                  <form onSubmit={submit}>
                    <div className="activity-form-fields">
                      {(
                        [
                          ["name", "姓名", "text"],
                          ["number", "学号 / 人员编号", "text"],
                          ["department", "学院 / 部门", "text"],
                          ["phone", "联系电话（选填）", "tel"],
                        ] as const
                      ).map(([key, label, type]) => (
                        <label key={key}>
                          {label}
                          {key !== "phone" && " *"}
                          <input
                            required={key !== "phone"}
                            type={type}
                            maxLength={80}
                            value={form[key]}
                            onChange={(e) => change(key, e.target.value)}
                            placeholder={
                              key === "number"
                                ? "例如 DEMO-007，保留前导零"
                                : "请填写虚构预览信息"
                            }
                            autoComplete="off"
                          />
                        </label>
                      ))}
                      <label>
                        意向岗位 *
                        <select
                          required
                          value={form.position}
                          onChange={(e) => change("position", e.target.value)}
                        >
                          <option value="">请选择示例岗位</option>
                          {(
                            [
                              "现场引导（示例）",
                              "来访接待（示例）",
                              "服务协助（示例）",
                            ] as const
                          ).map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        参与场次 *
                        <select
                          required
                          value={form.session}
                          onChange={(e) => change("session", e.target.value)}
                        >
                          <option value="">请选择示例场次</option>
                          <option>第一场（仅版式示例）</option>
                          <option>第二场（仅版式示例）</option>
                        </select>
                      </label>
                      <label className="full">
                        备注（选填）
                        <textarea
                          value={form.note}
                          onChange={(e) => change("note", e.target.value)}
                          maxLength={500}
                          rows={3}
                          placeholder="可补充服务安排相关信息"
                        />
                      </label>
                      <label className="full consent-label">
                        <input
                          type="checkbox"
                          required
                          checked={form.consent}
                          onChange={(e) => change("consent", e.target.checked)}
                        />
                        <span>
                          我理解本页为填写预览，以上为虚构信息，完成预览不代表报名成功。
                        </span>
                      </label>
                    </div>
                    {validation && (
                      <p className="error" role="alert">
                        {validation}
                      </p>
                    )}
                    <button className="button primary public-submit">
                      完成填写预览
                      <Icon name="arrow" />
                    </button>
                  </form>
                </>
              )}
            </section>
          )}
          <div className="public-return">
            <button
              className="activity-text-button"
              onClick={() =>
                onNavigate(
                  session
                    ? requestedID
                      ? `/projects/${encodeURIComponent(requestedID)}`
                      : "/activity"
                    : "/login",
                )
              }
            >
              {session ? "返回工作空间" : "管理员登录"}
            </button>
          </div>
        </>
      )}
      <footer className="public-footer">
        北京航空航天大学 · 志愿服务项目管理平台
        <br />
        报名登记不自动产生服务时长
      </footer>
    </main>
  );
}
