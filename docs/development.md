# 开发与仓库维护

目录职责：`src/` 是 React 界面与录音采集，`electron/` 是桌面业务、存储和服务调用，`shared/` 保存共享类型，`service/` 是 Python 转录服务，`tests/` 是桌面与业务测试，`scripts/` 提供构建和显式执行的本机验证工具。

## 常规检查

```sh
npm ci
npm run format:check
npm test
npm run build
python -m pip install -r service/requirements-dev.txt
python -m ruff check service scripts
python -m ruff format --check service scripts
python -m pytest service -q
```

使用 `npm run format` 和 `python -m ruff format service scripts` 统一格式。桌面运行环境可追加 `npm run test:e2e`。API 环境没有 PyTorch/VibeVoice 时会明确跳过缓存张量测试。

GitLab 的 `.gitlab-ci.yml` 在 Linux 容器执行格式、核心测试、前端构建和 Python API 测试，需要支持容器的 Runner。桌面测试任务安装 FFmpeg，以运行合成录像的实际解码、截图和音轨测试。推送版本标签（如 `v0.1.3`）后，Windows Runner 会编译安装包并创建对应 GitLab Release；普通分支推送执行验证和源码构建。已移除停用的 GitHub Actions 工作流。CI 不读取真实会议，也不连接模型服务。

按用户确认的 [项目协作约定](../AGENTS.md)，向代理说“推送”默认包括提交源码、推送交付分支及对应版本标签，并检查安装包与 Release，无需再次确认。当前版本已发布且有新改动时默认递增补丁版本，同时更新 `package.json` 和 `package-lock.json`；明确要求只推源码时除外。该约定通过推送标签使用现有 CI 发布流程。

Electron 44 的 npm 包需要显式执行 `node node_modules/electron/install.js` 安装运行库；开发与打包脚本已加入该步骤。重建已有标签时，先确认原标签的 `desktop` 和 `transcription` 验证成功，再在当前构建配置上触发带 `REBUILD_RELEASE_TAG` 与 `REBUILD_RELEASE_SHA`（完整 40 位提交 SHA）的流水线。该路径复用原验证结果，重新执行 Windows 测试、构建及资源检查；构建前检出并核对原标签源码，不移动标签，也不覆盖下游标签。只适用于尚未生成 Release 的构建环境修复，应用代码变更须走新版本。

## GitHub 下游

GitLab 是唯一上游；[GitHub 公共下游](https://github.com/ldy5413/meeting-recorder) 使用独立的文件快照历史，公共仓库不继承 GitLab 的旧提交、作者元数据、分支或标签。旧 GitHub 镜像保留为私有归档。GitHub Actions、Issues 和 Wiki 停用，安装包及 Release 仍由 GitLab 管理。

默认分支推送且常规检查通过后，`publish` 阶段的 `github_mirror` 调用 `scripts/sync-github.sh`。任务通过 `resource_group` 串行执行；若上游默认分支已前进，则跳过旧流水线，避免发布未经该流水线验证的新源码或回退公共文件。版本标签和 Release 重建不触发公共同步。

`scripts/public-sync.mjs` 只读取已提交的文件字节，写入独立临时 Git 库；它不复制源 `.git`、提交消息、作者或标签。公开提交使用固定的 GitHub noreply 身份，只追加到公共 `master`。相同内容不重复提交，删除的源码也会反映到下游；非快进、根提交变化、额外分支／标签及下游独立作者都会中止同步。

导出拒绝私人文件路径、个人主目录、非示例内网地址、私人邮箱、符号链接及未审核的二进制。图片与 ZIP 的审核哈希保存在 `scripts/public-assets.json`；更新它们之前应检查图像和压缩包内容，再更新哈希。每次推送前执行固定版本、固定下载校验值的 Gitleaks，失败时不发布。自动扫描不能识别所有业务隐私，仍须人工审阅新增资料。

新仓库使用专用可写 Deploy Key，经 `ssh.github.com:443` 连接；GitLab CI 变量限定到 `github-public` 环境及受保护分支：`GITHUB_PUBLIC_SSH_KEY_B64` 为 Base64 私钥（Masked、Hidden、Raw），`GITHUB_PUBLIC_KNOWN_HOSTS` 为 GitHub 官方 Meta API 的主机公钥（文件变量），`GITHUB_PUBLIC_ROOT` 固定已审核的公共根提交。旧镜像的部署密钥不能访问新仓库。变量值和私钥不纳入 Git。

不得直接向 `github` 推送 GitLab 分支、`--all`、`--tags` 或 `--mirror`。维护者需要复核初始根提交时使用独立暂存库；常规发布只重试 `github_mirror`，不要重建公共历史。隔离原则和初轮审查见[公开检查](open-source-review.md)。同步回归测试为 `node --test scripts/test-public-sync.mjs`，已纳入 `desktop` 验证任务。

## 本机产物清理

`dist/`、`dist-electron/` 是可重建的编译输出；`test-results/`、`playwright-report/`、`.pytest_cache/`、`.ruff_cache/` 和 `__pycache__/` 是测试输出或缓存。关闭使用这些目录的进程后可删除，后续构建或测试会重新生成。CI 使用的 `.npm/`、`.cache/` 同样不纳入 Git 或格式检查。

`release/` 保存安装包及解包目录，日常清理保留当前版本，删除已不用的旧版本和失败打包的临时目录。`.local/` 混有真实会议验证库、人工核对结果、模型和构建资源，只按已确认用途的子目录清理。保留开发依赖 `node_modules/`、`.venv/`、原始音视频和设计交付包；`docs/design/meeting-redesign/` 及原始 ZIP 按项目约定保持不变。

## 显式执行的真实服务验证

这些脚本会调用实际服务，应使用独立测试库。录音、转录全文、模型输出、凭据、模型权重和安装包不纳入 Git；本机结果放在已忽略的 `.local/` 中。

- `npx tsx scripts/validate-minutes.ts --output=.local/minutes-validation/review`：只读复制安装版已有图文分析，使用已配置的服务生成全场纪要并输出对照统计。支持 `--meeting=<ID>` 和 `--rerun`，正式会议库保持原状。

- `npx tsx scripts/validate-live-meetings.ts <会议ID1> <会议ID2>`：使用已启动开发桥的两场会议，归入验收项目并执行分析及问答。需先通过界面配置服务。
- `npx tsx scripts/vllm-live-retry.ts <已有报告目录> <会议ID>`：延续已有 `final-report.json` 的验证；复用已完成分析，重试问答。
- `python scripts/run-real-asr.py <会议ID...>`：开始或等待真实转录，`--retry` 显式重试失败任务。
- `python scripts/check-real-asr.py --sources .local/sources.json`：校验上一步默认报告；映射文件格式为 `{"会议ID":"原始音频绝对路径"}`。
- `npx tsx scripts/vllm-validation.ts <Meetily会议目录...>`：导入已有转录作独立分析测试。先设置 `VLLM_BASE_URL`，可设置 `VLLM_MODEL`；未提供模型名时查询服务。
- `npx tsx scripts/vllm-resume.ts <验证库目录>`：延续离线测试库；必须设置 `VLLM_BASE_URL` 和 `VLLM_MODEL`，运行前关闭使用该库的其他进程。
- `npx tsx scripts/validate-videos.ts --index=1`：显式处理根目录中指定序号的录像；必须设置 `VLLM_BASE_URL` 和 `VLLM_MODEL`，不再提供实际部署默认值。只使用已授权的本地资料，准备步骤和结果均在 `.local/video-validation/`。
- `npx tsx scripts/validate-video-phase2.ts --index=1` / `--index=2`：从第一阶段内部录像验证库建立独立库，对照新的语音基线与画面补充流程。
- `npx tsx scripts/validate-screen-recording.ts --seconds=7200 --output=.local/screen-soak`：录制专用测试窗口与合成麦克风，记录内存、媒体时长和音画标记漂移；不在 CI 中执行长时间或内部资料测试。

本机历史测试的部署配置和验收范围见 [部署记录](local-deployment.md)。修改脚本参数不改变历史测试数据或结果。
