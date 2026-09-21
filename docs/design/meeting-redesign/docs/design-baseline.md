# 已确认的设计基线

## 优先级与范围

用户已确认当前精修后的视觉方向。以 `design/` 中的五个 HTML 为主要视觉依据；`reference/library-approved.png` 展示会议库整体效果。其他四页也属于交付范围，不应只实现截图里的一页。

视觉参数来自已确认设计；业务规则和数据结构来自原项目当前代码。截图只记录一个示例状态，不能用来推导完整业务规则。

## 颜色与字体

```css
:root {
  --bg: oklch(99% 0.002 240);
  --surface: oklch(100% 0 0);
  --fg: oklch(18% 0.012 250);
  --muted: oklch(54% 0.012 250);
  --border: oklch(92% 0.005 250);
  --accent: oklch(58% 0.18 255);
  --font-display: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  --font-body: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  --font-mono: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, monospace;
}
```

派生色使用现有变量的 `color-mix(in oklch, …)` 或相对 OKLch，不额外引入一套色板。状态色与强调色分工明确。普通文本对比度至少 4.5:1，大字和图标至少 3:1，悬停不能降低文字对比度。

## 界面语言

- 轻灰背景承托白色工作区。桌面侧栏轻量，主内容使用清晰网格与留白。
- 首页石墨色会议速览是主要视觉重心，内容由真实会议数据驱动。示例中的 `00:26`、三段发言和会议标题都不是生产环境常量。
- 标题、正文、元数据具有明确的字号和字重差异。正文适合中文长文阅读，时间与数量采用对齐的数字。
- 圆角克制，分隔线细，阴影主要用于浮层。避免给每块内容增加彩色卡片或图标。
- 会议详情围绕纪要组织，引用栏与正文并列，可收起。窄窗口下重新排列；不要将固定宽度强塞进容器。
- 普通交互目标至少 44 × 44px；键盘焦点明显。弹窗可用键盘操作，关闭后焦点返回触发控件。

## 建议组件拆分

以下名称是建议拆分方式，不是原仓库已经存在的文件：

| 建议组件 | 职责 |
| --- | --- |
| AppShell / Sidebar / WorkspaceHeader | 全局导航、项目上下文、录制状态入口 |
| MeetingLibrary / FeaturedMeeting / MeetingList | 会议选择、搜索筛选、内容速览 |
| MeetingWorkspace / MeetingHeader / MeetingTabs | 当前会议、操作、章节切换 |
| AnalysisView / ClaimItem / EvidencePanel | 递归纪要章节、建议、引用核对 |
| TranscriptEditor / MediaPlayer | 原文校对、说话人映射、回听与播放 |
| ProjectTracking / RecordDetails | 待确认建议、正式记录和变更历史 |
| MeetingAsk / ServiceSettings / TemplateEditor | 问答范围、服务配置、模板管理 |

复用现有组件和采集类优先。不要为了套建议名称而重写已经可靠的业务实现。

## 参考文件的使用

`reference/design-system.css` 是从当前 HTML 提取的最终完整样式，已包含原型基础样式与视觉精修覆盖层，不依赖 OpenDesign 的私有技能目录。迁移到 React 后可以按组件整理样式，但应保持计算后的视觉结果。

`reference/prototype-interactions.js` 仅用于理解界面操作意图。正式应用的实现应接回 typed IPC；其中的演示状态、身份标识和本地模拟存储不构成业务规范。
