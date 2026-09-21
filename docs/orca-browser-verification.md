# Orca 浏览器实测（2026-09-04）

由独立 subagent 使用 Orca CLI 的 terminal、tab、snapshot、click、fill、eval、console、screenshot 命令完成。未使用 mock 或 Playwright 替代浏览器交互。

## 启动与数据隔离

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-browser.ps1` 在 Orca 管理终端内启动 `npm run dev`，运行真实 Electron 主进程、SQLite、音频文件和 Services。浏览器加载同一构建后的 React 界面，通过仅开发模式开启的本地 HTTP 传输调用同一业务 dispatch。

默认独立库：`%LOCALAPPDATA%/MeetingRecorder-dev-browser`。启动参数 `-JulyAudio` 与 `-AugustAudio` 可显式授权两个 MP4 文件，开发导入 API 只接受 `july` / `august` 枚举，不接受任意文件路径。原始录音文件没有修改。

桥接仅监听 `127.0.0.1` 的随机端口，使用每次启动重新生成的 256 位令牌、HttpOnly/SameSite=Strict cookie，并校验 Host 和 Origin。端口和本地凭据保存在该独立目录的 `dev-bridge.json`；不得提交或公开该文件。正常安装包即使设置环境变量也不开放此桥接。

## 已验证

- 从源码构建成功，最终一次执行的 13 项 Node 自动测试通过。
- Orca 界面创建「真实会议验证」项目及会议成功，持久化数据可由真实 API 读回。
- 两份用户指定录音分别复制进独立库中的 VibeVoice 待转录会议；另建两场明确标记「已有 Meetily 转录 · 分析验证」的会议，分别导入来源目录原有的 452 / 216 段转录。已有转录不计入 VibeVoice 验收。
- 通过界面修改已有转录的说话人显示名并保存，版本 v1 → v2。
- 点击 August 已有转录第一段「回听」后，真实音频 currentTime 持续增长、paused=false、无 media error；媒体时长 1860.021333 秒。随后通过媒体控件暂停。
- 从界面点击「生成分析」，真实 vLLM 后台任务完成 4 批，生成 18 条结果、57 项证据。逐一核对全部 segmentId 存在、quote 是对应原文子串，无失效引用。分析服务为用户明确配置的私网端点；公开记录省略实际地址和模型目录。
- 点击分析「原文」依据后回到转录页并从约 59 秒开始回听。通过 Orca eval 定位真实 React 按钮确认一项建议，按钮变成禁用的「已确认」，正式项目记录和其依据在项目追踪页出现。
- 修复导入历史会议日期：独立 `occurredAt` 字段用于显示、排序和检索，保留 `created` 入库时间。四场测试会议按源 metadata 设置发生时间；Orca 实测列表及编辑表单均显示对应的本地会议时间；公开记录省略真实会议日期和时区。
- 无凭据、错误 Origin、错误 Host 的 API 请求均返回 HTTP 403。
- 此轮 Orca console 返回空消息列表。已查看真实界面截图，布局、任务进度和播放器显示正常。
- 单场真实问答首次暴露输出截断：向 August 已有转录会议询问项目待办，数分钟后界面明确显示「模型输出被截断，请提高预算或使用更小批次」。应用未展示不完整回答。
- 修复后重启源码，并通过 Orca 重试完全相同的问题（未缩小问题）：问答成功，覆盖 131 个候选片段、5 批处理，显示 6 个原文依据按钮，无错误。浏览器中读取真实会议状态核对 6 个 quote 均是原文子串，正文 24 次片段 ID 引用均存在。点击首依据跳转到转录 v2，并从约 66 秒处回听真实音频。此复验截图保存在本地独立库 `orca-qa-retest.png`。

截图仅保存在本地独立库 `orca-analysis.png`，含私密会议预览，不提交仓库或公开分享。

## 当前限制与发现

### 真正 VibeVoice 结果的后续验收状态

August 真实 VibeVoice 转录已完成 254 段，并由独立分析任务产生 15 项结果、42 个引用。通过真实主进程 HTTP 接口独立核对：42 个片段引用全部存在且 quote 属于对应原文。该会议与已有 Meetily 转录分属不同会议，后续移动到独立「VibeVoice真实录音验收」项目。

开始对这一真实 ASR 结果做界面验收时，Orca browser automation 的 `snapshot`、`eval`、`reload` 返回 `runtime_unavailable`（runtime closed connection）。`tab list`、创建新页、切换页仍能响应，但新页的 `snapshot` / `goto` 也失败。查阅本机版本的完整 CLI guide、`orca --help` 和 `orca agent-context --json` 未发现仅重启浏览器 runtime 的公共命令；未重启整个 Orca，以保留仍在运行的 July 转录任务。

因此，上文已通过的回听、分析、问答界面验收使用的是明确标记的已有 Meetily 转录；不能把这些结果等同于此次真实 VibeVoice 输出的界面验收。真实 VibeVoice 的数据与分析 HTTP 验证已通过，浏览器复验需待 Orca 自动化连接恢复后继续。

两场真实 ASR 完成后又进行了一轮最终浏览器复试：仅通过 Orca terminal 重启会议软件源码以加载最新服务修复，保留原测试库、没有重启整个 Orca。`goto` 能返回新页面 URL/title，但随后的 `snapshot` / `eval` 仍以相同 `runtime_unavailable` 结束。因此未将这轮真实 ASR 界面验收标为通过，也未改用 Playwright 代替用户指定的 Orca browser control。显存压力是否造成该平台故障未被证实。

- Orca 浏览器覆盖的是同一界面与真实主进程业务；不能代替 Electron 原生麦克风／系统声音权限、原生文件对话框或 Mac 实机验收。
- 原有 Meetily August 最后一段到约 1873 秒，而媒体约 1860 秒，存在来源转录超尾；不能归因于 VibeVoice。
- 本轮证明引用结构与出处有效，不等于完成对每条推断的人工语义审核或 90% 召回率验收。
- 问答目前只有等待提示，没有分批进度或取消控件，真实长请求的等待体验需要改善。
- 本轮尚不将真实 VibeVoice 推理准确率、长会议性能及完整 P0–P3 标记为通过。
