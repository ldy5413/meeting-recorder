import { t, setUiLanguage } from "./i18n";
import { useState } from "react";
import type { Request, State } from "../shared/types";
import type { ReportLanguage } from "../shared/language";
export function ReportLanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value?: ReportLanguage;
  onChange: (value: ReportLanguage) => void;
  disabled?: boolean;
}) {
  return (
    <label>
      {t("报告语言")}
      <select
        aria-label={t("报告语言")}
        disabled={disabled}
        value={value ?? "auto"}
        onChange={(e) => onChange(e.target.value as ReportLanguage)}
      >
        <option value="auto">{t("跟随音频主语言")}</option>
        <option value="zh-CN">{t("简体中文")}</option>
        <option value="en">English</option>
      </select>
      <small>{t("仅影响新生成的报告。原文和证据引用保留原始语言。")}</small>
    </label>
  );
}
export function LanguageSettings({
  state,
  run,
}: {
  state: State;
  run: (r: Request) => Promise<any>;
}) {
  const [saving, setSaving] = useState(false);
  const save = async (changes: Partial<State["settings"]>) => {
    if (saving) return;
    setSaving(true);
    const settings = { ...state.settings, ...changes };
    try {
      await run({ op: "settings.save", settings });
      setUiLanguage(settings.uiLanguage, state.systemLocale);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="settings-section">
      <h2>{t("语言")}</h2>
      <label>
        {t("界面语言")}
        <select
          aria-label={t("界面语言")}
          disabled={saving}
          value={state.settings.uiLanguage ?? "system"}
          onChange={(e) => {
            void save({
              uiLanguage: e.target.value as State["settings"]["uiLanguage"],
            }).catch(() => {});
          }}
        >
          <option value="system">{t("跟随系统")}</option>
          <option value="zh-CN">{t("简体中文")}</option>
          <option value="en">English</option>
        </select>
      </label>
      <ReportLanguageSelect
        disabled={saving}
        value={state.settings.defaultReportLanguage}
        onChange={(defaultReportLanguage) => {
          void save({ defaultReportLanguage }).catch(() => {});
        }}
      />
      <p className="muted">
        {t(
          "报告默认语言用于新项目和无项目的新会议。已有会议可在分析设置中调整，或重新载入项目默认值。",
        )}
      </p>
      <p className="muted">
        {t("问答跟随提问语言，也可在问题中指定回答语言。")}
      </p>
    </section>
  );
}
