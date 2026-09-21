# 使用指南

面向个人的本地会议工作台。Electron + React + TypeScript 桌面端，SQLite 本地库。Windows 内置 CPU 转写：中文使用 Qwen3-ASR 0.6B INT8，英文使用 SenseVoiceSmall INT8；会议分析继续使用用户配置的 Chat Completions 兼容接口。保留外部 FastAPI / VibeVoice 转录服务作为可选方式。

支持导入 MP4 / WebM，并在 Windows 应用内选择窗口或显示器录屏。图文分析先建立语音纪要，再补充画面信息，参数保留单位与条件。使用与依赖见 [录像分析](video-analysis.md) 和 [应用内录屏](screen-recording.md)。

分析完成后会继续按模板提炼整场会议，默认展示简短总览与会议纪要；详细条目和画面依据可展开查看。已有报告可以直接重新提炼、切换模板并保留纪要版本，参见 [全场纪要](meeting-minutes.md)。

**当前版本为 0.2.5，Windows 本地中英文转写采用安装后按需下载模型。** 安装包约 189 MB；中文 Qwen3 和英文 SenseVoice 可分别下载，完成后可离线转写。说话人编号只代表声音分组，不确认真实身份；项目结论仍需原文依据及人工确认。界面与报告语言彼此独立，LLM 输出质量取决于配置的服务。下载、缓存及使用限制见 [本地转写](bundled-asr.md)，中英文实测见 [模型对比](lightweight-asr.md)。Mac 仍使用可选的外部转录服务。

界面已接入确认后的五页设计，包含独立导航、会议库、会议详情与原文栏、项目追踪、有据问答及设置。页面接入、接口差异、自动化验证和截图见 [前端设计接入记录](design-implementation.md)。

## 会议管理与版本

在会议详情页点击「删除会议」，确认后移到会议库的「最近删除」，可随时恢复。删除后不参与会议列表、待确认建议和问答检索；音视频、原文、纪要及已确认项目记录的依据保留。此功能不永久清除文件，也不释放磁盘空间。正在录制、整理录像或运行后台任务的会议须先结束任务。备份包含最近删除的会议。

右上角「关于 / About」下拉面板显示实际运行的应用版本，版本号随安装包更新。

## 界面与报告语言

在「设置与备份 → 语言」选择跟随系统、简体中文或 English。切换立即生效并保存在本机；中文系统默认简中，其他系统默认英文。界面语言不会翻译会议名称、用户模板、原文或已有报告。

报告默认跟随音频主语言，也可指定简体中文或 English。新项目复制全局报告默认值，新会议复制项目默认值（无项目时复制全局值）；修改上级设置不影响已有会议。可在项目默认设置、会议背景或「生成分析」弹窗中调整语言，已有会议也可主动重新载入默认值。

自动模式通过配置的分析模型识别覆盖整段转录的语音样本，按转录版本缓存结果；背景、模板、项目记录和画面文字不参与判定。混讲使用主语言，无法确定或没有语音时提示指定。自动模式也可输出中英文以外的音频语言，质量取决于所配置模型的语言能力。

每份分析保存生成时的语言，失败重试沿用该语言；改用其他语言须生成新版本。报告正文、章节及 Markdown 导出说明使用报告语言，原始转录、逐字引用、姓名、数值和原始期限保持原文；SRT 不翻译。旧分析保留原有中文渲染，完整备份保留语言设置及历史结果。

有据问答跟随问题语言；可直接在问题中明确要求其他回答语言。语言判定与报告、问答均使用现有配置服务及数据发送授权，不引入新的云端服务。

## 启动桌面端

需要 Node.js 24、npm，以及 Windows 11 x64 或 macOS 14.2+ Apple Silicon。

```sh
npm ci
npm run dev
```

`dev` 会构建并启动真实 Electron 应用，不使用浏览器模拟本地文件能力。

Windows 开发时先安装 Python 3.12，并执行一次 `npm run prepare:local-asr` 准备独立运行程序；修改 Python 推理代码后再次执行。Windows 安装版已经包含运行环境，模型在应用内下载。

1. 创建项目和会议；可暂不归入项目。
2. 点击「开始录音 / 录屏」，选择录制内容并检查设备、权限与电平，再开始保存；也可导入 WAV、MP3、M4A、MP4、OGG、WebM 或 FLAC。
3. Windows 安装版在转录按钮旁选择中文或英文，即可本地转写。首次使用自动下载该语言的模型，也可在「设置与备份」提前下载，支持暂停、继续与重试；模型缓存在本机，升级后继续使用。需要纪要或问答时，再配置分析接口并确认发送内容；可在此切换到外部转录服务。
4. 转录完成后自动按声纹统一跨段说话人；旧转录点击「自动统一说话人」即可单独修复，无需重新识别文字。可修改文本、时间戳、说话人名称，并点击时间戳回听。配置及边界见 [说话人统一](speaker-resolution.md)。
5. 保存校对，生成分析。项目待办和决策必须手动确认才成为正式记录。
6. 在项目追踪页查看状态与变更历史；在有据问答页选择当前会议／项目和日期范围。
7. 导出 Markdown / SRT；使用完整备份在两台机器之间迁移会议库。

尚未部署模型时，可导入 [统一转录示例](../fixtures/transcript.json) 验证校对和分析流程。该文件是明确标注的人工测试资料，不是真实模型转录。

## 可选外部转录服务

Windows 默认使用随包提供的本地转写。以下步骤仅用于选择外部转录方式的用户，或尚未打包内置模型的 Mac 版本。外部服务可在本机或自建 GPU 主机运行；没有模型时会报告失败，不会返回伪造结果。

安装桌面应用不会自动启动转录服务。本机已按部署文档安装模型时，每次重启电脑后，在项目目录执行 `powershell -NoProfile -File scripts/start-asr.ps1`，再点击转录或重试。若出现“无法连接转录服务”，检查服务是否运行及设置中的转录服务 URL（本机默认为 `http://127.0.0.1:8765`）。上传失败不会删除本地录音；修改地址后可重试原任务。

Windows：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r service/requirements-lock.txt
.\.venv\Scripts\python.exe -m uvicorn service.app:app --host 127.0.0.1 --port 8765
```

macOS / Linux：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r service/requirements-lock.txt
.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8765
```

上述命令启动任务 API；真正推理还需要 [VibeVoice 部署步骤](transcription.md) 中的依赖和模型。服务只启动 **一个 uvicorn worker**，一次运行一个推理进程。远程访问使用 HTTPS 反向代理和 `MEETING_ASR_TOKEN`，桌面设置中填写同一令牌。

## 数据与可靠性

- 默认库位于 Electron `userData/library`；Windows 通常为 `%APPDATA%/meeting-recorder/library`，macOS 为 `~/Library/Application Support/meeting-recorder/library`。可通过 `MEETING_DATA_DIR` 为测试指定独立目录。
- 在会议顶部点击「原始文件」，可查看实际的录音／录像保存路径、文件大小，并在文件夹中定位；导入的媒体显示会议库副本，纯录音还会列出已有的独立音轨。文件被移动或删除时仍显示预期路径。
- 仅录音模式下，麦克风和系统声音通过同一 AudioContext 时钟采样为单声道 PCM，各自存为 WAV，同时保存混合音轨。每秒写盘并 `fsync`，暂停不计入录音时间；未刷出的约一秒可能在崩溃时丢失。断线／休眠会提示或中止，启动时修复已落盘 WAV 头。录屏模式把画面与混合声音编码为同一 WebM，分块保存并在停止后整理为可定位的录像。
- 转录每次保存产生新版本；原始服务输出、模型输出、人工纪要分别保存。旧引用可解析回历史版本并回听其时间戳。
- 分析保存为建议。无明确依据的负责人和期限必须为空；模型误填的 `speaker-2` 等匿名负责人自动设为未确认，保留行动与引用并继续事实审核。真实姓名须有引文或人工姓名映射及本人承诺支持，期限须有引文支持。语义正确性仍需人工验收，结构校验不等于事实验证。
- 任务状态和分析批次持久化；网络失败后重试，已完成转录不必重录。重新分析保留旧纪要，不自动创建正式项目记录。
- SQLite FTS5 trigram 索引配合短中文 LIKE 检索和项目记录证据获取候选；历史综述按会议日期分批归纳。请求按保守字节预算控制，单条过长、项目记录过大或汇总不收敛时明确要求缩小范围／提高预算。
- 完整备份为 `.tar.gz`，包含 SQLite、音视频、待恢复录像和关键画面；密钥和服务配置不在备份中。恢复先校验路径、清单、数据库和媒体，再切换库；旧库以 `library-before-restore-*` 保留。
- 密钥通过 Electron `safeStorage` 使用 Windows DPAPI / macOS Keychain 支持的系统加密保存，渲染进程不接收密钥。界面使用受限 IPC、上下文隔离、沙箱和 CSP。

## 验证与打包

代码目录、格式检查、GitLab CI 和验证脚本参数见 [开发说明](development.md)。

```sh
npm test
npm run test:e2e
python -m pytest service -q
npm run dist:win
# 在 Apple Silicon Mac 上：
npm run dist:mac
```

Windows 安装包默认输出至 `release/Meeting Recorder Setup 0.2.5.exe`，包含独立推理程序和 FFmpeg，模型在安装后下载；Mac 配置生成 ARM64 DMG，转录服务仍独立部署。GitLab 普通分支流水线执行验证和源码构建，推送版本标签后才生成 Windows 安装包并创建 Release。GitHub 仅作为下游镜像，Actions 已停用。实际结果以对应流水线为准。无签名证书的本地包供个人试用，正式签名／公证留待后续。

若 Windows 构建时 Electron 解包目录被占用，已验证可使用本机已下载的 Electron 分发：

```powershell
npx electron-builder --win nsis --x64 '--config.electronDist=node_modules/electron/dist'
```

项目使用 `package-lock.json` 锁定 Node 依赖，服务 API 使用 `requirements-lock.txt`。VibeVoice 是独立推理环境，版本、配置及实测方法见部署文档。

会议背景、关键词、项目默认设置及分析模板的使用方式、接口和录音对比结果见 [背景与模板说明](context-and-templates.md)。
