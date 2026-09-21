# 转录服务与 P0 实测

## 版本与环境

本次实现参考 Microsoft 官方仓库 `1541f590c7099820f10ea012f48d2399282df69f`，模型标识 `microsoft/VibeVoice-ASR`，权重固定为 `d0c9efdb8d614685062c04425d91e01b6f37d944`。已在本机 Windows CUDA 环境下载并校验全部权重，通过真实录音冒烟测试。当前配置和完整环境锁定见 [本机部署](local-deployment.md)。

官方资料：[ASR 文档](https://github.com/microsoft/VibeVoice/blob/1541f590c7099820f10ea012f48d2399282df69f/docs/vibevoice-asr.md)、[文件推理示例](https://github.com/microsoft/VibeVoice/blob/1541f590c7099820f10ea012f48d2399282df69f/demo/vibevoice_asr_inference_from_file.py)、[Electron 音频采集限制](https://www.electronjs.org/docs/latest/api/desktop-capturer/)。适配器调用官方模型与处理器接口，统一输出片段 ID、秒级时间戳、会议内说话人 ID 和文本。

当前采用 Windows 原生 CUDA、NF4 量化和 5 分钟重叠窗口适配约 12 GB 显存。以下为其他机器的通用部署示意，本机应使用 `scripts/start-asr.ps1`。CPU 速度和内存需求尚未实测；本次没有购买算力。

在已正确安装适配 CUDA 的 PyTorch 和 FFmpeg 的 Python 3.12 环境中：

```sh
git clone https://github.com/microsoft/VibeVoice.git
git -C VibeVoice checkout 1541f590c7099820f10ea012f48d2399282df69f
python -m pip install -e ./VibeVoice
python -m pip install -r service/requirements-lock.txt
export VIBEVOICE_MODEL=microsoft/VibeVoice-ASR
export VIBEVOICE_DEVICE=cuda
export VIBEVOICE_ATTENTION=sdpa
export VIBEVOICE_CHUNK_SECONDS=2700
python -m uvicorn service.app:app --host 127.0.0.1 --port 8765
```

运行目录需为本项目根目录。`VIBEVOICE_MODEL` 也可指向固定版本的本地权重目录。CPU 使用 `VIBEVOICE_DEVICE=cpu`；GPU / CPU 混合调度可尝试 `auto`，均需要单独基准。不要把未验证配置当成性能承诺。

远程部署：为 API 配置 TLS 反向代理，将 `MEETING_ASR_TOKEN` 设为随机令牌，代理应限制上传大小和连接数。桌面端允许显式配置的私网 HTTP，公网地址要求 HTTPS。服务会保留上传音频、分段缓存及原始输出；操作者负责远程主机的访问权限和数据清除。

## 任务协议

| 方法   | 路径           | 行为                                                     |
| ------ | -------------- | -------------------------------------------------------- |
| GET    | `/health`      | API 版本、模型标识及是否安装 VibeVoice；不加载权重       |
| POST   | `/jobs`        | multipart 字段 `audio`，返回任务；支持 `Idempotency-Key` |
| GET    | `/jobs/{uuid}` | 状态、步骤、错误；完成时返回 segments、raw、metrics      |
| DELETE | `/jobs/{uuid}` | 持久化取消状态并终止推理进程                             |

状态为 `uploading / queued / running / complete / failed / cancelled`。服务重启后，未完成步骤标记失败；以原幂等键重新提交可复用上传和已完成分段。上传未完成时不会复用半个音频。桌面端网络重试复用远程任务 ID。服务采用单进程调度器，不能用多个 uvicorn worker 指向同一数据目录。

音频默认最大 4 GiB，可通过 `MEETING_MAX_UPLOAD_BYTES` 调整。`FFMPEG`、`FFPROBE` 可指定可执行文件路径。FFmpeg 以参数数组运行，不拼接 shell 命令。

## 长会议策略

通用服务默认每段 45 分钟，重叠 20 秒，长度上限不超过官方支持的 60 分钟。本机启动脚本覆盖为 5 分钟窗口，以适配显存。90 分钟的通用窗口是 `[0,2700]`、`[2680,5380]`、`[5360,5400]` 秒。每段缓存转换结果，失败重试复用相同模型配置的已完成段。

结果时间加回原始偏移；仅在时间区间重叠且规范化文本完全一致时去重。相似但无法确定的重复保留给人工校对。原始分段缓存保留独立说话人前缀，最终结果使用本机声纹模型统一跨段身份（包括失败后拆出的子窗口）。部署依赖、旧转录修复及限制见 [说话人统一](speaker-resolution.md)。当前策略未声称能自动消除所有长会议重复、抢话和漂移问题。

## 基准命令

```sh
python -m service.benchmark sample-90min.wav --output .local/reports/90min-gpu.json
python -m service.benchmark sample-mixed.wav --reference human-transcript.txt --output .local/reports/mixed-gpu.json
```

命令会真正向配置的服务上传录音；默认本机，可用 `--url` 指定远程服务。输出任务状态、端到端耗时、模型配置、音频时长、GPU 分配峰值；提供人工原文时还计算保留标点大小写、去空白后的字符错误率。服务失败也会生成失败报告并返回非零退出码。

仍需补充人工说话人标注、重叠语音和关键术语标注，并记录峰值系统内存、CPU 模式耗时及价格来源。没有这些资料时，不报告准确率、关键事项召回率或远程 GPU 费用数字。
