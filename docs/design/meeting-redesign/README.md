# 会议手记 · 前端设计开发交付包

本包用于把已确认的视觉与交互设计接入现有 `meeting-recorder` React / Electron 应用。设计基线是本包的五个 HTML 页面；业务行为以原项目当前代码和共享类型为准。

## 怎么交给 agent

1. 在原 `meeting-recorder` 项目的开发会话中附上 `meeting-recorder-design-handoff.zip`。如果会话不支持压缩包附件，先解压到原项目的 `docs/design/meeting-redesign/`，再告诉 agent 这个相对路径。
2. 把 [AGENT-TASK.md](AGENT-TASK.md) 的任务正文一起发给它。只有压缩包而没有任务指令，无法明确实施范围和验收要求。
3. 让 agent 核对当前仓库，列出接入计划，先完成应用框架、会议库和会议详情这一批可运行界面，再继续其他页面。不要把五个独立 HTML 直接覆盖进 React 入口。

## 包内内容

| 内容 | 用途 |
| --- | --- |
| `AGENT-TASK.md` | 可以直接交给实施 agent 的完整任务说明 |
| `design/*.html` | 已确认的五个自包含页面，作为视觉和交互参考 |
| `reference/design-system.css` | 从当前页面提取的完整最终样式，包含基础层与精修层 |
| `reference/prototype-interactions.js` | 原型交互参考，需要替换演示数据、存储和服务逻辑 |
| `reference/library-approved.png` | 会议库视觉参考，保留原始图片比例 |
| `docs/design-baseline.md` | 已确认的视觉规范与不可偏离的细节 |
| `docs/integration-map.md` | 页面、组件、IPC 接口和数据字段的对应关系，以及能力差异 |
| `docs/implementation-plan.md` | 分批落地顺序与交付边界 |
| `docs/acceptance.md` | 界面、业务、异常状态和桌面环境的验收清单 |
| `source-baseline.json` | 核对时的代码版本和关键文件哈希；接手时重新检查仓库现状 |
| `manifest.json` | 包内文件的 SHA-256 和大小，校验完整性 |

## 查看和校验

已安装 Node.js 时，在解压目录运行：

```sh
node tools/check-package.cjs
node tools/preview.cjs
```

随后打开终端打印的本地地址。预览使用 HTTP，便于五个页面共享原型状态。页面本身没有 CDN 或远程图片依赖。原型新建的信息使用预览浏览器存储，与原项目的真实会议库独立。

预览命令只启动本地文件服务器；不会启动桌面应用或连接转录、模型服务。

## 实施时必须区分

- 可以迁移：颜色、排版、比例、组件样式、导航结构、证据栏和交互呈现方式。
- 需要接回原应用：会议、项目、分析版本、原文引用、媒体、任务状态、配置、导出和备份。
- 原型限定：内置的 26 秒测试会议、固定示例问答、浏览器本地状态、原型 JSON 备份、示例数据生成方式。
- 尚需明确的能力差异：手动修改已确认项目记录，以及确认前直接改写负责人和期限，详见 `docs/integration-map.md`。这些不能被当作已经存在的后端接口。

开发阶段不要求重新选择视觉方向。当前交付包不包含原项目源码、真实录音、凭据、模型权重、安装包或历史设计版本。
