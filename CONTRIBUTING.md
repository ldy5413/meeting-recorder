# 参与改进 · Contributing

会议手记目前由 GitLab 上游开发、合并和发布；GitHub 是具有独立公共历史的源码快照下游，Actions 停用。GitHub 上的提交不会自动反向同步，也不要把公共历史合并回上游。上游目前需要访问权限，准备贡献前请先通过已有的项目联系渠道与维护者协调接收方式。

Development, merges and releases happen on GitLab. GitHub contains source snapshots with independent public history and Actions disabled. Changes made there are not merged back automatically; do not merge the public history into the upstream. The upstream currently requires access. Coordinate with the maintainer through an existing project contact before preparing a contribution.

## 开发与验证

Node.js 24 与 npm 为基础环境。Windows 本地转写构建还需要 Python 3.12。目录职责、启动方式、Python 检查和 CI 说明见 [README](README.md) 与[开发说明](docs/development.md)。

```sh
npm ci
npm run format:check
npm test
npm run build
```

界面和桌面行为修改需要相应的 Electron 测试；Python 服务修改需要其 lint、格式与测试。提交时说明具体问题、改动后的行为、验证结果和未验证的部分。

## 测试资料与隐私

- 使用人工合成或明确允许公开的测试资料；示例见 [fixtures/transcript.json](fixtures/transcript.json)。
- 私人音视频、会议原文、模型回答、数据库、备份和服务凭据放在 Git 忽略的 `.local/` 或仓库外。
- 文档使用 `example.com`、占位模型名和通用路径；不要填写自己的内网部署地址、个人目录或访问令牌。
- 提交截图和日志前检查姓名、会议标题、桌面通知、服务地址与密钥。
- 真实服务验证脚本会处理会议数据，只对明确授权的资料和服务显式运行；它们不属于常规 CI。

Use synthetic or explicitly public fixtures. Keep private meetings, model outputs, databases, backups and credentials out of Git. Review screenshots and logs before sharing. Real-service validation is an explicit local task and is not part of routine CI.

项目原始设计目录 `docs/design/meeting-redesign/` 与设计 ZIP 按现有约定保持字节不变。公开前涉及历史与镜像的注意事项见[仓库公开检查](docs/open-source-review.md)。
