import { templateName, templateRequirements, localizeMessage, t } from "./i18n";
import React, { useEffect, useState } from "react";
import { contextOf } from "../shared/analysis";
import { ReportLanguageSelect } from "./LanguageSettings";
import type {
  AnalysisTemplate,
  MeetingContext,
  Request,
  State,
} from "../shared/types";

type Run = (request: Request) => Promise<any>;

export function ContextEditor({
  value,
  templates,
  save,
  reload,
  submitLabel = t("保存背景与分析设置"),
  analysisOnly = false,
}: {
  value?: MeetingContext;
  templates: AnalysisTemplate[];
  save: (value: MeetingContext) => Promise<any>;
  reload?: () => Promise<any>;
  submitLabel?: string;
  analysisOnly?: boolean;
}) {
  const [draft, setDraft] = useState(contextOf(value));
  const [keywords, setKeywords] = useState(draft.keywords.join(", "));
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setDraft(contextOf(value));
    setKeywords(contextOf(value).keywords.join(", "));
  }, [JSON.stringify(value)]);
  const template = templates.find((t) => t.id === draft.templateId);
  const change = (values: Partial<MeetingContext>) => {
    setDraft({ ...draft, ...values });
    setMessage("");
  };
  return (
    <form
      className="context-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setMessage("");
        try {
          await save({
            ...draft,
            keywords: keywords
              .split(/[,，\n]+/)
              .map((k) => k.trim())
              .filter(Boolean),
          });
          setMessage(t("设置已保存"));
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <ReportLanguageSelect
        value={draft.reportLanguage}
        onChange={(reportLanguage) => change({ reportLanguage })}
      />
      {!analysisOnly && (
        <div className="context-fields">
          <label>
            {t("转写语言")}
            <select
              value={draft.transcriptionLanguage ?? "zh"}
              onChange={(e) =>
                change({ transcriptionLanguage: e.target.value as "zh" | "en" })
              }
            >
              <option value="zh">{t("中文（含中英混说）")}</option>
              <option value="en">{t("英文")}</option>
            </select>
          </label>
          <label>
            {t("会议背景")}
            <textarea
              aria-label={t("会议背景")}
              rows={4}
              maxLength={30000}
              value={draft.background}
              placeholder={t("例如：项目目标、已有约定、本次讨论范围…")}
              onChange={(e) => change({ background: e.target.value })}
            />
            <small>{t("用于辅助理解，不作为会议结论的依据。")}</small>
          </label>
          <label>
            {t("关键词")}
            <textarea
              aria-label={t("关键词（人名、项目名、技术术语，逗号或换行分隔）")}
              rows={3}
              value={keywords}
              placeholder={t("例如：张三，VibeVoice，XRD")}
              onChange={(e) => {
                setKeywords(e.target.value);
                setMessage("");
              }}
            />
            <small>{t("人名、项目名或技术术语，用逗号或换行分隔。")}</small>
          </label>
        </div>
      )}
      <div className="form-section">
        <label>
          {t("分析模板")}
          <select
            aria-label={t("分析模板")}
            value={draft.templateId}
            onChange={(e) => change({ templateId: e.target.value })}
          >
            {!template && (
              <option value={draft.templateId}>
                {t("模板已删除，请重新选择")}
              </option>
            )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {templateName(t)}
              </option>
            ))}
          </select>
        </label>
        {template && (
          <div className="template-preview">
            <span>{t("输出要求")}</span>
            <p>{templateRequirements(template)}</p>
          </div>
        )}
        <label>
          {t("本次补充要求")} <span className="optional">{t("选填")}</span>
          <textarea
            aria-label={t("本次补充要求")}
            rows={3}
            maxLength={10000}
            value={draft.additionalRequirements}
            placeholder={t("例如：重点整理阻塞事项，简要保留技术讨论。")}
            onChange={(e) => change({ additionalRequirements: e.target.value })}
          />
        </label>
      </div>
      <p className="form-hint">
        {analysisOnly
          ? t(
              "本次分析使用已保存的背景与姓名映射，结论仍需原文证据。历史分析会保留。",
            )
          : t("背景修改后，再次转录才会影响识别结果。")}
      </p>
      <div className="form-footer">
        {reload && (
          <button
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                await reload();
                setMessage(t("已重新载入项目默认值"));
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            {t("重新载入项目默认值")}
          </button>
        )}
        <span className="save-status" role="status">
          {localizeMessage(message ?? "")}
        </span>
        <button className="primary" disabled={!template || pending}>
          {pending ? t("正在保存…") : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function ProjectDefaults({
  state,
  run,
  initialProject,
}: {
  state: State;
  run: Run;
  initialProject?: string;
}) {
  const [selected, setSelected] = useState(
    state.projects.find((p) => p.id === initialProject)?.id ??
      state.projects[0]?.id ??
      "",
  );
  const project = state.projects.find((p) => p.id === selected);
  return (
    <>
      <div className="dialog-heading">
        <span className="eyebrow">PROJECT DEFAULTS</span>
        <h2>{t("项目默认设置")}</h2>
        <p>{t("新会议会复制这些设置。已有会议可在背景编辑中手动重新载入。")}</p>
      </div>
      {!state.projects.length ? (
        <div className="empty-panel">
          <h3>{t("还没有项目")}</h3>
          <p>{t("创建项目后，可在这里设置通用背景和默认模板。")}</p>
        </div>
      ) : (
        <>
          <label>
            {t("选择项目")}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {project && (
            <ContextEditor
              key={project.id}
              value={project.context}
              templates={state.templates}
              save={(context) =>
                run({ op: "project.context", id: project.id, context })
              }
              submitLabel={t("保存项目默认设置")}
            />
          )}
        </>
      )}
    </>
  );
}

export function TemplateManager({
  templates,
  run,
}: {
  templates: AnalysisTemplate[];
  run: Run;
}) {
  const [selected, setSelected] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState(templates[0]?.name ?? "");
  const [requirements, setRequirements] = useState(
    templates[0]?.requirements ?? "",
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const template = templates.find((t) => t.id === selected);
  const readonly = !!template?.builtin;
  const dirty =
    name !== (template?.name ?? "") ||
    requirements !== (template?.requirements ?? "");
  const choose = (t?: AnalysisTemplate) => {
    setSelected(t?.id ?? "");
    setName(t?.name ?? "");
    setRequirements(t?.requirements ?? "");
    setMessage("");
    setDeleting(false);
  };
  return (
    <section className="template-manager">
      <div className="dialog-heading">
        <span className="eyebrow">ANALYSIS TEMPLATES</span>
        <h2>{t("分析模板")}</h2>
        <p>{t("定义纪要的组织方式，让不同会议有适合的输出。")}</p>
      </div>
      <div className="template-layout">
        <nav className="template-list" aria-label={t("模板列表")}>
          <button
            className="new-template"
            disabled={pending}
            onClick={() => choose()}
          >
            {t("＋ 新建模板")}
          </button>
          {[true, false].map((builtin) => (
            <div key={String(builtin)}>
              <div className="template-group-label">
                {builtin ? t("内置模板") : t("我的模板")}
              </div>
              {templates
                .filter((t) => !!t.builtin === builtin)
                .map((t) => (
                  <button
                    key={t.id}
                    disabled={pending}
                    className={`template-item ${selected === t.id ? "selected" : ""}`}
                    onClick={() => choose(t)}
                    aria-pressed={selected === t.id}
                  >
                    <strong>{templateName(t)}</strong>
                    <span>{t.requirements}</span>
                  </button>
                ))}
              {!builtin && !templates.some((t) => !t.builtin) && (
                <p className="template-empty">
                  {t("复制内置模板，或创建自己的模板。")}
                </p>
              )}
            </div>
          ))}
        </nav>
        <form
          className="template-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (readonly || pending) return;
            setPending(true);
            setMessage("");
            try {
              const saved = await run({
                op: "template.save",
                id: template?.id,
                name,
                requirements,
              });
              choose(saved);
              setMessage(t("模板已保存"));
            } catch (error) {
              setMessage((error as Error).message);
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="editor-heading">
            <h3>
              {readonly
                ? t("模板预览")
                : template
                  ? t("编辑模板")
                  : t("新建模板")}
            </h3>
            <span className="template-badge">
              {readonly ? t("内置 · 只读") : t("自定义")}
            </span>
          </div>
          <label>
            {t("模板名称")}
            <input
              aria-label={t("模板名称")}
              required
              maxLength={200}
              readOnly={readonly}
              value={readonly && template ? templateName(template) : name}
              placeholder={t("例如：研发周会")}
              onChange={(e) => {
                setName(e.target.value);
                setMessage("");
              }}
            />
          </label>
          <label>
            {t("自然语言输出要求")}
            <textarea
              aria-label={t("自然语言输出要求")}
              required
              maxLength={20000}
              readOnly={readonly}
              rows={9}
              value={
                readonly && template
                  ? templateRequirements(template)
                  : requirements
              }
              placeholder={t("描述希望包含的章节、分组方式和内容详略…")}
              onChange={(e) => {
                setRequirements(e.target.value);
                setMessage("");
              }}
            />
          </label>
          <p className="form-hint">
            {readonly
              ? t("复制后即可自由编辑，内置模板会保留。")
              : t(
                  "模板决定内容组织方式。每项结论仍需通过事实核对，修改不影响历史分析。",
                )}
          </p>
          <div className="template-actions">
            {template && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  choose();
                  setName(templateName(template) + t(" 副本"));
                  setRequirements(templateRequirements(template));
                }}
              >
                {t("复制")}
              </button>
            )}
            {template && !readonly && (
              <button
                type="button"
                className="danger-quiet"
                disabled={pending}
                onClick={() => setDeleting(!deleting)}
              >
                {t("删除")}
              </button>
            )}
            {!readonly && (
              <button
                className="primary"
                disabled={
                  pending || !name.trim() || !requirements.trim() || !dirty
                }
              >
                {pending
                  ? t("保存中…")
                  : template
                    ? t("保存模板修改")
                    : t("创建自定义模板")}
              </button>
            )}
          </div>
          {deleting && (
            <div className="delete-confirm">
              <p>
                {t("删除「")}
                {template?.name}
                {t("」？历史分析会保留，使用此模板的会议需要重新选择。")}
              </p>
              <div>
                <button type="button" onClick={() => setDeleting(false)}>
                  {t("取消")}
                </button>
                <button
                  type="button"
                  className="danger-quiet"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await run({ op: "template.delete", id: selected });
                      choose(templates[0]);
                      setMessage(t("模板已删除"));
                    } catch (error) {
                      setMessage((error as Error).message);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {t("确认删除")}
                </button>
              </div>
            </div>
          )}
          <div className="save-status" role="status">
            {localizeMessage(message ?? "")}
            {dirty && !message && !readonly ? t("有未保存的修改") : ""}
          </div>
        </form>
      </div>
    </section>
  );
}
