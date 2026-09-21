# 本机部署与真实会议验证

2026-09-04 在 Windows 11 x64、Python 3.12、RTX 3500 Ada Laptop（12282 MiB）上部署。录音原文件只读，导入副本、转录、模型输出及测试库保存在本机。只有转录文字和检索依据发送至用户指定的 vLLM；没有购买算力。

## 启动已部署的服务

在项目根目录运行：

```powershell
powershell -NoProfile -File scripts/start-asr.ps1
npm run dev
```

转录 URL 为 `http://127.0.0.1:8765`。分析 Base URL、模型名和 API Key 在应用设置中填写；模型名以自己的服务 `/v1/models` 返回值为准，历史测试上下文预算为 65536。公开文档不保存实际部署地址、模型目录或个人录音路径。界面先确认文字发送范围，再测试连接。应用允许用户配置的私网 HTTP 地址，公网服务要求 HTTPS。

本次 Orca 验收使用单独的 `%LOCALAPPDATA%/MeetingRecorder-dev-browser` 数据目录。要继续查看该库，运行 `scripts/dev-browser.ps1`；开发桥仅在源码运行时启用，监听随机 loopback 端口，使用随机凭据、Origin / Host 校验。端口和凭据保存在本机 `dev-bridge.json`，不应分享。打包应用不启用开发桥。

## 复现本机推理环境

FFmpeg 需在 PATH 中。以下命令适用于本次 Windows CUDA 环境；CPU、Mac 或其他 CUDA 版本应建立独立环境。

```powershell
py -3.12 -m venv .venv
git clone https://github.com/microsoft/VibeVoice.git .local/VibeVoice
git -C .local/VibeVoice checkout 1541f590c7099820f10ea012f48d2399282df69f
.\.venv\Scripts\python.exe -m pip install -r service/requirements-windows-inference-lock.txt
.\.venv\Scripts\python.exe scripts/download-vibevoice.py
.\.venv\Scripts\python.exe scripts/verify-vibevoice.py
.\.venv\Scripts\python.exe scripts/download-speaker-model.py
.\.venv\Scripts\python.exe -m pip check
```

模型 `microsoft/VibeVoice-ASR` 固定为 `d0c9efdb8d614685062c04425d91e01b6f37d944`，8 个权重分片共约 17.35 GB，全部通过官方 blob SHA-256 校验。权重位于 `.local/models/VibeVoice-ASR`。下载脚本同时缓存 `Qwen/Qwen2.5-7B` tokenizer（`d149729398750b98c0af14eb82c78cfe92750796`），后续任务直接使用本机缓存，避免重复网络检查。下载请求不包含会议内容。

已验证依赖包括 PyTorch / torchaudio 2.11.0+cu128、Transformers 4.57.6、bitsandbytes 0.50.2。完整环境锁定在 `service/requirements-windows-inference-lock.txt`；轻量 API 测试依赖仍独立保留。

## 12 GB 显存配置

- 语言模型采用 NF4 双重量化，BF16 计算；语音编码器与连接层保持 BF16。
- SDPA attention；每次输入 300 秒，窗口重叠 20 秒；语音编码器内部流式窗口 20 秒。
- 推理时仅投影最后一个位置的语言模型 logits，避免音频前缀所有位置同时投影到完整词表；不改变生成的 KV 状态。
- 贪心生成，上限 8192 tokens / 每次生成 600 秒；未正常结束时保存不完整原始输出，只将失败窗口二分（保留 10 秒重叠），最多三层。此前 180 秒上限对本机正常长输出过紧，已放宽。仍失败则明确报错，不接收残缺文本。每个会议独立进程，单队列串行，取消可释放模型。
- 分段缓存带模型、量化与窗口配置指纹，重试不混用旧配置。原始分段结果独立保留。
- 上游语音流式缓存的尾部视图改为独立复制，避免小缓存继续持有整段卷积激活；真实张量测试验证缓存数值一致、底层存储只占所需大小。
- 窗口间及编码完成后释放 PyTorch 闲置 CUDA 缓存。编码结束后，四个 BF16 语音模块暂存 CPU，下一窗口再移回 GPU；语言模型保持 GPU 推理。`VIBEVOICE_OFFLOAD_SPEECH=0` 可关闭该行为，需另测显存。

这属于本机适配配置，并非官方 BF16 精度基准。2026-09-06 起，最终结果增加 CPU 声纹匹配以统一跨窗口说话人；历史原始分段仍保留独立编号。保守文本去重不保证消除全部重叠。已有环境升级和实测见 [说话人统一](speaker-resolution.md)。

## 验证资料

60 秒真实录音冒烟测试已成功，产生 7 个片段：包括冷加载在内耗时 51.34 秒，进程 RSS 采样峰值约 3.21 GB，PyTorch 显存分配峰值约 10.48 GB。该冒烟使用编码器默认 60 秒窗口，完整会议改用上述 20 秒窗口。显存统计不是整机显存占用，RSS 不含其他应用。

两场完整音频分别长 3303.62 秒（样本 A）和 1860.02 秒（样本 B），不能替代单场 90 分钟验收。真实转录结果与已有 Meetily 转录存于不同会议，不能混称。完整运行指标保存在私有 `.local/real-asr-report.json`；分析与浏览器验证见 [vLLM 验证](vllm-integration.md) 和 [Orca 验证](orca-browser-verification.md)。

两场完整转录均已完成，完整性检查脚本 `scripts/check-real-asr.py` 通过：全部片段 ID 唯一、按时间排序、时间戳在对应音频范围内，服务收到的音频 SHA-256 与两个原文件完全相同。私有检查结果为 `.local/real-asr-integrity.json`。

| 录音   |   音频时长 | 有效片段 | 最终恢复轮耗时 | PyTorch 分配峰值 | 进程 RSS 采样峰值 |
| ------ | ---------: | -------: | -------------: | ---------------: | ----------------: |
| 样本 A | 55.06 分钟 |      562 |     42.99 分钟 |          9.12 GB |           4.82 GB |
| 样本 B | 31.00 分钟 |      254 |     19.31 分钟 |          9.12 GB |           4.84 GB |

GB 按十进制计。耗时包含最后一轮冷加载，但**不是每场从零开始的总耗时**：样本 A 复用了首窗 155 秒子窗口；样本 B 复用了前三个完整窗口，且仍使用当时的 180 秒生成上限。`cached_windows` 只统计完整窗口，不包含子窗口。两场监测期间总墙钟时间 92.75 分钟，包含排队、开发修复、中断和重试，不宜当作稳定吞吐基准。独立跨窗说话人标签分别为 39 / 27，不能当成真实参会人数。

尚无人工标注的完整逐字稿和关键事项清单，因此不报告 CER、说话人准确率或 90% 召回达标。有效引用仅代表能回到原文，不能代替语义正确性验收。Mac 实机、CPU 基准及硬件故障矩阵仍待验证。

持续运行至本地 18:27 时，`nvidia-smi` 明确报告 `SW Thermal Slowdown: Active`，采样核心频率 705 MHz、功耗约 26 W。该次运行耗时受热降频影响，不能视为同配置下稳定性能承诺；原始设备诊断保存在 `.local/nvidia-thermal-20260904-1827.txt`。没有修改驱动功率限制或热保护设置。

额外的 10 秒合成全静音 WAV 经真实 VibeVoice 处理后返回一个覆盖 0–10 秒的 `[Silence]` 标记，没有生成口语内容。包含冷加载的 worker 耗时 63.78 秒，结果保存于 `.local/asr-silence.json`。该测试不属于两场真实会议，也未用规则绕过模型推理。
