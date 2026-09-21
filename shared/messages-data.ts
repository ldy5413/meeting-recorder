/** Source-language message IDs; never use translated values as business identifiers. */
export const messages = {
  "模型按语言下载一次，升级后继续使用。首次转写会自动下载，也可在此提前下载；下载不发送录音，完成后可离线转写。":
    "Download each language once and keep it across upgrades. The first transcription downloads automatically, or download here in advance. No recordings are sent; transcription works offline after download.",
  "中文 · Qwen3": "Chinese · Qwen3",
  "英文 · SenseVoice": "English · SenseVoice",
  未下载: "Not downloaded",
  已下载: "Downloaded",
  等待下载: "Waiting to download",
  检查本地模型: "Checking local models",
  正在下载: "Downloading",
  下载失败: "Download failed",
  下载已暂停: "Download paused",
  暂停下载: "Pause download",
  下载模型: "Download model",
  "继续下载 / 重试": "Resume / Retry",
  "下载语音模型 {p0}%（{p1}/{p2} MB）":
    "Downloading speech models {p0}% ({p1}/{p2} MB)",
  "语音模型下载失败，请检查网络后重试：{p0}":
    "Speech model download failed. Check your connection and retry: {p0}",
  模型下载已取消: "Model download cancelled",
  模型下载超时: "Model download timed out",
  模型完整性校验失败: "Model checksum mismatch",
  模型下载未完成: "Model download incomplete",
  模型文件大小不一致: "Model size mismatch",
  模型文件写入失败: "Failed to write model file",
  模型下载范围不一致: "Model download range mismatch",
  本地模型目录未配置: "Local model directory is not configured",
  "本地转写目前仅支持 Windows":
    "Local transcription currently supports Windows only",
  "本地转写组件不完整，请重新安装应用":
    "Local transcription components are incomplete. Reinstall the application.",
  转写语言: "Transcription language",
  英文: "English",
  "中文（含中英混说）": "Chinese (including mixed Chinese/English)",
  转写方式: "Transcription mode",
  内置本地转写: "Built-in local transcription",
  外部转写服务: "External transcription service",
  "本地转写无需单独启动服务，录音保留在本机。":
    "Local transcription starts automatically and keeps recordings on this computer.",
  "中文使用 Qwen3，英文使用 SenseVoice。请在会议中选择转写语言；纪要和问答仍使用下方分析服务。":
    "Chinese uses Qwen3 and English uses SenseVoice. Choose the transcription language in each meeting; summaries and questions still use the analysis service below.",
  "本地转写不发送音频。分析与问答会向配置的分析服务发送相关转录、背景、关键词和项目记录。":
    "Local transcription does not send audio. Analysis and questions send relevant transcripts, context, keywords and project records to your configured analysis service.",
  "这段识别结果过短，请回听核对。":
    "This recognition result is unusually short. Listen and review it.",
  "本地转写组件不完整，请重新安装包含语音模型的版本":
    "Local transcription components are incomplete. Reinstall the version containing speech models.",
  等待本机转写队列: "Waiting for the local transcription queue",
  在本机准备音频: "Preparing audio locally",
  校验本地语音模型: "Verifying local speech models",
  加载中文转写模型: "Loading the Chinese speech model",
  加载英文转写模型: "Loading the English speech model",
  本机识别说话人: "Identifying speakers locally",
  "本机识别说话人 {p0}%": "Identifying speakers locally {p0}%",
  "本机统一说话人 {p0}/{p1}": "Reconciling local speakers {p0}/{p1}",
  "本机转写 {p0}%": "Transcribing locally {p0}%",
  "本地转写失败 ({p0})：{p1}": "Local transcription failed ({p0}): {p1}",
  "定位 {p0} 的第一段发言": "Go to {p0}'s first turn",
  "实际发言人数（可选）": "Number of people who spoke (optional)",
  "待确认发言（{p0} 段）": "Turns to review ({p0})",
  自动: "Auto",
  "留空自动识别；人数仅作参考，声音不清晰的片段仍会标为待确认。":
    "Leave blank to detect automatically. The count is a guide; unclear turns will remain unconfirmed.",
  "已识别 {p0} 位说话人，另有 {p1} 段发言待确认；待确认标签不代表新增参会者。":
    "{p0} speakers identified; {p1} turns need review. Unconfirmed labels do not represent additional participants.",
  "实际发言人数须为 1–50 的整数，且仅用于统一说话人":
    "The speaker count must be an integer from 1 to 50 and is only available for speaker reconciliation",
  "转录服务尚不支持指定发言人数，请更新并重启转录服务":
    "The transcription service does not support a speaker count yet. Update and restart it",
  关于: "About",
  版本: "Version",
  版本未知: "Version unavailable",
  "录制会议、提炼纪要，按依据追溯结论。":
    "Record meetings, summarize the discussion and trace conclusions to their sources.",
  删除会议: "Delete meeting",
  恢复会议: "Restore meeting",
  最近删除: "Recently deleted",
  删除时间: "Deleted",
  没有已删除的会议: "No deleted meetings",
  会议已移到最近删除: "Meeting moved to Recently deleted",
  "会议将移到最近删除，不再出现在会议库和问答检索中。":
    "The meeting will move to Recently deleted and be excluded from the meeting library and Q&A search.",
  "音视频、纪要与原文保留，可随时恢复；已确认的项目记录及其依据不受影响。此操作不释放磁盘空间。":
    "Media, minutes and transcripts are retained for restoration. Confirmed project records and their sources remain available. This does not free disk space.",
  "此会议已移到最近删除，原文依据仍可查看。":
    "This meeting is in Recently deleted. Its source evidence remains available.",
  "会议已删除，请先从最近删除中恢复":
    "This meeting has been deleted. Restore it from Recently deleted first.",
  "请先结束此会议的录制和后台任务，再删除会议":
    "Finish this meeting's recording and background tasks before deleting it.",
  全场提炼: "Whole-meeting synthesis",
  "确定会议重点 {p0}/{p1}": "Selecting meeting priorities {p0}/{p1}",
  全场总览: "Meeting overview",
  详细分析: "Detailed analysis",
  纪要版本: "Minutes version",
  纪要导出范围: "Minutes export scope",
  仅导出纪要: "Minutes only",
  包含详细分析与证据: "Include detailed analysis and evidence",
  "导出纪要 Markdown": "Export minutes as Markdown",
  "查看依据（{p0} 条详细分析）": "View supporting details ({p0})",
  "详细分析中没有通过审核的事实条目。":
    "The detailed analysis contains no approved factual items.",
  把整场会议的重点放在一起: "Bring the meeting's key points together",
  "基于已有详细分析归并议题，按模板提炼结果与下一步。":
    "Combine topics from the detailed analysis and use your template to summarize outcomes and next steps.",
  提炼设置: "Synthesis settings",
  纪要模板: "Minutes template",
  沿用详细分析语言: "Use the detailed analysis language",
  本次提炼重点: "Focus for these minutes",
  "例如：重点说明讨论结果、分歧和下一步，技术参数按需保留。":
    "For example: focus on outcomes, disagreements and next steps; retain technical parameters where needed.",
  "重新提炼会保留已有纪要版本，复用此份详细分析。":
    "Regeneration reuses this detailed analysis and keeps earlier minutes versions.",
  重新提炼纪要: "Regenerate minutes",
  生成全场纪要: "Generate meeting minutes",
  报告阅读方式: "Report view",
  "归并全场议题 {p0}/{p1}": "Combining meeting topics {p0}/{p1}",
  按模板提炼全场纪要: "Writing meeting minutes with the template",
  "核对纪要依据 {p0}/{p1}": "Checking minutes evidence {p0}/{p1}",
  "检查全场内容覆盖 {p0}/{p1}": "Checking meeting coverage {p0}/{p1}",
  提炼全场纪要: "Synthesizing meeting minutes",
  请先完成详细分析: "Complete the detailed analysis first",
  详细分析不存在: "Detailed analysis not found",
  "详细分析已过期，请先重新分析再提炼纪要":
    "The detailed analysis is out of date. Reanalyze before generating minutes.",
  "纪要来源已改变，请重新分析后提炼":
    "The source changed. Reanalyze before generating minutes.",
  "全场提炼上下文预算不足，请提高预算或缩短模板与背景":
    "The synthesis context budget is too small. Increase it or shorten the template and background.",
  "扫描画面变化 {p0}%": "Scanning visual changes {p0}%",
  "保存清晰画面 {p0}/{p1}": "Saving full-resolution frames {p0}/{p1}",
  校验声纹模型: "Checking speaker model",
  准备声纹音频: "Preparing speaker audio",
  "提取声纹 {p0}/{p1}": "Extracting speaker embeddings {p0}/{p1}",
  统一整场会议说话人: "Resolving speakers across the meeting",
  加载模型: "loading model",
  "转录分段 {p0}/{p1}": "chunk {p0}/{p1}",
  "转录分段 {p0}/{p1}（{p2}秒 + {p3}秒）": "chunk {p0}/{p1} ({p2}s + {p3}s)",
  "{p0}（{p1}/{p2}）": "{p0} ({p1}/{p2})",
  "模型输出被截断（本次上限 {p0} tokens{p1}）。可在服务设置提高最大输出长度和上下文预算；若启用了思考，可关闭后重试。已完成的步骤会保留。":
    "Model output was truncated (limit: {p0} tokens{p1}). Increase the output and context budgets, or disable thinking and retry. Completed steps are retained.",
  "，服务返回的思考内容也占用了输出":
    ", including reasoning returned by the service",
  "画面审核须为 supported=true 的每项明确填写 novel=true 或 false，判断是否提供了 existingClaims 中没有的信息":
    "Every supported visual claim must specify novel=true or false to indicate whether it adds information beyond existingClaims",
  "事实核对未完整覆盖所有分析条目，每个 allowedIndices 索引必须出现且只出现一次":
    "Fact checking must cover every allowedIndices entry exactly once",
  "每周周会必须按已确认姓名、原始说话人编号或未确认人员分组，人员章节不直接引用条目，子栏目使用本周进展、下周计划、阻塞与协助事项。":
    "Weekly meetings must group by confirmed names, original voice IDs or unconfirmed people. Person sections contain progress, plans and blockers subsections; they cannot directly reference claims.",
  "章节必须完整引用审核条目且不重复。合法索引为 0 到 {p0}；遗漏 {p1}；重复 {p2}；越界 {p3}。补齐遗漏，每个合法索引恰好一次。":
    "Sections must cover every reviewed claim exactly once. Valid indices: 0 to {p0}; missing: {p1}; duplicate: {p2}; out of range: {p3}.",
  "负责人 {p0} 是匿名说话人标签，不能作为已确认姓名；owner 应为 null，保留发言引用供核对":
    "Owner {p0} is an anonymous voice label, not a confirmed name. Set owner=null and keep the speech citation for review.",
  "负责人 {p0} 缺少归属依据：{p1}。负责人必须直接出现在引用原文中，或来自该片段的人工姓名映射且原片段包含我/I与本人承担任务的完整连续原文。引文应保留第一人称主语及行动，不能确认则 owner=null。":
    "Owner {p0} lacks attribution evidence: {p1}. The owner must appear in the quote or come from a reviewed speaker name with a complete first-person task commitment in the quote. Otherwise set owner=null.",
  "画面证据编号不存在：{p0} / {p1}。只选择此画面 evidenceSources 中的 id；合法编号：{p2}":
    "Visual evidence ID not found: {p0} / {p1}. Select only from this frame's evidenceSources. Valid IDs: {p2}",
  "无，此画面不在当前输入": "None; this frame is not in the current input",
  "周会 assignments 必须完整覆盖 allowedIndices，每个索引恰好一次。遗漏 {p0}；重复 {p1}；越界 {p2}。只输出 {assignments:[{index,person,column}]}，不删除已审核条目；person 只能选 allowedPeople 或 null，column 只能选 allowedColumns。":
    "Weekly assignments must cover each allowed index exactly once. Missing: {p0}; duplicate: {p1}; out of range: {p2}. Output only {assignments:[{index,person,column}]}; keep reviewed claims, select person from allowedPeople or null, and column from allowedColumns.",
  "参数引用缺少本条画面证据：{p0}；只能引用当前输入且已列入 evidence 的画面":
    "Parameter reference lacks matching frame evidence: {p0}. Reference only input frames already included in evidence.",
  "参数引用索引 {p0} 不存在：画面 {p1} 的合法索引为 {p2}":
    "Parameter index {p0} not found. Valid indices for frame {p1}: {p2}",
  "0-{p0}（从 0 开始）": "0–{p0} (zero based)",
  "无；本画面没有结构化参数": "None; this frame has no structured parameters",
  麦克风音轨: "Microphone track",
  系统声音音轨: "System audio track",
  待整理录像数据: "Video awaiting finalization",
  分析接口连接成功: "Analysis connection successful",
  "图片接口请求成功；实际小字与图表识别质量需用录像核对":
    "Vision request successful; verify small text and chart recognition with actual video",
  网络错误: "Network error",
  正在提取关键画面: "Extracting key frames",
  "无效请求，请检查输入内容": "Invalid request. Check the input values.",
  准备: "Preparing",
  磁盘未能写入录音: "Could not write audio to disk",
  "录音数据顺序不一致，已停止以保护已保存音频":
    "Audio chunks arrived out of order. Recording stopped to protect saved audio.",
  无效音频数据块: "Invalid audio chunk",
  "录音达到 WAV 文件容量上限": "Recording reached the WAV size limit",
  备份版本不兼容: "Incompatible backup version",
  备份包含非标准数据库对象: "Backup contains unsupported database objects",
  备份数据库损坏: "Backup database is corrupt",
  数据库版本不兼容: "Incompatible database version",
  备份缺少待恢复的录像数据: "Backup is missing video recovery data",
  备份录音缺失或路径无效: "Backup audio is missing or its path is invalid",
  备份画面缺失: "Backup frames are missing",
  备份记录标识不一致: "Backup record IDs are inconsistent",
  分析版本不存在: "Analysis version not found",
  "请先结束录音，并等待后台任务和文件操作结束":
    "Stop recording and wait for background tasks and file operations to finish",
  "正在导入或提取此会议的媒体，请稍后重试":
    "Media import or extraction is in progress. Retry later.",
  请先结束此会议的后台任务: "Finish this meeting's background tasks first",
  "正在备份或恢复，请稍后": "Backup or restore in progress. Please wait.",
  "已有正式项目记录，不能迁移会议":
    "This meeting has confirmed project records and cannot be moved",
  "请新建会议导入，以保留现有原始资料":
    "Create a new meeting for import to preserve existing source material",
  录音: "Audio recording",
  "会议内容已改变，请新建会议导入":
    "Meeting content changed. Import into a new meeting.",
  已有录制进行中: "A recording is already in progress",
  请新建会议开始录音: "Create a new meeting to record audio",
  录音已停止: "Audio recording stopped",
  "应用内录屏当前先支持 Windows；其他系统可导入录像":
    "In-app screen recording currently supports Windows; other systems can import video",
  "应用内录屏当前先支持 Windows":
    "In-app screen recording currently supports Windows",
  "所选窗口或显示器已不可用，请重新选择":
    "Selected window or display is unavailable. Select again.",
  请重新检查录制来源与权限: "Check the recording source and permissions again",
  请新建会议开始录屏: "Create a new meeting to record the screen",
  "录像已停止，已保存部分将进行恢复":
    "Video recording stopped. Saved content will be recovered.",
  请先结束当前录制: "Stop the current recording first",
  "统一转录 JSON": "Transcript JSON",
  分析不存在: "Analysis not found",
  画面不存在: "Frame not found",
  请先将此画面重新用于分析: "Include this frame in analysis first",
  请先提取关键画面: "Extract key frames first",
  画面时间或数量超出范围: "Frame time or count is out of range",
  请等待后台请求结束后修改服务配置:
    "Wait for background requests to finish before changing service settings",
  系统凭据加密不可用: "System credential encryption is unavailable",
  会议备份: "Meeting backup",
  正在备份或恢复: "Backup or restore in progress",
  此开发音频未在启动环境中授权:
    "This development audio was not authorized in the launch environment",
  请新建会议导入: "Import into a new meeting",
  继续录制: "Keep recording",
  保存并退出: "Save and quit",
  "录像仍在录制或整理，是否保存并退出？":
    "Video is still recording or finalizing. Save and quit?",
  继续录音: "Keep recording audio",
  "会议仍在录音，是否保存并退出？": "Audio is still recording. Save and quit?",
  会议媒体文件名无效: "Invalid meeting media filename",
  录像已停止: "Video recording stopped",
  "录像数据顺序不一致，已保留确认保存的部分":
    "Video chunks arrived out of order. Confirmed saved content is retained.",
  录像数据块超过限制: "Video chunk exceeds the limit",
  "录像已达到 24 GB 限制，请另建会议继续":
    "Video reached the 24 GB limit. Continue in a new meeting.",
  磁盘未能写入录像: "Could not write video to disk",
  未找到待恢复的录像数据: "No video recovery data found",
  "尚无完整保存的录像数据，或录像数据不完整":
    "No complete saved video data is available",
  已保存数据没有可恢复的画面: "Saved data contains no recoverable video frames",
  "服务 URL 不可包含凭据、查询或片段":
    "Service URL must not contain credentials, a query or a fragment",
  "公网服务必须使用 HTTPS；本机与私网 IP 允许 HTTP":
    "Public services require HTTPS; local and private IP addresses may use HTTP",
  "单条内容超过上下文预算，请提高预算或拆分片段":
    "An item exceeds the context budget. Increase the budget or split the segment.",
  "无法确定音频主语言，请在分析设置中指定报告语言":
    "Could not determine the audio's main language. Choose a report language in analysis settings.",
  请先在设置中确认数据发送说明: "Confirm data sharing in settings first",
  请配置分析模型: "Configure an analysis model",
  请先在服务设置中确认画面发送范围:
    "Confirm frame sharing in service settings first",
  "请求超过上下文预算，请增大预算":
    "Request exceeds the context budget. Increase the budget.",
  "分析接口 HTTP {p0}：{p1}": "Analysis service HTTP {p0}: {p1}",
  分析接口缺少文本结果: "Analysis service returned no text",
  有依据的输出校验未完成: "Evidence validation did not complete",
  请先结束录音: "Stop recording first",
  请先录音或导入音频: "Record or import audio first",
  请先导入录像: "Import video first",
  请先完成转录: "Complete transcription first",
  此会议没有录像: "This meeting has no video",
  请先在服务设置中确认向分析服务发送关键画面:
    "Allow key frame sharing in service settings first",
  此会议已有任务: "This meeting already has an active task",
  任务不可重试: "This task cannot be retried",
  "正在取消，请稍后重试": "Cancellation in progress. Retry later.",
  "转录版本已改变，请新建任务": "Transcript version changed. Start a new task.",
  准备重试: "Preparing retry",
  "视觉模型配置已改变，请新建任务；已有画面观察保留":
    "Vision model settings changed. Start a new task; existing observations are retained.",
  文件不包含视频画面: "File contains no video frames",
  "识别关键画面 {p0}/{p1}（本次 {p2}/{p3}）":
    "Recognizing frame {p0}/{p1} (this run: {p2}/{p3})",
  转录版本已改变: "Transcript version changed",
  "无法连接转录服务 {p0}（{p1}）。请先启动转录服务，并在设置中检查转录服务 URL，然后重试。录音已保存在本机。":
    "Cannot connect to transcription service {p0} ({p1}). Start the service, check its URL in settings and retry. Your recording is saved locally.",
  "转录服务 HTTP {p0}：{p1}": "Transcription service HTTP {p0}: {p1}",
  请检查设置中的转录服务访问令牌:
    "Check the transcription access token in settings",
  "请检查转录服务 URL，需指向支持 /jobs 的转录服务":
    "Check the transcription URL; it must point to a service supporting /jobs",
  请检查转录服务状态后重试: "Check the transcription service and retry",
  "转录服务尚不支持自动统一说话人，请更新并重启转录服务":
    "The transcription service does not support speaker resolution. Update and restart it.",
  在本机提取录像音轨: "Extracting video audio locally",
  上传音频: "Uploading audio",
  等待统一说话人: "Waiting for speaker resolution",
  等待转录: "Waiting for transcription",
  等待转录服务队列: "Waiting in the transcription queue",
  远程任务未完成: "Remote task did not complete",
  保存转录和索引: "Saving transcript and index",
  "说话人修复修改了原文或时间戳，结果未保存":
    "Speaker resolution changed source text or timestamps. Results were not saved.",
  "说话人修复合并了不同的已确认姓名，结果未保存":
    "Speaker resolution merged distinct confirmed names. Results were not saved.",
  确定报告语言: "Determining report language",
  "画面已改变，请新建分析任务": "Frames changed. Start a new analysis.",
  "没有可用于分析的画面内容，可选择仅使用转录分析":
    "No usable visual content. You can analyze the transcript only.",
  "背景、模板和项目记录超过上下文预算，请提高预算或缩短配置":
    "Context, templates and records exceed the budget. Increase it or shorten the context.",
  "{p0} {p1}/{p2} 组": "{p0} {p1}/{p2} groups",
  补充画面信息: "Adding visual information",
  建立语音纪要: "Building speech notes",
  "分析 {p0}/{p1}": "Analyzing {p0}/{p1}",
  "分析与核对 {p0}/{p1} 组": "Analyzing and verifying {p0}/{p1} groups",
  "核对事实 {p0}/{p1}": "Checking facts {p0}/{p1}",
  "按模板组织章节 {p0}/{p1}": "Organizing sections {p0}/{p1}",
  章节层级过深: "Section nesting is too deep",
  同一层级的同名人员或主题必须合并:
    "Merge duplicate people or topics at the same level",
  未提及的空栏目必须省略: "Omit empty sections not discussed in the meeting",
  "章节标题或人员归属未通过事实核对，请重试：{p0}":
    "Section titles or person assignments failed verification. Retry: {p0}",
  缺少明确依据: "Insufficient direct evidence",
  "会议所属项目已改变，请重新分析":
    "The meeting's project changed. Analyze again.",
  "画面已改变，请重新分析": "Frames changed. Analyze again.",
  完成: "Complete",
  没有匹配的转录片段: "No matching transcript segments",
  "检索并核对 {p0} 个片段": "Searched and checked {p0} segments",
  "回答汇总未收敛，请缩小日期范围":
    "Answer reduction did not converge. Narrow the date range.",
  "汇总超过预算，请提高上下文预算或缩小日期范围":
    "Summary exceeds the budget. Increase it or narrow the date range.",
  汇总引入了未提供的引用: "Summary introduced an unavailable citation",
  "已核对 {p0} 个候选片段，分 {p1} 批处理；范围为本地已转录内容。":
    "Checked {p0} candidate segments in {p1} batches. Coverage is limited to locally transcribed content.",
  模型引用不存在或引文与原文不一致:
    "Model citation is missing or its quote does not match the source",
  记录不存在: "Record not found",
  自定义模板不存在: "Custom template not found",
  "片段 ID 重复": "Duplicate segment IDs",
  "转录已更新，请刷新后重试": "Transcript updated. Refresh and retry.",
  "片段 ID 与其他会议冲突": "Segment ID conflicts with another meeting",
  请先归入项目并选择待办或决策:
    "Assign a project and select an action item or decision first",
  "分析已过期，请重新生成": "Analysis is out of date. Generate it again.",
  "画面选择已改变，请重新分析": "Selected frames changed. Analyze again.",
  此建议已确认: "This proposal is already confirmed",
  目标记录不属于此项目或类型不符:
    "Target record belongs to another project or has an incompatible type",
  "项目记录已被其他会议更新，请重新分析":
    "Another meeting updated this project record. Analyze again.",
  新增建议不能指向已有记录: "A new proposal cannot target an existing record",
  只有待办可以完成: "Only action items can be completed",
  更新建议缺少目标记录: "Update proposal is missing its target record",
  "已有相同记录，请重新分析生成更新建议":
    "An identical record exists. Analyze again to propose an update.",
  画面引用不存在或与观察记录不一致:
    "Frame citation is missing or does not match the observation",
  引用与当前或历史转录均不匹配:
    "Citation matches neither the current nor historical transcript",
  参数引用不存在或缺少对应画面证据:
    "Parameter reference is missing or lacks matching frame evidence",
  每条最多引用两张画面: "Each claim may cite at most two frames",
  "仅有画面不能确认决策、待办、负责人、期限或完成状态；需要明确发言证据":
    "Visuals alone cannot confirm decisions, actions, owners, dates or completion; direct speech evidence is required",
  "期限必须直接出现在引用原文中（保留原话）":
    "Due dates must appear verbatim in the cited source",
  无效的更新目标: "Invalid update target",
  更新动作与目标不一致: "Update action is inconsistent with its target",
  媒体工具输出过大: "Media tool output is too large",
  "未找到 {p0}。录像导入与画面提取需要本机 FFmpeg，请安装并加入 PATH，或设置 {p1} 可执行文件路径。":
    "{p0} not found. Video import and extraction require local FFmpeg. Install it on PATH or set the {p1} executable path.",
  "{p0} 处理失败 ({p1})：{p2}": "{p0} failed ({p1}): {p2}",
  不支持此格式: "Unsupported format",
  未能读取该时刻的画面: "Could not read the frame at this time",
  "当前支持最多 6 小时录像分析，请分段导入":
    "Video analysis supports up to 6 hours. Import shorter sections.",
  "画面变化过多，超过 600 张分析上限，请缩短录像或分段导入":
    "Video exceeds the 600-frame analysis limit. Shorten it or import sections.",
  录像没有可解码画面: "Video contains no decodable frames",
  "此录像没有音轨，可直接识别画面并生成画面分析":
    "This video has no audio. Recognize its frames and generate a visual analysis.",
  画面路径无效: "Invalid frame path",
  "单张画面超过 8 MB，请降低源视频分辨率":
    "Frame exceeds 8 MB. Reduce the source video resolution.",
  "画面观察超过上下文预算，请提高预算":
    "Visual observations exceed the context budget. Increase it.",
  "单个发言与画面超过上下文预算，请提高预算或拆分转录片段":
    "Speech and frames exceed the context budget. Increase it or split the segment.",
  "单个发言超过上下文预算，请拆分片段或提高预算":
    "A speech segment exceeds the context budget. Split it or increase the budget.",
  "模型没有返回有效 JSON": "The model did not return valid JSON",
  原始录像: "Original video",
  原始录音: "Original audio",
  麦克风独立音轨: "Microphone track",
  系统声音独立音轨: "System audio track",
  待恢复录像: "Video recovery data",
  " 副本": " copy",
  "引用原文 · 转录 v{p0}": "Cited source · Transcript v{p0}",
  " · 历史版本，保留引用时的原文":
    " · Historical version, preserving the cited text",
  " · 当前版本": " · Current version",
  "定位 {p0} 原文": "Locate source at {p0}",
  "开发连接失败 ({p0})": "Development connection failed ({p0})",
  "画面 {p0} 的模型观察：{p1}": "Model observation for frame {p0}: {p1}",
  "引用来自转录 v{p0}：{p1}": "Citation from transcript v{p0}: {p1}",
  "录像整理失败，已保留原始数据：{p0}":
    "Video finalization failed. Original data retained: {p0}",
  "已恢复可播放录像 {p0}。异常结束时尚未落盘的尾部无法恢复，请核对结束位置。":
    "Recovered playable video {p0}. The unsaved tail cannot be recovered after an interruption; check the ending.",
  "录像已保存 · {p0} · {p1}": "Video saved · {p0} · {p1}",
  "说话人 {p0}": "Speaker {p0}",
  "合并说话人 {p0}": "Merge speaker {p0}",
  "回听 {p0}": "Play at {p0}",
  "片段 {p0}": "Segment {p0}",
  "已结合 {p0} 张关键画面{p1}": "Includes {p0} key frames{p1}",
  "已恢复备份；原库保留在 {p0}":
    "Backup restored; original library kept at {p0}",
  "{p0} 段原文的时长分布": "Duration distribution of {p0} transcript segments",
  "{p0} 段原文 · 均可定位核对":
    "{p0} transcript segments · Each can be located and verified",
  "音频保存失败：{p0}": "Could not save audio: {p0}",
  "麦克风 {p0}": "Microphone {p0}",
  "录像保存失败：{p0}": "Could not save video: {p0}",
  关闭导航: "Close navigation",
  会议手记: "Meeting Recorder",
  个人工作区: "Personal workspace",
  "＋ 新建会议": "＋ New meeting",
  主要导航: "Main navigation",
  会议库: "Meeting library",
  项目追踪: "Project tracking",
  有据问答: "Ask your meetings",
  项目: "Project",
  未归入项目: "No project",
  新建项目: "New project",
  分析模板: "Analysis templates",
  项目默认设置: "Project defaults",
  服务与备份: "Services and backup",
  设置与备份: "Settings and backup",
  我: "Me",
  个人空间: "Personal space",
  "本地会议库 · 数据保存在本机": "Local library · Stored on this device",
  会议详情: "Meeting details",
  设置: "Settings",
  打开导航: "Open navigation",
  本地优先: "Local first",
  "搜索会议 Ctrl K": "Search meetings Ctrl K",
  保存背景与分析设置: "Save context and analysis settings",
  设置已保存: "Settings saved",
  会议背景: "Meeting context",
  "例如：项目目标、已有约定、本次讨论范围…":
    "For example: project goals, prior agreements, discussion scope…",
  "用于辅助理解，不作为会议结论的依据。":
    "Provides context; does not serve as evidence for conclusions.",
  关键词: "Keywords",
  "关键词（人名、项目名、技术术语，逗号或换行分隔）":
    "Keywords (names, projects, technical terms; separate with commas or new lines)",
  "例如：张三，VibeVoice，XRD": "For example: Alex, VibeVoice, XRD",
  "人名、项目名或技术术语，用逗号或换行分隔。":
    "Names, projects or technical terms, separated by commas or new lines.",
  "模板已删除，请重新选择": "Template deleted. Select another template.",
  输出要求: "Output requirements",
  本次补充要求: "Additional requirements",
  选填: "Optional",
  "例如：重点整理阻塞事项，简要保留技术讨论。":
    "For example: focus on blockers and briefly summarize technical discussions.",
  "本次分析使用已保存的背景与姓名映射，结论仍需原文证据。历史分析会保留。":
    "Analysis uses saved context and speaker names. Conclusions still require source evidence. Previous analyses are retained.",
  "背景修改后，再次转录才会影响识别结果。":
    "Context changes affect recognition only when you transcribe again.",
  已重新载入项目默认值: "Project defaults reloaded",
  重新载入项目默认值: "Reload project defaults",
  "正在保存…": "Saving…",
  "新会议会复制这些设置。已有会议可在背景编辑中手动重新载入。":
    "New meetings copy these settings. Existing meetings can reload them in the context editor.",
  还没有项目: "No projects yet",
  "创建项目后，可在这里设置通用背景和默认模板。":
    "Create a project to configure shared context and its default template.",
  选择项目: "Select project",
  保存项目默认设置: "Save project defaults",
  "定义纪要的组织方式，让不同会议有适合的输出。":
    "Choose how notes are organized for different kinds of meetings.",
  模板列表: "Template list",
  "＋ 新建模板": "＋ New template",
  内置模板: "Built-in templates",
  我的模板: "My templates",
  "复制内置模板，或创建自己的模板。":
    "Copy a built-in template or create your own.",
  模板已保存: "Template saved",
  模板预览: "Template preview",
  编辑模板: "Edit template",
  新建模板: "New template",
  "内置 · 只读": "Built-in · Read only",
  自定义: "Custom",
  模板名称: "Template name",
  "例如：研发周会": "For example: Engineering weekly",
  自然语言输出要求: "Output instructions",
  "描述希望包含的章节、分组方式和内容详略…":
    "Describe the sections, grouping and level of detail you want…",
  "复制后即可自由编辑，内置模板会保留。":
    "Make a copy to edit freely. The built-in template is retained.",
  "模板决定内容组织方式。每项结论仍需通过事实核对，修改不影响历史分析。":
    "Templates organize content. Every conclusion still requires fact checking; changes do not affect previous analyses.",
  副本: "Copy",
  复制: "Copy",
  删除: "Delete",
  "保存中…": "Saving…",
  保存模板修改: "Save template changes",
  创建自定义模板: "Create custom template",
  "删除「": "Delete “",
  "」？历史分析会保留，使用此模板的会议需要重新选择。":
    "”? Previous analyses are retained. Meetings using this template will need another template.",
  取消: "Cancel",
  模板已删除: "Template deleted",
  确认删除: "Confirm deletion",
  有未保存的修改: "Unsaved changes",
  原文依据: "Source evidence",
  收起原文栏: "Collapse source panel",
  "结论有出处，细节可回查。": "Trace conclusions back to their sources.",
  引用的画面观察: "Cited visual observation",
  引用的历史画面: "Cited historical frame",
  "· 历史版本，保留引用时的原文":
    "· Historical version, preserving the cited text",
  "· 当前版本": "· Current version",
  "当前转录 v": "Current transcript v",
  段: " segments",
  "转录完成后，可在这里核对原文和时间戳。":
    "After transcription, verify the source text and timestamps here.",
  上一页: "Previous page",
  下一页: "Next page",
  "原始媒体与转录独立保留。":
    "Original media and transcripts are stored separately.",
  "引用保留对应的原文和画面版本。":
    "Citations retain their source text and frame versions.",
  "请从桌面应用打开，或显式启用本地开发浏览器桥接":
    "Open the desktop app or explicitly enable the local development browser bridge",
  会议纪要: "Meeting notes",
  议题: "Topic",
  决策: "Decision",
  讨论建议: "Suggestion",
  待办: "Action item",
  新增: "New",
  "延续 / 更新": "Continue / Update",
  已完成: "Completed",
  "替代 / 推翻": "Replace / Overturn",
  进行中: "In progress",
  已被推翻: "Replaced",
  排队中: "Queued",
  处理中: "Processing",
  失败: "Failed",
  已取消: "Cancelled",
  转录: "Transcribe",
  统一说话人: "Resolve speakers",
  分析: "Analyze",
  画面识别: "Recognize frames",
  已保存: "Saved",
  待录音: "Ready to record",
  录制中: "Recording",
  录制曾中断: "Recording interrupted",
  "阅读偏好无法保存，请检查本机存储是否可写。":
    "Could not save reading preferences. Check that local storage is writable.",
  "正在重新提交任务…": "Resubmitting task…",
  "已重新提交任务；处理状态或失败原因会显示在下方任务卡片中。":
    "Task resubmitted. Progress or errors will appear in the task card below.",
  画面: "Frame",
  原文: "Source",
  "正在打开本地会议库…": "Opening local meeting library…",
  正在保存与整理: "Saving and finalizing",
  录制已暂停: "Recording paused",
  正在录屏: "Recording screen",
  正在录音: "Recording audio",
  返回录制会议: "Return to recording",
  继续: "Resume",
  暂停: "Pause",
  "■ 结束并保存": "■ Stop and save",
  "让工作区适合你的记录与阅读习惯。":
    "Adapt your workspace to the way you record and read.",
  关闭: "Close",
  返回会议库: "Back to library",
  设置分类: "Settings categories",
  服务与权限: "Services and permissions",
  备份与恢复: "Backup and restore",
  阅读偏好: "Reading preferences",
  "应用于这台设备上的会议阅读页。":
    "Applies to meeting reading pages on this device.",
  纪要正文大小: "Notes text size",
  标准: "Standard",
  "舒适 · 较大正文": "Comfortable · Larger text",
  默认展开原文栏: "Expand source panel by default",
  "/ 会议工作台": "/ Meeting workspace",
  编辑信息: "Edit details",
  位说话人: " speakers",
  "● 开始录音 / 录屏": "● Record audio / screen",
  "↥ 导入录音 / 录像": "↥ Import audio / video",
  "↻ 分说话人转录": "↻ Transcribe with speakers",
  "✧ 生成分析": "✧ Generate analysis",
  "导出 Markdown": "Export Markdown",
  "▧ 关键画面": "▧ Key frames",
  原始文件: "Original files",
  "正在整理录像并恢复播放时间轴，请稍候…":
    "Finalizing video and restoring the playback timeline…",
  重试整理录像: "Retry video finalization",
  背景与关键词: "Context and keywords",
  "添加会议背景，让术语和讨论更易理解":
    "Add context to help interpret terms and discussions",
  个关键词: " keywords",
  "编辑 →": "Edit →",
  会议内容: "Meeting content",
  会议分析: "Meeting analysis",
  转录与回听: "Transcript and playback",
  录像与画面: "Video and frames",
  展开原文栏: "Expand source panel",
  重试: "Retry",
  会议录像: "Meeting video",
  会议录音: "Meeting audio",
  已恢复落盘部分: "Saved portion recovered",
  原始媒体保存在本机: "Original media is stored locally",
  生成分析: "Generate analysis",
  准备录制: "Prepare recording",
  核对并确认项目记录: "Review and confirm project record",
  会议信息: "Meeting details",
  "· 转录 v": "· Transcript v",
  "负责人：": "Owner: ",
  未明确: "Not specified",
  "期限：": "Due: ",
  "确认后加入「": "After confirmation, add to “",
  "」。负责人和期限保留分析中的实际字段。":
    "”. Owner and due date retain the values from the analysis.",
  "原文或画面已变化，请重新分析后确认。":
    "Source text or frames have changed. Analyze again before confirming.",
  确认加入项目: "Confirm and add to project",
  "将相关会议归在一起，追踪决策和待办。":
    "Group related meetings to track decisions and action items.",
  项目名称: "Project name",
  "例如：产品研发": "For example: Product development",
  创建项目: "Create project",
  "选择适合本次会议的模板，生成一份新的分析。":
    "Choose a template for this meeting and generate a new analysis.",
  结合关键画面生成纪要: "Include key frames in the notes",
  "将先完成画面识别，再结合当时发言分析。选中的截图和相关文字会发送到已配置的分析服务。":
    "Frames are recognized first, then analyzed alongside the discussion. Selected images and related text are sent to your configured analysis service.",
  "本次仅使用转录，画面不会参与分析。":
    "This analysis uses only the transcript.",
  "请先在「服务与备份」确认关键画面的发送范围。":
    "First confirm frame sharing permissions in Services and backup.",
  保存并生成分析: "Save and generate analysis",
  "补充本次会议的上下文，帮助识别术语和理解讨论。":
    "Add context to help recognize terms and understand this meeting.",
  编辑会议信息: "Edit meeting details",
  创建会议: "Create meeting",
  "录制新的讨论，或导入已有的会议录音。":
    "Record a new discussion or import an existing meeting recording.",
  会议名称: "Meeting name",
  "例如：产品周会 · 第 36 周": "For example: Product weekly · Week 36",
  "会议发生时间（本地时区）": "Meeting time (local time zone)",
  所属项目: "Project",
  保存: "Save",
  会议原文: "Meeting transcript",
  请先保存校对: "Save transcript edits first",
  "根据录音声纹自动统一整场会议的说话人，无需重新转录":
    "Resolve speaker identities across the recording without transcribing again",
  自动统一说话人: "Resolve speakers automatically",
  "导入转录 JSON": "Import transcript JSON",
  保存校对: "Save transcript edits",
  "有未保存的校对。保存后已有分析会标记过期；切换会议或页签会丢弃未保存内容。":
    "Unsaved transcript edits. Saving marks previous analyses as out of date. Switching meetings or tabs discards unsaved edits.",
  "合并到…": "Merge into…",
  时间戳校对: "Edit timestamps",
  开始秒: "Start (seconds)",
  结束秒: "End (seconds)",
  原文分页: "Transcript pagination",
  上一页原文: "Previous transcript page",
  下一页原文: "Next transcript page",
  "讨论的每个细节，都值得留存": "Keep the details of your discussion",
  "录音或导入音频后，点击「分说话人转录」。":
    "Record or import audio, then select Transcribe with speakers.",
  "也可以导入统一格式的转录 JSON 开始校对。":
    "You can also import transcript JSON to begin editing.",
  "截止：": "Due: ",
  "✓ 已确认": "✓ Confirmed",
  确认加入项目记录: "Confirm as project record",
  把讨论整理成下一步: "Turn discussion into next steps",
  "完成原文校对后，点击「生成分析」。":
    "Review the transcript, then select Generate analysis.",
  "纪要、决策与待办都会保留原文依据。":
    "Notes, decisions and action items retain their source evidence.",
  "导出此版本 Markdown": "Export this version as Markdown",
  分析版本: "Analysis version",
  第: "Version ",
  "次 ·": " ·",
  旧版分析: "Legacy analysis",
  "· 无音轨，仅分析展示内容": "· No audio; presentation content only",
  与转录: "and transcript",
  "仅使用转录 · 画面未参与本次分析": "Transcript only · Frames were not used",
  "原文或画面选择已修改，此分析已过期。请重新生成后确认项目记录。":
    "The transcript or selected frames have changed. Regenerate this analysis before confirming project records.",
  "此分析使用旧设置，重新生成将保留为新版本。":
    "This analysis uses earlier settings. Regenerating creates a new version.",
  "本次分析设置 ·": "Analysis settings ·",
  "人工修订纪要（单独保存）": "Edited notes (saved separately)",
  保存人工纪要: "Save edited notes",
  原始模型输出: "Raw model output",
  "录音、校对记录和分析保存在本机。密钥通过系统凭据加密保存。":
    "Recordings, transcript edits and analyses are stored locally. Keys are encrypted using system credentials.",
  配置已保存: "Configuration saved",
  转录服务: "Transcription service",
  "连接本机或自建服务，将音视频转换为带说话人的原文。":
    "Connect a local or self-hosted service to transcribe audio and video with speaker labels.",
  "转录服务 URL": "Transcription service URL",
  "转录需要单独运行转录服务。本机地址仅在该服务已启动时可用；安装桌面应用不会自动启动服务。":
    "Run the transcription service separately. The local address works only while the service is running; installing the app does not start it.",
  转录服务访问令牌: "Transcription access token",
  "已保存（留空保持）": "Saved (leave blank to keep)",
  本机服务可留空: "Optional for local services",
  分析服务: "Analysis service",
  "用于会议纪要、项目建议和有据问答。":
    "Used for meeting notes, project proposals and answers with evidence.",
  "分析 Base URL": "Analysis base URL",
  "分析 API Key": "Analysis API key",
  仅在主进程使用: "Used only in the main process",
  模型名称: "Model name",
  服务支持的模型名: "A model supported by your service",
  "上下文预算（tokens）": "Context budget (tokens)",
  "最大输出长度（tokens）": "Maximum output (tokens)",
  "正文与思考可能共享额度；截断时会在此上限和上下文预算内自动重试一次。":
    "Text and reasoning may share the limit. Truncated responses are retried once within the output and context budgets.",
  "Qwen 思考模式（vLLM）": "Qwen thinking mode (vLLM)",
  跟随服务设置: "Use service default",
  关闭思考: "Disable thinking",
  开启思考: "Enable thinking",
  "仅用于支持 Qwen 思考开关的 vLLM 服务。其他服务请选择“跟随服务设置”。":
    "For vLLM services supporting Qwen thinking controls. For other services, use the service default.",
  "图片模型名称（留空使用分析模型）":
    "Vision model (blank to use analysis model)",
  同一分析服务中支持图片的模型: "An image-capable model on the same service",
  "关键画面识别和原图核对使用此模型。":
    "Used to recognize frames and verify original images.",
  数据发送范围: "Data sharing",
  "转录会发送所选会议音频、背景和关键词。分析会发送相关转录、背景、关键词、模板要求、校对的姓名映射及项目记录；问答会发送检索到的转录内容。远程服务的数据保留规则由你配置的服务提供方决定。":
    "Transcription sends selected audio, context and keywords. Analysis sends relevant transcripts, context, keywords, template instructions, reviewed speaker names and project records. Questions send retrieved transcripts. Data retention is governed by your configured service provider.",
  "我了解上述发送内容，并允许向配置的服务发送。":
    "I understand and allow this data to be sent to the configured services.",
  "允许向上述分析服务发送选中的关键画面和画面观察，用于录像分析。":
    "Allow selected frames and visual observations to be sent to the analysis service.",
  "录像在本机提取音轨和截图；视频原文件保留在本机。画面识别与核对需要支持图片输入的模型。":
    "Audio and frames are extracted locally; original videos stay on this device. Frame recognition and verification require an image-capable model.",
  保存配置: "Save configuration",
  测试已保存的分析连接: "Test saved analysis connection",
  测试已保存的图片连接: "Test saved vision connection",
  完整备份与迁移: "Full backup and migration",
  "包含音视频、关键画面、原始转录、校对历史、分析和引用，不包含服务密钥。恢复会切换会议库，原库保留在本机。":
    "Includes media, frames, transcripts, edit history, analyses and citations; excludes service keys. Restoring switches libraries and keeps the original locally.",
  备份操作已结束: "Backup operation finished",
  导出完整备份: "Export full backup",
  从备份恢复: "Restore from backup",
  "当前本地会议库：": "Current local library: ",
  "场会议 ·": "meetings ·",
  个项目: " projects",
  "原始录音／录像文件": "Original audio / video files",
  "这里显示会议库实际保存的媒体文件。导入的文件在会议库中保留副本；纯录音还可能包含独立的麦克风和系统声音音轨。":
    "These are the media files stored in your library. Imports retain a local copy; audio recordings may also include separate microphone and system tracks.",
  "正在读取文件位置…": "Loading file locations…",
  媒体保存目录: "Media directory",
  路径: "Path",
  "文件未找到，可能已被移动或删除":
    "File not found; it may have been moved or deleted",
  已请求在文件夹中显示文件: "Requested to reveal file in folder",
  在文件夹中显示: "Show in folder",
  "此会议尚未保存录音或录像。": "No recording has been saved for this meeting.",
  整理录像中: "Finalizing video",
  录像待恢复: "Video recovery needed",
  处理失败: "Processing failed",
  任务已取消: "Task cancelled",
  已有纪要: "Notes available",
  已有转录: "Transcript available",
  待转录: "Awaiting transcription",
  "待录制 / 导入": "Awaiting recording / import",
  "在会议之间寻找答案，也保留每一条依据。":
    "Find answers across meetings, with evidence for every claim.",
  "开始日期不能晚于结束日期。": "Start date cannot be after end date.",
  向会议提问: "Ask your meetings",
  你的问题: "Your question",
  "例如：这个项目的技术方案发生过哪些变化？":
    "For example: How has this project's technical approach changed?",
  回答保留时间戳与原文依据: "Answers include timestamps and source evidence",
  "正在检索与核对…": "Searching and verifying…",
  "✧ 查询原文并回答": "✧ Search transcripts and answer",
  回答: "Answer",
  正在核对会议依据: "Checking meeting evidence",
  不止找到一句话: "See the full context",
  "检索和回答使用你配置的服务，请稍候。":
    "Searching and answering with your configured service. Please wait.",
  "连同发言人、时间和上下文一起查看，分清已经做出的决定与仍在讨论的建议。":
    "Review the speaker, time and context to distinguish confirmed decisions from suggestions.",
  检索范围: "Search scope",
  会议范围: "Meeting scope",
  选择会议或项目: "Select meeting or project",
  "项目：": "Project: ",
  会议: "Meeting",
  开始日期: "Start date",
  结束日期: "End date",
  当前范围包含: "Current scope includes ",
  "场会议。日期按会议发生时间筛选；实际检索覆盖范围随回答展示。":
    " meetings. Dates filter by meeting time; actual search coverage is shown with the answer.",
  "先创建会议并保存转录，即可开始有据问答。":
    "Create a meeting and save its transcript to start asking questions.",
  "把讨论留存，把下一步理清。": "Keep the discussion. Clarify the next steps.",
  导入音视频: "Import audio / video",
  会议速览: "Meeting overview",
  "录音与录像归入同一场会议，背景和关键词随会议保存。":
    "Audio, video, context and keywords are kept together with each meeting.",
  打开会议: "Open meeting",
  转录覆盖时长: "Transcribed duration",
  等待开始记录: "Ready to start recording",
  开始录音或导入已有资料: "Record audio or import existing media",
  "从一次会议，": "From a single meeting",
  "到持续推进的项目。": "to steady project progress.",
  "录下讨论，校对原文，整理决策与待办。":
    "Record discussions, review transcripts and organize decisions and actions.",
  "每一项结论，都能回到它的出处。": "Trace every conclusion to its source.",
  "＋ 创建第一场会议": "＋ Create your first meeting",
  会议列表: "Meeting list",
  会议状态筛选: "Filter by meeting status",
  全部会议: "All meetings",
  待处理: "Pending",
  搜索会议: "Search meetings",
  搜索会议名称: "Search meeting names",
  处理状态: "Processing status",
  时长: "Duration",
  段原文: " transcript segments",
  没有匹配的会议: "No matching meetings",
  "试试其他名称或处理状态。": "Try a different name or status.",
  清除筛选: "Clear filters",
  加载更多会议: "Load more meetings",
  场会议: " meetings",
  "本地会议库 ·": "Local library ·",
  把资料放在一起: "Keep your materials together",
  录制新会议: "Record new meeting",
  把结论落实到项目: "Put conclusions into action",
  "核对后确认待办和决策，持续记录负责人、状态与变化。":
    "Review and confirm actions and decisions, then track owners, status and changes.",
  查看项目追踪: "View project tracking",
  "让确认过的行动和决策，拥有清楚的来路与进展。":
    "Track confirmed actions and decisions with clear sources and progress.",
  当前项目: "Current project",
  追踪项目: "Track project",
  全部项目: "All projects",
  待确认建议: "Proposals to review",
  条: " items",
  正式项目记录: "Confirmed project records",
  项目记录筛选: "Filter project records",
  待确认: "Unconfirmed",
  全部记录: "All records",
  事项与依据: "Item and evidence",
  "负责人 / 期限": "Owner / Due date",
  状态: "Status",
  操作: "Actions",
  期限未明确: "No due date specified",
  核对确认: "Review and confirm",
  "查看详情 · 变更历史": "View details · Change history",
  "记录版本 v": "Record version v",
  "已确认 · 只读": "Confirmed · Read only",
  暂无待确认建议: "No proposals to review",
  这里还没有确认的记录: "No confirmed records yet",
  "在会议纪要中核对待办和决策，确认后即可持续追踪。":
    "Review actions and decisions in meeting notes, then confirm them to start tracking.",
  "未归入项目的会议需先设置所属项目。":
    "Assign the meeting to a project first.",
  "建议经过人工确认后才成为正式记录。负责人和期限按会议依据保留，未明确的信息如实展示。":
    "Proposals become records only after your confirmation. Owners and dates follow the evidence; unspecified details remain unspecified.",
  已取消设备检查: "Device check cancelled",
  "未获得系统音轨，请检查系统声音权限或选择仅麦克风":
    "No system audio track. Check permissions or use microphone only.",
  "录音设备已断开，已保存收到的音频。":
    "Recording device disconnected. Received audio has been saved.",
  "音轨暂时静音：请检查设备、权限或系统休眠状态。":
    "Audio track muted. Check devices, permissions and system sleep status.",
  "磁盘写入跟不上录音速度，已停止并保留已落盘部分。":
    "Disk writes could not keep up. Recording stopped; saved audio is retained.",
  "设备检查已结束，请重新检查": "Device check ended. Check again.",
  "录音线程无响应，已落盘音频可在重启后恢复":
    "Recording thread is unresponsive. Saved audio can be recovered after restarting.",
  准备录屏: "Prepare screen recording",
  准备录音: "Prepare audio recording",
  录制内容: "Recording content",
  仅录音: "Audio only",
  "录音 + 屏幕": "Audio + screen",
  选择窗口或显示器: "Select a window or display",
  刷新来源: "Refresh sources",
  显示器: "Display",
  窗口: "Window",
  "录制来源：": "Recording source: ",
  录屏预览: "Screen recording preview",
  录制麦克风: "Record microphone",
  麦克风: "Microphone",
  系统默认麦克风: "System default microphone",
  同时录制系统声音: "Also record system audio",
  "系统声音会包含电脑播放的其他声音，选择窗口不会隔离该窗口的声音。录像保存在本机，生成图文分析时才按服务设置发送画面。":
    "System audio includes other sounds played by the computer; selecting a window does not isolate its audio. Video stays local; frames are sent only for visual analysis according to service settings.",
  系统声音: "System audio",
  "正在请求设备权限…": "Requesting device permissions…",
  检查设备与权限: "Check devices and permissions",
  "● 开始保存录像": "● Start recording video",
  "● 开始保存录音": "● Start recording audio",
  "请确认预览范围与声音电平。开始保存后可暂停、继续和结束录制。":
    "Check the preview and audio levels. Once recording starts, you can pause, resume and stop.",
  重新选择设备或画面: "Choose devices or screen again",
  "未获得所选画面，请重新选择": "Selected screen unavailable. Select again.",
  "未获得系统声音，请检查权限或关闭系统声音选项":
    "System audio unavailable. Check permissions or disable system audio.",
  "此环境不支持 WebM 录制":
    "WebM recording is not supported in this environment",
  "单次录像数据过大，已停止并保留已保存部分":
    "Video chunk too large. Recording stopped; saved content is retained.",
  "磁盘写入跟不上录屏速度，已停止并保留已保存部分":
    "Disk writes could not keep up with screen recording. Saved content is retained.",
  "录像编码中断，正在恢复已保存部分":
    "Video encoding interrupted. Recovering saved content.",
  "录制来源已结束，正在保存录像": "Recording source ended. Saving video.",
  "录制来源或音频设备已断开，正在保存录像":
    "Recording source or audio device disconnected. Saving video.",
  "录制来源暂时静音或画面暂停，请检查窗口、设备与系统状态":
    "Source muted or screen paused. Check the window, devices and system status.",
  "录制来源已结束，请重新检查设备":
    "Recording source ended. Check devices again.",
  "编码器未及时结束，已恢复确认保存的部分":
    "Encoder did not stop in time. Confirmed saved content has been recovered.",
  "录像整理失败，可稍后重试恢复":
    "Video finalization failed. Retry recovery later.",
  关键画面: "Key frames",
  "张参与分析 ·": " included ·",
  张已识别: " recognized",
  识别未完成画面: "Recognize remaining frames",
  提取并识别关键画面: "Extract and recognize key frames",
  "＋ 补充当前画面": "＋ Add current frame",
  显示已排除: "Show excluded frames",
  "识别录像中的幻灯片、图表和演示内容。处理后可在这里核对画面，排除无关截图，再生成结合画面的纪要。":
    "Recognize slides, charts and demonstrations. Review frames, exclude irrelevant images, then generate notes with visuals.",
  打开原始清晰截图: "Open original full-resolution image",
  "正在查看引用时的画面观察。":
    "Viewing the visual observation at the time of citation.",
  查看当前观察: "View current observation",
  已排除: "Excluded",
  画面观察: "Visual observation",
  "未识别到相关会议内容。": "No relevant meeting content recognized.",
  "等待识别；可点击上方按钮继续。":
    "Awaiting recognition. Use the button above to continue.",
  "待核对：": "To verify: ",
  "▶ 从此处播放": "▶ Play from here",
  重新识别此画面: "Recognize this frame again",
  重新用于分析: "Include in analysis again",
  排除此画面: "Exclude this frame",
  "以上为模型观察。点击截图查看原图；画面展示的计划不代表会上已经确认。":
    "These are model observations. Open the image to verify. Plans shown on screen are not necessarily confirmed in the meeting.",
  "画面参数 ·": "Visual parameters ·",
  "项，需对照原图核对": " items; verify against the original image",
  对象: "Object",
  指标: "Metric",
  数值与单位: "Value and unit",
  条件: "Conditions",
  未提取到条件: "No conditions extracted",
  关键画面时间线: "Key frame timeline",
  原始清晰截图: "Original full-resolution image",
  关闭原图: "Close original image",
  展开录像: "Expand video",
  收起录像: "Collapse video",
  报告语言: "Report language",
  跟随音频主语言: "Follow the audio's main language",
  简体中文: "简体中文",
  "仅影响新生成的报告。原文和证据引用保留原始语言。":
    "Applies to new reports. Transcripts and evidence quotes retain their original language.",
  语言: "Language",
  界面语言: "Interface language",
  跟随系统: "Follow system",
  "报告默认语言用于新项目和无项目的新会议。已有会议可在分析设置中调整，或重新载入项目默认值。":
    "The report default applies to new projects and new meetings without a project. Existing meetings can change it in analysis settings or reload project defaults.",
  "问答跟随提问语言，也可在问题中指定回答语言。":
    "Answers follow your question's language. You can also request a language in the question.",
} as const;
