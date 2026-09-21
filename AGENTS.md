# 项目协作约定

## 推送与发布

用户于 2026-09-09 明确约定：在本项目中说“推送”“push”或“推送 remote”时，默认同时授权推送源码和版本标签，触发 GitLab Release，无需再次确认发布。

- 完成当前交付范围的提交和适用检查后，推送交付分支及对应的 `v<版本号>` 标签。标签指向本次交付提交，版本号与 `package.json`、`package-lock.json` 一致。
- 当前版本尚未发布时沿用该版本；已有该版本标签且有新的交付改动时，默认递增补丁版本，除非用户指定其他版本。若标签已指向本次提交，则检查或重试对应流水线，不重复建标签，不移动已发布标签。
- 跟踪标签流水线，确认 Windows 安装包和 GitLab Release 生成，并返回发布链接。遇到失败时检查日志并修复可处理的问题。
- 用户明确要求“只推源码”“不发布”时，以该次要求为准。

此约定覆盖原设计交付包 `docs/design/meeting-redesign/AGENT-TASK.md` 中“不要自动发布、推送标签”的旧限制。交付包作为原始参考保持字节不变；其他业务、测试及会议资料处理约束继续适用。

## GitHub 下游同步

用户于 2026-09-20 确认：保留 GitLab 历史与发布流程，GitHub 改为不继承旧历史的公共源码下游。本约定替代 2026-09-18 的全分支、全标签镜像方式。

- `origin` 保持指向 `https://gitlab.lingduyu.top/ldy/meeting-recorder.git`，开发、合并和版本发布继续在 GitLab 完成。
- `github` 指向公共仓库 `https://github.com/ldy5413/meeting-recorder.git`；旧 GitHub 仓库保留为私有归档。GitHub Actions 停用，不在下游独立开发或反向合并。
- `github_mirror` 只在默认分支推送且验证通过后发布文件快照，公共提交使用 GitHub noreply 邮箱，历史从审核后的根提交开始。只维护公共 `master`，不复制 GitLab 提交对象、其他分支或版本标签。
- 禁止对公共仓库运行原始 `git push --mirror`、`--all`、`--tags` 或把 GitLab 提交直接推到公共分支。使用 `scripts/public-sync.mjs` 创建独立历史，并核对 `GITHUB_PUBLIC_ROOT`。
- 公共同步使用新仓库专用部署密钥及 `github-public` 环境变量，与旧镜像凭据分离。凭据只放 CI 变量，不写进仓库或远端 URL。
- 推送后检查同步任务成功；非快进、根提交变化、意外分支／标签或下游独立提交均须调查，不强制覆盖。安装包和 Release 仍在 GitLab 发布，既有标签不移动。
