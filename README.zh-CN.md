<div align="center">

# 会议手记 · Meeting Recorder

**把讨论留存，把下一步理清。**

本地录制 · 中英文转写 · 有据纪要 · 项目追踪

[English](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-1478D4?style=flat-square)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-11_x64-1478D4?style=flat-square)](#快速开始)
[![Local ASR](https://img.shields.io/badge/Local_ASR-CPU-256C57?style=flat-square)](docs/bundled-asr.md)
[![Node.js](https://img.shields.io/badge/Node.js-24-455468?style=flat-square)](#从源码运行)

[快速开始](#快速开始) · [界面预览](#界面预览) · [数据与隐私](#数据与隐私) · [开发文档](docs/development.md)

</div>

![From conversation to clarity — 本地记录、转写与核对](docs/assets/readme-banner.svg)

会议手记是一个面向个人的桌面会议工作台：把录音、录像、转录和纪要放在一起，让结论可以回到原文，让确认后的行动持续留在项目里。

Windows 支持在 CPU 上进行本地中英文转写，模型按需下载，之后可离线使用。纪要、画面分析和问答连接你配置的兼容 Chat Completions 的服务，可使用自建模型服务。

## 为什么用会议手记

|                        | 能做什么                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **录下来，也留得住**   | 录制麦克风、系统声音，或在 Windows 上录制窗口与屏幕；支持导入常见音视频格式。          |
| **本地转写，随时校对** | 中文 Qwen3-ASR、英文 SenseVoice；按声音分组，点击时间戳回听，修改文字并保留原文版本。  |
| **先读纪要，再看依据** | 按模板整理全场重点，展开详细条目、逐字引用与关键画面；切换模板和语言时保留历史结果。   |
| **让行动接得上**       | 待办、决策经你确认后进入项目记录，保留来源和变更历史。                                 |
| **跨会议找答案**       | 按会议、项目和日期检索，回答附带原文依据，支持跳回查看。                               |
| **资料由你保管**       | SQLite 本地会议库，Markdown / SRT 导出，完整备份与恢复；中英文界面和报告语言独立设置。 |

## 界面预览

![会议库：项目导航、会议速览与列表](docs/design-review/library.png)

<details>
<summary><strong>展开查看：原文依据、项目追踪与问答</strong></summary>

**结论有出处，历史原文可回查**

![会议详情和原文依据栏](docs/design-review/workspace.png)

**确认后的行动，归入项目记录**

![项目追踪与变更历史](docs/design-review/tracking.png)

**在会议之间提问，也保留引用**

![按范围检索并附带依据的问答](docs/design-review/ask.png)

</details>

<sub>截图来自应用的合成资料界面验收，不含真实会议；展示设计接入时的界面，当前版本可能略有调整。</sub>

## 快速开始

### 安装与平台

| 平台                            | 当前支持                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| **Windows 11 x64**              | 主要交付平台；包含转写运行程序和 FFmpeg，支持本地转写与应用内录屏。                         |
| **macOS 14.2+ · Apple Silicon** | 提供源码运行及 ARM64 DMG 构建配置；使用外部转录服务，完整实机验收及应用内录屏适配尚未完成。 |
| **Linux**                       | 用于 CI 和可选 Python 服务；桌面端尚未验收。                                                |

安装包由 [GitLab Releases](https://gitlab.lingduyu.top/ldy/meeting-recorder/-/releases) 构建和发布。**上游目前是私有项目，下载需要相应 GitLab 权限**；只有 GitHub 访问权限时，可按下方步骤从源码运行或构建。GitHub 用作源码下游，未提供独立 Release。

Windows 安装版无需自行安装 Python、CUDA 或 FFmpeg。首次转写下载所选语言的模型：中文约 **1.02 GB**，英文约 **276 MB**，两种语言共用部分文件，合计约 **1.26 GB**。支持暂停、继续和文件校验，下载完成后本地转写无需联网。详见[本地转写说明](docs/bundled-asr.md)。

### 从第一场会议开始

1. **创建与记录** — 新建会议，录音／录屏，或导入 WAV、MP3、M4A、MP4、OGG、WebM、FLAC。
2. **转写与校对** — 选择中文或英文，完成本地转写；点击时间戳回听，核对术语、数字与说话人。
3. **生成纪要** — 在「设置与备份」配置分析服务 URL、模型和密钥，确认发送范围，再按模板生成纪要。
4. **核对与跟进** — 展开依据，确认待办和决策；到项目追踪页查看，或跨会议提问。
5. **导出与备份** — 导出 Markdown / SRT，或创建完整备份迁移到另一台电脑。

想先熟悉校对界面，可导入[人工转录示例](fixtures/transcript.json)。它只用于演示和测试，生成纪要仍需配置分析服务。

## 数据与隐私

**会议库保存在本机；模型请求的发送范围由你配置和确认。**

| 操作                   | 数据去向                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| 录音、录屏、导入、校对 | 保存到本地会议库。                                               |
| Windows 内置转写       | 下载模型后在本机 CPU 运行；模型下载不上传录音。                  |
| 选择外部转录           | 音频发送到你配置的转录服务，可以是本机或自建主机。               |
| 纪要、语言判定与问答   | 必要的转录、背景、项目记录、问题与引用发送到配置的分析服务。     |
| 启用画面分析           | 在单独的画面发送许可下，将选定关键画面发送到配置的图片模型服务。 |

密钥使用 Electron `safeStorage` 加密保存，渲染进程不接收密钥。**会议文件和备份本身不做整体加密**，应由你管理设备与文件访问权限。完整备份包含会议、媒体、历史和引用，不包含服务密钥及连接配置。

默认会议库位于 Windows 的 `%APPDATA%/meeting-recorder/library`，macOS 的 `~/Library/Application Support/meeting-recorder/library`。开发和测试可用 `MEETING_DATA_DIR` 指定独立目录。

## 从源码运行

需要 **Node.js 24** 和 npm。Windows 本地转写的构建还需要 **Python 3.12**。

```sh
git clone https://github.com/ldy5413/meeting-recorder.git
cd meeting-recorder
npm ci
```

Windows 首次开发时，准备独立转写程序和 FFmpeg；修改 Python 推理代码后也需重跑：

```powershell
npm run prepare:local-asr
```

启动实际 Electron 桌面应用：

```sh
npm run dev
```

macOS 使用[可选外部转录服务](docs/transcription.md)；开发环境的媒体处理需自行提供 FFmpeg / FFprobe。Windows 上也可在设置中切换到外部服务。

<details>
<summary><strong>检查与打包命令</strong></summary>

```sh
npm run format:check
npm test
npm run build
# 需要可运行 Electron 的桌面环境
npm run test:e2e
```

```powershell
# Windows x64 安装包；输出在 release/
npm run dist:win -- --publish never
```

```sh
# 在 Apple Silicon Mac 上构建
npm run dist:mac -- --publish never
```

Python 服务检查、GitLab CI 和测试依赖见[开发说明](docs/development.md)。安装包尚不承诺签名或公证。

</details>

## 使用边界

- 转写、说话人分组与模型分析都可能出错。匿名说话人编号不能证明身份，引用校验也不能保证语义正确；重要结论应回听核对。
- 正式待办和决策需要人工确认。系统不会仅凭模型建议自动更新项目记录。
- 「最近删除」允许恢复会议，仍保留媒体并计入完整备份，不会释放磁盘空间。
- 本项目面向个人使用，尚无多人协作、云端同步或实时同传能力。

## 文档与开发

| 了解什么                     | 从这里开始                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------- |
| 完整操作、语言、备份与可靠性 | [使用指南](docs/usage.md)                                                         |
| 本地模型、下载与转写限制     | [Windows 本地转写](docs/bundled-asr.md) · [模型对比](docs/lightweight-asr.md)     |
| 背景、模板与全场纪要         | [背景与模板](docs/context-and-templates.md) · [会议纪要](docs/meeting-minutes.md) |
| 录像、关键画面与录屏         | [录像分析](docs/video-analysis.md) · [应用内录屏](docs/screen-recording.md)       |
| 自建转录服务与说话人处理     | [转录部署](docs/transcription.md) · [说话人统一](docs/speaker-resolution.md)      |
| 代码、CI 与贡献方式          | [开发说明](docs/development.md) · [贡献指南](CONTRIBUTING.md)                     |

技术栈：**Electron · React · TypeScript · SQLite · Python · sherpa-onnx**。

GitLab 是开发、合并和发布的上游，GitHub 接收审核后的源码快照，使用独立公共历史，Actions 停用。提交改进前请先阅读[贡献指南](CONTRIBUTING.md)。

## 许可证与致谢

项目代码使用 [MIT License](LICENSE)。感谢 [Electron](https://github.com/electron/electron)、[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[SenseVoice](https://github.com/FunAudioLLM/SenseVoice)、[VibeVoice](https://github.com/microsoft/VibeVoice) 和 [FFmpeg](https://ffmpeg.org/)。

第三方组件与模型各自遵循其许可证；具体来源、校验值及许可信息见[模型清单](shared/asr-models.json)和安装包中的第三方声明。
