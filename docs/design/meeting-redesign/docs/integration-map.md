# 原项目接入映射与差异

核对基线：`meeting-recorder` 0.1.9；具体 commit 和关键文件哈希见包根目录 `source-baseline.json`。接手后重新读取当前仓库，以下行号仅帮助定位，不作为固定补丁锚点。

## 真实接入入口

- `src/main.tsx`：当前 `App`、会议列表、项目记录、`Transcript`、`AnalysisPanel`、`AskPanel`、`SettingsPanel`。
- `src/style.css`：当前界面样式，迁移时逐步替换或分层，避免同时保留冲突的旧样式。
- `src/RecordPanel.tsx`、`src/recorder.ts`、`src/screen-recorder.ts`：录制设备、权限、采集与数据落盘调用链。
- `src/Configuration.tsx`：`ContextEditor`、`ProjectDefaults`、`TemplateManager`。
- `src/VideoPanel.tsx`、`src/MediaFiles.tsx`：关键画面与原始媒体入口。
- `shared/types.ts`：`State`、`Meeting`、`Analysis`、`RecordItem`、`RequestSchema`、`Bridge` 的事实来源。
- `electron/preload.ts` 与 `electron/main.ts`：现有隔离桥与桌面请求处理。前端通过 `window.meeting.invoke(request)` 调用真实能力。

设计稿是五个独立 HTML；正式桌面应用可以继续在现有 React 根中使用视图状态或适合仓库的路由。独立入口与导航属于前端组织调整，不需要建立第二套业务数据库。

## 页面与请求对应

| 页面 / 操作 | 现有入口或请求 | 落地要求 |
| --- | --- | --- |
| 全局数据 / 会议库 | `state`，`src/main.tsx` App | 使用真实 `State`；沿用或完善现有刷新生命周期 |
| 新建 / 编辑会议 | `meeting.create` / `meeting.update` | 使用 UUID、`projectId` 与带时区的 `occurredAt` |
| 新建项目 | `project.create` | 项目以 ID 关联，不能用名称作主键 |
| 导入音频 / 录像 | `audio.import` | 原应用已统一媒体导入，不用浏览器 Blob 替代库中文件 |
| 查看 / 定位媒体文件 | `media.location` / `media.reveal` | 保留原始文件、麦克风、系统音轨及待恢复文件入口 |
| 纯录音 | `RecordPanel`、`Recorder`；`record.start/chunk/stop` | 复用原采集、采样时钟、分块顺序和停止保存流程 |
| 录屏 | `ScreenRecorder`；`screen.sources/select/start/chunk/stop/recover` | 保留窗口选择、系统声音、整理状态与异常恢复 |
| 转录 / 说话人统一 / 分析 / 画面识别 | `job.start`；对应 `kind` | 显示真实任务状态、步骤与错误，不能假进度完成 |
| 重试 / 取消 | `job.retry` / `job.cancel` | 复用原任务，避免重复创建会议或丢失已保存媒体 |
| 校对原文 | `transcript.save` / `transcript.import` | 保存 segments、version 和 speakers；保留 segment ID |
| 姓名展示 | `shared/speakers.ts` 与 `Meeting.speakers` | 使用原有姓名映射，不把显示名写成新的说话人身份 |
| 会议背景 / 项目默认值 | `meeting.context` / `project.context` / `meeting.reloadDefaults` | 区分会议覆盖值与项目默认值 |
| 模板管理 | `template.save` / `template.delete` | 使用 `templateId`；保留内置模板语义与删除规则 |
| 会议纪要 | `AnalysisPanel` / `Meeting.analyses` | 支持版本选择、递归 `sections.children` 和逐项引用 |
| 人工纪要 | `analysis.notes` | 关联 `analysisId`，不要覆盖原始模型输出或转录 |
| 原文 / 画面引用 | `evidence.resolve` | 通过真实 evidence 解析历史版本和媒体时间；不用数组下标当引用 ID |
| 加入项目记录 | `proposal.accept` | 请求含 meeting ID、analysis ID 和 claim index；保留版本及事实校验 |
| 项目追踪 | `State.records`，当前 main.tsx 约 720 行 | 正式记录按项目过滤，历史和 evidence 都要保留 |
| 有据问答 | `ask` | 使用真实范围、日期、`Answer.text/evidence/coverage` |
| 手动提取 / 重识别 / 排除画面 | `video.frame.add/refresh/exclude` | 复用 `VideoPanel` 与真实画面文件；保留 revision 和排除状态 |
| 保存 / 测试服务 | `settings.save` / `settings.test` / `settings.testVision` | 密钥继续通过原主进程处理；保留文本与画面发送许可 |
| 导出 | `export`，md / srt，可选 `analysisId` | 使用原 `electron/export.ts`，保留版本与字幕时间精度 |
| 备份 / 恢复 | `backup` / `restore` | 使用现有完整库备份、校验、切换和恢复机制 |

## 数据结构不能直接照搬原型

| 原型形态 | 正式应用形态 |
| --- | --- |
| `sample`、`meeting-时间戳` 等字符串 | 原项目生成并验证的 UUID |
| `meeting.project` 名称 | `meeting.projectId` 对应 `State.projects` |
| 本地 `date` 字符串 | `occurredAt` 的带时区日期；界面负责正确转换 |
| `meeting.notes` | 特定 `Analysis.editedNotes`，通过 `analysis.notes` 保存 |
| 直接改 `segment.speaker` 显示姓名 | 保留来源身份，使用 `Meeting.speakers` 与现有显示工具 |
| 模板名称作为选择值 | 持久化模板 ID 与 `MeetingContext` |
| 只有摘要、决策、待办三个固定分区 | 支持原项目的递归分析章节、讨论建议、参数引用和历史版本 |
| 中文 `进行中/已完成` 状态 | `RecordItem.status` 的 `open/complete/replaced`；中文仅展示映射 |
| 浏览器直接读 Blob / Canvas | 已有 `meeting://audio/…` 与 `meeting://frames/…` 等桌面协议及 IPC |
| localStorage / IndexedDB 原型库 | 原项目 SQLite / 媒体目录；只允许另行设计纯界面偏好存储 |

原型的待确认建议只有两条；正式版应从所选项目相关会议的适用分析中派生建议，并保留 meeting ID、analysis ID、claim index。不能仅按 `kind` 去重，也不能把全部历史分析重新混入待确认集合。确认后刷新真实状态。

## 已确认的能力差异及首批处理

### 1. 手动编辑正式记录

原型允许直接改负责人、期限与状态，并写入演示历史。核对的 `RequestSchema` 没有独立的 `record.update` 请求；原界面展示正式记录与变更历史。

首批迁移保留已有的只读记录详情、原文引用和历史查看。不要构造不存在的请求，或用前端本地状态假装更新成功。新增记录编辑应另提业务扩展范围，包含 typed IPC、输入校验、存储事务、历史与证据规则、测试。

### 2. 确认前改写负责人和期限

`proposal.accept` 只接收 `id`、`analysisId`、`index`，没有原型表单里的 `owner` / `due` 字段。

首批确认弹窗展示实际分析字段及引用，保留当前可用的确认流程。未明确的信息如实展示。直接编辑提案字段的能力单独列为差异，不绕过现有事实审核。

### 3. 原型中的问答与备份

示例问答是固定的测试材料回应；JSON 备份仅包含原型状态。正式应用必须切回真实 `ask`、`backup`、`restore`，并保留当前完整库备份的媒体和恢复语义。

### 4. 全局导航与真实规模

原应用的项目追踪、问答等内容位于当前会议的 tabs 中；新设计将其提升为独立导航。需要显式定义项目和会议上下文，处理未选择会议、未归入项目以及多个项目，不将全局页永久绑定到示例项目。

原型只有三段短转录，未证明长会议和大量条目的性能。正式版需检查真实长文本、递归周会章节、关键画面、连续播放以及列表规模。
