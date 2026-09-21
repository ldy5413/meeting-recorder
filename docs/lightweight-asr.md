# 内置 CPU 转录：独立验证版

本页保留集成前的实验过程与评估结果。0.2.5 已接入中文 Qwen3、英文 SenseVoice，模型改为安装后按需下载；当前使用与打包说明见 [Windows 本地转写](bundled-asr.md)。

本阶段以普通 Windows、无需独显、安装包内置模型、录完后处理为目标，先验证真实会议，再决定默认引擎。实验程序不接入生产 `/jobs`，不改桌面默认设置、会议数据库、历史转录或外部 LLM 配置。它不是已交付的内置模型安装包。

## 推理流程与资源

固定使用 sherpa-onnx 1.13.8 CPU runtime、SenseVoiceSmall INT8、Silero VAD、Pyannote segmentation 3.0 和 WeSpeaker ResNet34-LM。全部模型和词表共 **274,400,722 字节（274.4 MB / 261.7 MiB）**；这不包含 Electron、FFmpeg、运行库和安装包压缩开销。文件来源、版本、长度和 SHA-256 位于 `service/lightweight_models.py`，下载及每次推理均校验模型。Python 仅用于独立实验编排，无 PyTorch、Transformers 或 CUDA 依赖。

先在整场录音上分离说话人，再按 VAD 窗口转写。ASR 设置自动语言、ITN、4 线程，VAD 配置最大语音时长 20 秒（上游通过提高阈值尝试切分，不是严格的 20 秒硬上限）。说话人聚类采用默认距离阈值 0.5，未预设人数。短语音和多人重叠可能产生错误分组；分组数不等于实际参会人数。

用模型的 CTC token 起始时间与说话人时间区间相交，同一时间有多个候选或没有候选时标为 `unknown`，不猜姓名。片段保持 `id/start/end/speaker/text` 形状，但只写入独立报告。结束时间由下一 token 起点推算，并限制到当前 token 后 0.6 秒及 VAD 结尾；这是回听定位估计，不能当成精确强制对齐。当前不支持 VibeVoice 的会议背景提示词，不以 LLM 改写原文掩盖识别错误。

现有 WeSpeaker 原始 ONNX 没有 sherpa 所需的模型 metadata；本实验使用 sherpa 发布的同型号转换文件，单独固定哈希，未覆盖原来的声纹模型。

## 复现

在项目根目录建立独立环境（以下使用现有 Python 3.12）：

```powershell
.venv/Scripts/python.exe -m venv .local/lightweight-asr/venv
.local/lightweight-asr/venv/Scripts/python.exe -m pip install -r service/requirements-lightweight.txt
.local/lightweight-asr/venv/Scripts/python.exe scripts/download-lightweight-models.py --native-windows .local/lightweight-asr/native
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-lightweight.py <本地录音路径> --output .local/lightweight-asr/new-run
```

输出目录必须是新目录，避免覆盖已有结果。FFmpeg 在本机把输入解码为 16 kHz 单声道 PCM16；原始文件只读。输出包含 `report.json`、`memory.json`、用于回听的 `audio.wav` 和 `review.html`。报告含原文件及解码音频 SHA-256、模型指纹、硬件和配置、完整机器输出、时间及内存指标。准备阶段下载依赖和模型需要联网；下载器不读取会议资料，实验推理不请求外部模型服务。

解码 v2 用 `aresample=16000:async=1:first_pts=0` 尊重音频包的原时间戳，并按探测到的原文件/选区时长截断，解码时长差超过 100 ms 即失败。首轮 July 文件直接拼接解码样本得到 3307.728 秒，而原媒体时间轴为 3303.621333 秒；该首轮结果只用于问题诊断，不参与最终回听定位验收。只做普通重采样不足以保证压缩音频的时间轴一致。

可选参数：

- `--baseline <json>`：本地历史 VibeVoice 片段数组或含 `segments` 的对象，仅用作回听对照，不是标准答案。
- `--offset 120 --seconds 60`：测试原文件从第 120 秒开始的一分钟，报告时间从该片段零点起算。
- `--no-speakers`：单独测 ASR，片段说话人均为 `unknown`。
- `--speaker-threshold 0.5`：说话人聚类距离阈值；调整只用于实验，分组数量变少不等于分组变正确。
- `--repeat-to 5400`：循环源音频构造 90 分钟耐久测试；报告明确标为合成重复音频，不能冒充真实 90 分钟会议验收。

`review.html` 可在本机浏览器打开，用同一音频对照两种机器输出。默认抽取分散在整场录音中的五个 30 秒窗口及待确认说话人附近窗口（重复起点去重），人工记录正确文字、术语、换人及时间偏移，再导出核对记录；导出前不要离开页面。页面没有外部资源或数据上传。所有私人结果留在 Git 忽略的 `.local/`。

逐字稿初始为空，听完对应回听范围后填写并勾选已核对。导出的 `manual-review.json` 带原音频及解码音频哈希，可单独计算人工核对片段的字错率：

```powershell
.local/lightweight-asr/venv/Scripts/python.exe scripts/score-lightweight.py .local/lightweight-asr/new-run/report.json <manual-review.json路径> --output .local/lightweight-asr/new-run/human-scores.json
```

未勾选、空参考文字或音频哈希不匹配不会产生有效分数。评分按 CTC token 起始时间选取对应范围，采用 Unicode NFKC、大小写折叠、去空白与标点的字符编辑距离，数字和其他符号保留；重叠窗口分别报告，不重复累计成整场指标。不提供自动生成的“人工标准答案”，字错率也不代表说话人或时间戳准确率。

原生 Windows 程序独立冒烟（不调用 Python，输入须已解码）：

```powershell
powershell -NoProfile -File scripts/smoke-lightweight-native.ps1 -Audio .local/lightweight-asr/new-run/audio.wav -OutputDirectory .local/lightweight-asr/native-new-run
```

脚本在子进程 PATH 中仅保留原生程序目录和 Windows 目录，分别执行转写与说话人分离，记录退出码及日志。这证明开发机上的原生程序路径可以脱离 Python/CUDA PATH 运行，不能代替干净 Windows 或 Electron 安装包验证。

## 验证边界与集成条件

2026-09-19 本机实测（十进制 MB/GB，全部为 CPU、4 线程）：

| 输入                     |   音频时长 |   处理耗时 | 进程内存峰值 | 结果                                                                  |
| ------------------------ | ---------: | ---------: | -----------: | --------------------------------------------------------------------- |
| 真实录音短片段           |   60.07 秒 |   12.94 秒 |       435 MB | 转写与说话人流程完成                                                  |
| July 完整录音，解码 v2   | 55.06 分钟 |  7.71 分钟 |      1.17 GB | 1391 段，默认阈值产生 40 个说话人分组，499 段待确认；说话人质量未通过 |
| August 完整录音，解码 v2 | 31.00 分钟 |  3.84 分钟 |       649 MB | 573 段，默认阈值产生 25 个说话人分组，198 段待确认；说话人质量未通过  |
| July 循环音频耐久测试    | 90.00 分钟 | 12.80 分钟 |      1.88 GB | 完成 2237 段，无崩溃；合成重复音频，不是真实 90 分钟会议验收          |
| 全静音                   |   10.00 秒 |    1.80 秒 |       366 MB | 零条文字、零个说话人                                                  |

短录音中可见材料术语“峰/风”等疑似错字，不能把模型体积和运行速度的改善视为识别质量已通过。自动聚类出现大量零碎分组，尚不具备替换现有默认转录流程的验收依据。私有报告及回听页面位于 `.local/lightweight-asr/` 下的 `smoke/`、`july-v2/`、`august-v2/`、`soak-90m/`、`silence/`；原生双程序冒烟结果位于 `native-smoke/`。总览入口为 `.local/lightweight-asr/index.html`，不发布到网络。

原生 Windows 转写和说话人程序均以退出码 0 完成 60 秒冒烟；两个 EXE、ONNX Runtime 的两个 DLL 与模型文件合计 **295,427,026 字节**，未计 Electron、FFmpeg 和打包压缩。两个命令行程序当前分别输出结果，仍需桌面任务层整合。

验证检查：Python 测试 44 项通过，覆盖说话人换人/重叠/空档、token 文字保留、时间戳异常、模型损坏、压缩媒体时间轴与片段截取、人工参考评分；Ruff、仓库 Prettier 检查通过。Chromium 本地文件测试验证回听、跳转、核对记录导出和窄屏布局，未出现页面脚本错误或 HTTP 请求。两场录音的原文件哈希未变，片段 ID 唯一、时间戳不越界，按说话人分段前后的识别文字一致。

耗时按独立新进程统计，包含模型校验、导入、解码和加载；不复用旧转录缓存。Windows 内存使用进程 `peak_wset`，另提供每 100 ms 采样的进程树 RSS；这些不是整机内存占用。历史 VibeVoice 耗时包含缓存和恢复轮次，不能据此计算严格的加速倍数。

当前机器为 i7-14700HX、约 64 GiB RAM，强制 CPU 推理；尚不能代表目标 16 GB 普通笔记本的速度。人工逐字稿、说话人标注和时间戳金标准尚未建立，因此不报告 CER、DER、术语准确率或定位准确率；机器输出一致也不代表正确。

是否替换默认引擎需先核对术语、短句换人和重叠讲话。后续安装包阶段仍需实现运行进程生命周期、取消与恢复、模型资源打包、适用的 FFmpeg 分发方案、本地/远程转录选择和数据发送权限区分，并在无 Python/CUDA、断网的干净 Windows 与目标硬件上验收。保持现有原文版本、人工姓名确认、引用和分析失效规则。

## 来源与许可

- [SenseVoice 转换与 CPU 文档](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)：转换文件的 LICENSE 指向 FunASR；官方权重采用 [FunASR 模型协议](https://github.com/modelscope/FunASR/blob/58830eca4012644aac0c3218c3ccc7d98f003fda/MODEL_LICENSE)，不是仓库代码的 MIT 许可。保留模型名、来源和作者。
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8)：Apache-2.0；本实验选择 Windows x64 MT Release、无 TTS 原生包。
- [Pyannote segmentation 转换](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/tree/9403a6902bb58e3d5ae8c7e77c3422de279db2e0)：附带 MIT 许可。
- [Silero VAD](https://github.com/snakers4/silero-vad/tree/60b7ffa243625ebdc1070275a29f18c87843786a)：MIT。
- [WeSpeaker ResNet34-LM](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM)：模型卡标记 CC-BY-4.0。

下载器保存许可原文/模型卡及来源摘要在模型目录的 `licenses/` 与 `manifest.json`。正式安装包还须包含运行库和解码器适用的第三方声明；本实验没有发布权重或安装包。

## 第二轮：安装版真实资料与其他 CPU 候选

2026-09-20 从本机安装版的 SQLite 以 `mode=ro` 导出 6 场未删除会议，原文件只读，导出前后核对 SHA-256。每场固定取 10%、50%、85% 位置的 20 秒片段，共 18 段、6 分钟。前三场为开发集，后三场为保留集，集合按整场会议划分。导出器不会把保存的机器稿当成人工答案；已检查的后续版本没有文字修订，少量说话人标签修改也不足以形成说话人金标准。

所有实验都保留在 `.local/lightweight-asr/`，未接入生产任务 API，未修改已安装软件、数据库或录音。以下速度是固定片段的纯识别耗时，不包括模型加载、整场 VAD、说话人处理及打包开销；内存是进程峰值。仍是 64 GiB 开发机上强制 CPU、4 线程的结果。

| 模型                              |    开发集 180 秒音频 | 保留集 180 秒音频 | 进程内存峰值 | 观察                                                 |
| --------------------------------- | -------------------: | ----------------: | -----------: | ---------------------------------------------------- |
| SenseVoiceSmall INT8              |              4.81 秒 |           5.72 秒 |       415 MB | 快，有 CTC token 时间戳；专业术语仍有疑似错误        |
| Qwen3-ASR 0.6B INT8               | 47.41 秒（无关键词） |          42.17 秒 |      2.42 GB | 部分“首效、固溶”表现较好；缩写仍不稳定               |
| FunASR Nano INT8 + 已有会议关键词 |             48.33 秒 |          47.63 秒 |      1.74 GB | 某些材料名称有所改善；也存在疑似重复、漏字和同音错字 |
| FireRedASR2 AED INT8              |             97.36 秒 |         110.97 秒 |      1.92 GB | 本批样本中未见明确整体优势，专业词仍需核对           |

Qwen3 另有使用已有会议关键词的开发集对照，记录在 `qwen3-context-development/`。只用会议原先保存的关键词，不从历史机器稿反向制作提示词。术语示例只是不同机器输出的诊断线索，没有经人工听音判分，不能据此推算 CER。四种方案均未证明达到 95%；保留集也尚无人工参考。FireRedASR2 AED INT8 的固定抽样结果位于 `firered2-all/`，同样需要听音判分。

Qwen3、FunASR 和此次 FireRedASR2 AED 的 sherpa 路径 token 时间戳均为空。不能把 SenseVoice 的时间戳直接贴在另一份文字上，也不能平均分配时间冒充对齐。若选用这些模型，需要额外验证逐字对齐，或采用明确标注粒度的音频片段定位。实际集成前仍需完整长会测试。

针对低语音片段的模型分歧，又测试了已验证全零采样的 10 秒数字静音：直接 ASR 推理时 Qwen3、FunASR 均输出空文本，FireRedASR2 AED 生成了 5 个字符。因此后者不能未经 VAD 直接对任意片段转写；这项测试是合成静音边界检查，不计入真实会议准确率。记录在 `candidate-silence-corpus/` 和各候选的 `*-silence/` 下。

原生 `sherpa-onnx-offline.exe` 分别在仅保留运行库及 Windows 目录的 PATH 下完成 20 秒片段：Qwen3 耗时 8.73 秒，FunASR 9.05 秒，均退出码 0，含启动与模型加载。结果在 `candidates-native-smoke-v2/`；首轮测试遇到 PowerShell 进程退出码为空，已通过在轮询前保留进程句柄修复。这仍不是安装包、干净 Windows 或 16 GB 目标机验收。

### 说话人实验

新增 CAM++ 中英文模型，保留先前 Pyannote 的时间边界，对每个合适的语音轮次取 0.8–8 秒声纹片段，再使用项目已有的稳定声音原型归并方法。缓存绑定音频、模型、原报告、抽样范围及归并代码哈希。只重算声纹和归并，未把缓存的分割耗时计入新模型的速度。

| 原录音 | 原分组 | CAM++ 归并后主要组 | 未解决轮次（阈值 0.65） | 未解决说话时长 / 总说话时长 | 被归入同组的原重叠区间 |
| ------ | -----: | -----------------: | ----------------------: | --------------------------: | ---------------------: |
| July   |     40 |                  2 |               115 / 756 |          97.34 / 2490.23 秒 |               29.97 秒 |
| August |     25 |                  2 |                88 / 324 |          45.21 / 1166.27 秒 |               12.94 秒 |

在 0.55、0.65、0.75 三个余弦阈值下主要组数稳定，但组数不等于正确人数，未解决时长比例也不是错误率。同样的归并方法配原 WeSpeaker，在 July 只形成一个主要组，原重叠区间有约 110 秒被归到同组；因此不能仅以“组数少”“覆盖高”选择方案。CAM++ 的结果仍需核对人物身份、短应答和重叠讲话，不能当作 DER 小于 5% 的证据。

### 复现与人工验收

```powershell
.local/lightweight-asr/venv/Scripts/python.exe scripts/download-asr-candidates.py qwen3 funasr firered2 campplus
.local/lightweight-asr/venv/Scripts/python.exe scripts/build-asr-corpus.py --output .local/lightweight-asr/new-corpus
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-asr-candidates.py .local/lightweight-asr/new-corpus/corpus.json --engine qwen3 --hotwords --output .local/lightweight-asr/new-qwen3
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-cpu-speakers.py .local/lightweight-asr/july-v2/report.json --audio .local/lightweight-asr/july-v2/audio.wav --output .local/lightweight-asr/new-speakers
```

候选识别支持 `--split development|holdout|all`，每完成一段立即落盘；`--resume` 要求语料、模型文件、线程数和运行库等一致。旧 v1 结果保留原始记录，不能用 v2 配置续跑。说话人实验也支持核对指纹后续跑，改变阈值时可复用声纹；不预设或强迫参会人数。

`scripts/review-asr-candidates.py` 生成本地回听页：机器输出默认折叠，正确文字初始为空，修改文字会清除“已核对”状态，支持草稿、导入及导出。当前四模型入口为 `.local/lightweight-asr/accuracy-review.html`。可先核对保留集 9 段（3 分钟），再在开发集分析术语。页面无外部资源或上传请求，导出含语料/音频哈希和核对人。

```powershell
.local/lightweight-asr/venv/Scripts/python.exe scripts/review-asr-candidates.py .local/lightweight-asr/new-corpus/corpus.json --report .local/lightweight-asr/new-qwen3/report.json --output .local/lightweight-asr/new-review.html
.local/lightweight-asr/venv/Scripts/python.exe scripts/score-asr-candidates.py .local/lightweight-asr/new-corpus/corpus.json .local/lightweight-asr/new-qwen3/report.json <human-asr-review.json> --output .local/lightweight-asr/new-score.json
```

评分使用完整固定片段，避免混用不同模型的近似 token 时间戳。严格保留数字与符号，不做语义改写；中文数字与阿拉伯数字的写法差异会影响 CER，需连同逐字错误明细解释。无声片段须明确确认，错误生成的文字作为插入计数；听不清、未核对或未推理的片段仍留在覆盖率分母，不允许只挑容易样本获得“通过”。只有对应集合全部片段都完成有效核对、评估，且 CER ≤ 5%，才显示该抽样集合满足阈值。该结果也不能代表整场会议或未来录音均达到 95%，说话人、定位和纪要另行验收。

新增评分边界检查后 Python 全套测试 **52 项通过**；本地 Chromium 检查了 18 段展示、9 段保留集筛选、音频播放、草稿恢复、修改后清除核对、导出状态、手机宽度布局，以及无页面错误/HTTP 请求。

候选来源：[Qwen3 的 sherpa 原生模型](https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/pretrained.html)、[FunASR Nano 原生模型](https://k2-fsa.github.io/sherpa/onnx/funasr-nano/pretrained.html)、[FireRedASR2 原生模型](https://k2-fsa.github.io/sherpa/onnx/FireRedAsr/pretrained.html)、[说话人模型](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html)。下载归档的固定来源、长度和 SHA-256 在 `scripts/download-asr-candidates.py`，展开后的文件指纹在本地 manifest 中。实验下载尚未形成正式安装包所需的完整候选模型第三方许可清单。

## 第三轮：人工参考评分

用户已提供 `human-asr-review.json`，语料指纹与 18 段解码音频全部匹配。17 段在文件中标记已核对；最后一段原先勾选无声但未勾核对，用户随后明确确认“已确认没有人声”。原文件字节不变，另存附确认来源的派生参考，只更新该段的核对状态，未修改任何参考文字。冻结文件、评分、原报告指纹留在私有目录 `human-scores-4c04a02f90f8/`。

最终覆盖 **18/18 段**，含一个无声片段；开发集 666 个参考字符、保留集 807 个，共 1473 个。以下均为字符错误率 CER，越低越好；若以 `1 − CER` 表示样本字符准确度，95% 对应 CER ≤ 5%。仍沿用原定规范：去除标点、空白、大小写差异，保留数字和英文拼写，不做语义改写或删除口头语来降低分数。

| 候选                                     |          开发集 CER |          保留集 CER |             合并 CER |
| ---------------------------------------- | ------------------: | ------------------: | -------------------: |
| SenseVoiceSmall INT8                     |   15.02%（100/666） |   12.89%（104/807） |   13.85%（204/1473） |
| Qwen3-ASR 0.6B INT8，无关键词            |     3.90%（26/666） |          未单独运行 |               不合并 |
| **Qwen3-ASR 0.6B INT8 + 原有会议关键词** | **2.85%（19/666）** | **5.95%（48/807）** | **4.55%（67/1473）** |
| FunASR Nano INT8 + 原有会议关键词        |    10.81%（72/666） |    10.78%（87/807） |   10.79%（159/1473） |
| FireRedASR2 AED INT8                     |    10.81%（72/666） |   14.13%（114/807） |   12.63%（186/1473） |

Qwen3 0.6B 的合并样本字符准确度为 **95.45%**，开发集为 97.15%，保留集为 **94.05%**。因此可以说“本批合并样本达到 95%”，但**保留集尚未达标，不能宣称已有稳定 95% 的识别效果**。保留集当前 48 处编辑，需不超过 40 处才能达标，差至少 8 处。人工核对时打开过机器稿，不是盲标；也没有说话人、定位或纪要准确率金标准。

误差定位显示，Qwen3 0.6B 保留集的 43/48 处字符编辑集中在四个含英文短语的片段，其余 5 处位于人名及技术词片段。开发集主要仍是材料同音词、缩写与少量口头语。只在原录音上听音确认后形成参考，没有把这些答案追加到候选词表再当成独立验收。

完整表格、最小编辑距离对应的替换/漏字/多字明细，以及逐段回听入口为 `.local/lightweight-asr/human-accuracy-final/index.html`，机器可读结果为同目录 `scores.json`。最终参考为 `human-asr-review.confirmed-v2.json`，修复了附加确认文字经过 PowerShell 管道时的编码，人工逐字稿与核对状态保持不变。脚本 `scripts/report-asr-accuracy.py` 可从冻结参考和一组原始模型报告重建；合并结果仍明确区分开发集/保留集，以及初始对比/查看参考后的探索性复测。

### 1.7B 量化原生路线复测

针对中英混说，另外实测 [CrispASR v0.8.34 CPU Windows 运行库](https://github.com/CrispStrobe/CrispASR/releases/tag/v0.8.34) 与 [Qwen3-ASR 1.7B Q4_K / Q8 音频编码器转换权重](https://huggingface.co/cstr/qwen3-asr-1.7b-GGUF/tree/674df5d44b50a63e7102a18895ed20e3f91de301)。模型为 1,490,915,200 字节，下载器固定版本与 SHA-256。该试验在读取人工结果后进行，是探索性比较，不能重新称为未查看过的独立保留集。

首次原生命令自动加入 Whisper 语言检测；正式批次已显式关闭辅助语言检测和 GPU，并限制子进程 PATH 为运行库与 Windows 目录，避免混用额外模型。固定自动语言的 18 段批次中，出现语言标记进入正文及一段识别退化，CER 为开发集 11.26%、原保留集 22.30%。再用固定中文语言设置，语言标记问题消失，但 CER 仍为开发集 **9.01%**、原保留集 **12.14%**，未超过既有 0.6B 方案。

两次批次总耗时分别为 164.42、171.91 秒，进程内存峰值约 2.14 GB。这里每段都新启原生进程，时间包含重复加载模型，不能直接与前表的模型常驻纯推理耗时比较。观察结论只针对这一权重转换与运行库组合，不推断所有 1.7B 实现都更差。保留全部原始 JSON/日志，不删除较差结果；目前继续保留 0.6B 为内置主候选。

```powershell
.local/lightweight-asr/venv/Scripts/python.exe scripts/download-asr-candidates.py crisp_cpu qwen3_17b_crisp
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-crisp-asr.py <corpus.json> --language zh --output .local/lightweight-asr/new-native-qwen
.local/lightweight-asr/venv/Scripts/python.exe scripts/report-asr-accuracy.py <corpus.json> <confirmed-reference.json> --report <candidate-report.json> --output .local/lightweight-asr/new-accuracy-report
```

新增逐字差异对齐检查后，Python 全套测试 **59 项通过**；本地报告已检查音频播放、模型表格、窄屏布局和无外部请求。当前工作仍是模型选择与质量实验，尚未交付内置模型的 Electron 安装包。

## 第四轮：公开英语音频

按用户要求增加英语测试，保持 Qwen3-ASR 0.6B INT8 与 SenseVoiceSmall INT8 的 CPU、4 线程、自动语言设置，本轮均不使用提示词。测试语料、公开参考稿与推理结果留在 `.local/lightweight-asr/`，不涉及额外上传本机会议录音。

### 固定抽样与评分方法

在推理前写入 `english-public-v1/evaluation-plan.json`：

- [LibriSpeech](https://openslr.org/12/) 的 test-clean 与 test-other：各说话人选择时长 3–25 秒、按固定种子与样本 ID 的 SHA-256 排序的前两段。分别为 40 位说话人的 80 段、33 位说话人的 66 段，共 20.02 分钟。下载归档核对官方 MD5，另存 SHA-256；这只是抽样分数，不是完整官方测试集结果。
- [Earnings22-Cleaned-AA](https://huggingface.co/datasets/ArtificialAnalysis/Earnings22-Cleaned-AA)：使用发布者人工校订的参考稿，固定修订 `5999936ee3d8d3cde160e3c65a8cc6ff5b7c5276`。按 ID 字典序取前两份文件 `4468919_trimmed`、`4471586`，合计 37.41 分钟。第一份本身是上游裁剪版；这里的完整覆盖指公开文件的全部内容，不表示原始会议全程。
- 财报音频按 18–28 秒内最低 200 毫秒 RMS 的中点分段，不重叠、不丢弃音频。共 97 段，已验证拼接后的 PCM 与两份完整解码文件逐字节相同。按顺序拼接全部识别文本后，对整份参考稿计算错误；切段引起的错误也计入。
- 总计 243 个推理片段、57.43 分钟。参考文字放在独立 `references.json` 中，推理语料只有音频、ID 与空关键词；不从答案制作提示词，不按识别结果排除样本。

英语主指标为按参考词数合并的词错误率 WER，使用原版 [Whisper EnglishTextNormalizer](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227/whisper/normalizers)，固定修订 `86098128c0b4f24f0e2aa2994de830614b474227`。它统一数字、缩写及部分拼写，并去除部分口头语；另保留只处理大小写、Unicode 与标点的基础 WER，以显示规范化的影响。不使用自定义专名替换或参考驱动的修正；不是 AA 官方榜单的自定义规范化及按时长加权结果，也不能与中文字符错误率直接等同。

复现脚本如下；英语评分依赖独立于打包运行库，官方规范化代码及其 MIT 许可随数据准备下载到本地目录。

```powershell
.local/lightweight-asr/venv/Scripts/python.exe -m pip install -r scripts/requirements-asr-eval.txt
.local/lightweight-asr/venv/Scripts/python.exe scripts/build-english-asr-corpus.py --output .local/lightweight-asr/new-english-corpus
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-asr-candidates.py .local/lightweight-asr/new-english-corpus/corpus.json --engine qwen3 --split all --output .local/lightweight-asr/new-english-qwen3
.local/lightweight-asr/venv/Scripts/python.exe scripts/benchmark-asr-candidates.py .local/lightweight-asr/new-english-corpus/corpus.json --engine sensevoice --split all --output .local/lightweight-asr/new-english-sensevoice
.local/lightweight-asr/venv/Scripts/python.exe scripts/score-english-asr.py .local/lightweight-asr/new-english-corpus/corpus.json --report .local/lightweight-asr/new-english-qwen3/report.json --report .local/lightweight-asr/new-english-sensevoice/report.json --output .local/lightweight-asr/new-english-score
.local/lightweight-asr/venv/Scripts/python.exe -m unittest discover -s scripts -p test_english_asr.py
```

评分要求所有冻结音频、参考单元和结果恰好完整覆盖，核对语料及音频哈希，拒绝缺片段、重复结果、时间缺口和未完成批次。新增 9 项评分完整性检查通过。公开语料可能出现在模型训练中，两份财报音频也不能代表所有口音、会议环境或多人重叠讲话；本轮不评估说话人身份。

### 英语实测结果

| 场景                |      音频 / 参考词数 | Qwen3 0.6B 规范化 WER | SenseVoice 规范化 WER |
| ------------------- | -------------------: | --------------------: | --------------------: |
| 清晰朗读 test-clean | 12.08 分钟 / 1935 词 |        4.65%（90 处） |        4.08%（79 处） |
| 较难朗读 test-other |  7.94 分钟 / 1315 词 |        4.79%（63 处） |        7.15%（94 处） |
| 财报会议长音频      | 37.41 分钟 / 4776 词 |      10.76%（514 处） |      11.64%（556 处） |
| 全部样本            | 57.43 分钟 / 8026 词 |       8.31%（667 处） |       9.08%（729 处） |

仅按基础规则评分时，Qwen3 的四组 WER 分别为 4.74%、4.92%、20.16%、14.27%；SenseVoice 为 4.64%、7.76%、17.76%、13.20%。财报中数字写法、缩写和口头语较多，规范化会明显改变分数，也会改变两模型在财报组的排序；不能把规范化后的分数说成严格逐字原样抄录准确度。Qwen3 两份财报文件的规范化 WER 分别为 10.44%、11.02%。

同机顺序运行，Qwen3 的总纯推理耗时为 **809.06 秒（13.48 分钟）**，加载 3.56 秒，进程内存峰值 **3.37 GB**；SenseVoice 为 **98.13 秒（1.64 分钟）**，加载 1.75 秒，峰值 **0.49 GB**。RTF 分别为 0.235、0.0285，SenseVoice 的纯推理约快 8.24 倍。仍为 i7-14700HX / 64 GiB 开发机、CPU 4 线程；时间不含下载、解码、切段、说话人处理及评分，不是 16 GB 目标机验收。

发现一个需要保留的失败案例：5.865 秒清晰朗读样本 `test-clean-1221-135767-0005` 的 14 个参考词被 Qwen3 识别成单词 `Nothing`，计入 14 处词编辑。原文件不是数字静音，RMS 约 -28.84 dBFS；SenseVoice 正确识别了该段。随后在新进程中于正常对照片段前后各复测一次，Qwen3 均重复相同错误。诊断记录在 `english-qwen3-short-output-diagnostic/`，不覆盖主测试，也不混入总分。尚未确定是这一量化模型还是运行库的问题，集成前不能仅凭“进程成功退出”认定转写有效。

本轮支持继续将 Qwen3 作为中文质量优先的主候选，但它在英语上的优势较小，英语会议也未达到 95% 词级准确度；SenseVoice 值得作为速度优先方案继续保留。清晰朗读、带口音的财报、中文夹英文应分别评估，不用朗读分数替代会议效果。

结果、最小词编辑对齐、回听与完整 JSON 在 `english-accuracy-v1/index.html` 和 `scores.json`；原始结果在 `english-qwen3-v1/`、`english-sensevoice-v1/`。Chromium 检查通过：8 行汇总、音频加载、375 像素窄屏无页面溢出、无脚本错误、无外部请求。
