import { t } from "./i18n";
import type { Meeting, State } from "../shared/types";

export const durationOf = (meeting: Meeting) =>
  meeting.segments.reduce((end, segment) => Math.max(end, segment.end), 0);
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
export const inProject = (meeting: Meeting, project: string) =>
  !project ||
  (project === "unassigned"
    ? !meeting.projectId
    : meeting.projectId === project);
export function meetingStatus(meeting: Meeting, jobs: State["jobs"]) {
  if (meeting.status === "recording")
    return { text: t("录制中"), tone: "pending" };
  if (meeting.capture?.status === "finalizing")
    return { text: t("整理录像中"), tone: "pending" };
  if (meeting.capture?.status === "failed")
    return { text: t("录像待恢复"), tone: "failed" };
  const tasks = jobs.filter((j) => j.meetingId === meeting.id);
  const active = tasks.find(
    (j) => j.status === "running" || j.status === "queued",
  );
  if (active)
    return {
      text: active.status === "queued" ? t("排队中") : t("处理中"),
      tone: "pending",
    };
  if (tasks.at(-1)?.status === "failed")
    return { text: t("处理失败"), tone: "failed" };
  if (tasks.at(-1)?.status === "cancelled")
    return { text: t("任务已取消"), tone: "pending" };
  if (meeting.status === "interrupted")
    return { text: t("录制曾中断"), tone: "pending" };
  if (meeting.analyses.length) return { text: t("已有纪要"), tone: "ready" };
  if (meeting.segments.length) return { text: t("已有转录"), tone: "ready" };
  return {
    text: meeting.audio ? t("待转录") : t("待录制 / 导入"),
    tone: "pending",
  };
}
export function pendingProposals(state: State, project: string) {
  return state.meetings
    .filter((m) => !m.deletedAt && !!m.projectId && inProject(m, project))
    .flatMap((meeting) => {
      const analysis = meeting.analyses.at(-1);
      if (
        !analysis ||
        analysis.version !== meeting.version ||
        (analysis.visual &&
          analysis.visual.revision !== meeting.video?.revision)
      )
        return [];
      return analysis.claims.flatMap((claim, index) =>
        ["todo", "decision"].includes(claim.kind) &&
        !analysis.acceptedIndices?.includes(index) &&
        (!claim.targetId ||
          !analysis.recordVersions ||
          state.records.some(
            (r) =>
              r.id === claim.targetId &&
              r.projectId === meeting.projectId &&
              analysis.recordVersions![r.id] === r.version,
          ))
          ? [{ meeting, analysis, claim, index }]
          : [],
      );
    });
}
