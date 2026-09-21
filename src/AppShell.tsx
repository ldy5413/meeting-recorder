import { t } from "./i18n";
import type { ReactNode } from "react";
import type { State } from "../shared/types";

export type Page = "library" | "meeting" | "tracking" | "ask" | "settings";
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    note: "M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5",
    library: "M3 4h5v16H3z M12 4h3v16h-3z M19 4h2v16h-2z",
    project: "M3 7h7l2-3h9v16H3z",
    check: "m4 12 5 5L20 6",
    search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
    settings: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
    template: "M3 3h18v18H3z M3 8h18 M9 8v13",
    database:
      "M4 6c0-4 16-4 16 0s-16 4-16 0v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0",
    arrow: "M4 12h16 m-6-6 6 6-6 6",
    upload: "M12 16V3 m-5 5 5-5 5 5 M4 14v7h16v-7",
    plus: "M12 4v16 M4 12h16",
    menu: "M3 6h18 M3 12h18 M3 18h18",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.note} />
    </svg>
  );
}

export function Sidebar({
  state,
  page,
  project,
  navigate,
  chooseProject,
  create,
  open,
  expanded,
  closeMenu,
}: {
  state: State;
  page: Page;
  project: string;
  navigate: (page: Page) => void;
  chooseProject: (id: string) => void;
  create: () => void;
  open: (modal: string) => void;
  expanded: boolean;
  closeMenu: () => void;
}) {
  return (
    <aside className={`sidebar ${expanded ? "mobile-open" : ""}`}>
      <button
        className="mobile-close icon-btn"
        aria-label={t("关闭导航")}
        onClick={closeMenu}
      >
        ×
      </button>
      <button className="brand" onClick={() => navigate("library")}>
        <span className="brand-mark">
          <Icon name="note" />
        </span>
        {t("会议手记")}
      </button>
      <div className="workspace-label">{t("个人工作区")}</div>
      <button className="primary new" onClick={create}>
        {t("＋ 新建会议")}
      </button>
      <nav className="nav-group" aria-label={t("主要导航")}>
        <button
          className={`nav-item ${page === "library" && !project ? "active" : ""}`}
          aria-current={page === "library" && !project ? "page" : undefined}
          onClick={() => chooseProject("")}
        >
          <Icon name="library" />
          {t("会议库")}
          <span className="count num">{state.meetings.length}</span>
        </button>
        <button
          className={`nav-item ${page === "tracking" ? "active" : ""}`}
          aria-current={page === "tracking" ? "page" : undefined}
          onClick={() => navigate("tracking")}
        >
          <Icon name="check" />
          {t("项目追踪")}
        </button>
        <button
          className={`nav-item ${page === "ask" ? "active" : ""}`}
          aria-current={page === "ask" ? "page" : undefined}
          onClick={() => navigate("ask")}
        >
          <Icon name="search" />
          {t("有据问答")}
        </button>
      </nav>
      <nav className="nav-group project-nav" aria-label={t("项目")}>
        <div className="nav-label">{t("项目")}</div>
        {state.projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${page === "library" && project === p.id ? "active" : ""}`}
            onClick={() => chooseProject(p.id)}
            title={p.name}
          >
            <Icon name="project" />
            <span className="nav-name">{p.name}</span>
          </button>
        ))}
        <button
          className={`nav-item ${page === "library" && project === "unassigned" ? "active" : ""}`}
          onClick={() => chooseProject("unassigned")}
        >
          <Icon name="note" />
          {t("未归入项目")}
        </button>
        <button className="nav-item" onClick={() => open("project")}>
          <Icon name="plus" />
          {t("新建项目")}
        </button>
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => open("templates")}>
          <Icon name="template" />
          {t("分析模板")}
        </button>
        <button
          className="nav-item project-default-link"
          onClick={() => open("defaults")}
        >
          <Icon name="project" />
          {t("项目默认设置")}
        </button>
        <button
          className={`nav-item ${page === "settings" ? "active" : ""}`}
          aria-label={t("服务与备份")}
          onClick={() => navigate("settings")}
        >
          <Icon name="settings" />
          {t("设置与备份")}
        </button>
        <div className="profile">
          <span className="avatar">{t("我")}</span>
          <div>
            <strong>{t("个人空间")}</strong>
            <small>{t("本地会议库 · 数据保存在本机")}</small>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function WorkspaceHeader({
  page,
  menu,
  search,
  expanded,
  version,
}: {
  page: Page;
  menu: () => void;
  search: () => void;
  expanded: boolean;
  version?: string;
}) {
  const names: Record<Page, string> = {
    library: t("会议库"),
    meeting: t("会议详情"),
    tracking: t("项目追踪"),
    ask: t("有据问答"),
    settings: t("设置"),
  };
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <button
          className="icon-btn mobile-nav"
          aria-label={t("打开导航")}
          aria-expanded={expanded}
          onClick={menu}
        >
          <Icon name="menu" />
        </button>
        <span className="crumb-project">{t("个人工作区")}</span>
        <span>/</span>
        <strong>{names[page]}</strong>
      </div>
      <div className="topbar-end">
        <details
          className="about-menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.open = false;
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              event.currentTarget.open = false;
          }}
        >
          <summary>{t("关于")}</summary>
          <div className="about-content">
            <strong>{t("会议手记")}</strong>
            <p>Meeting Recorder</p>
            <p className="app-version">
              {t("版本")} {version ? `v${version}` : t("版本未知")}
            </p>
            <p>{t("录制会议、提炼纪要，按依据追溯结论。")}</p>
          </div>
        </details>
        <span className="local-label row">
          <Icon name="database" />
          {t("本地优先")}
        </span>
        <button
          className="icon-btn"
          aria-label={t("搜索会议 Ctrl K")}
          onClick={search}
        >
          <Icon name="search" />
        </button>
      </div>
    </header>
  );
}

export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </header>
  );
}
