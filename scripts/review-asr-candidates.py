"""Build an offline listening/review page for a frozen private ASR corpus."""

import argparse
import html
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from service.lightweight_models import digest  # noqa: E402

PAGE = r"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self' file:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'">
<title>本地会议识别核对</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#20262e;font:16px/1.7 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1080px;margin:auto;padding:30px 20px 70px}h1{font-size:28px;margin-bottom:8px}h2{font-size:19px}p{margin:8px 0}header,.sample{background:white;padding:24px;border:1px solid #dce0e6;border-radius:12px;margin:16px 0}.muted{color:#586273;font-size:14px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px}button,select,input{font:inherit;padding:7px 12px;border:1px solid #abb5c2;border-radius:6px}button{cursor:pointer;background:#244962;color:white}input[type=checkbox]{accent-color:#244962}textarea{display:block;width:100%;min-height:112px;padding:12px;font:inherit;border:1px solid #b4bdc9;border-radius:6px;resize:vertical;margin:8px 0}audio{width:100%;margin:12px 0}.checks{display:flex;gap:18px;flex-wrap:wrap}.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px;margin-top:12px}.output{padding:14px;border:1px solid #dce0e6;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere}.output b{display:block;color:#244962}summary{cursor:pointer;margin-top:14px}.tag{font-size:12px;background:#e9eef3;padding:3px 7px;border-radius:5px}.status{color:#244962;font-weight:600}#message{min-height:1.6em;color:#8b3e13}.notes{min-height:60px}input[type=text]{max-width:100%}
</style><main><header><h1>用录音核对识别效果</h1>
<p>6 场会议的固定抽样，共 18 段、约 6 分钟。先听音频、填逐字稿，再按需展开机器对照。</p>
<p class="muted">这里没有预填“正确答案”。机器对照可能有错，也不能替代听音。保留口头重复与数字原意；听不清的片段请标记，不要猜。开发集用于调试，保留集用于独立检查。抽样通过不等于所有会议达到 95%。</p>
<div class="toolbar"><label>核对人 <input id="reviewer" type="text" autocomplete="off"></label><label>显示 <select id="split"><option value="all">全部</option><option value="development">开发集</option><option value="holdout">保留集</option></select></label><button id="export">导出核对记录</button><label>导入记录 <input id="import" type="file" accept="application/json,.json"></label></div>
<p id="progress" class="status"></p><p id="message" role="status"></p><p class="muted">音频和填写内容都留在本机。草稿尽可能保存在当前浏览器，建议及时导出 JSON 备份。</p></header><div id="samples"></div></main>
<script id="data" type="application/json">__DATA__</script><script>
const data=JSON.parse(document.querySelector('#data').textContent),key='meeting-asr-review:'+data.corpus_sha256;
let state={reference_kind:'human',format:'meeting-asr-review-v1',corpus_sha256:data.corpus_sha256,reviewer:'',samples:data.samples.map(s=>({sample_id:s.id,decoded_sha256:s.decoded_sha256,reference_text:'',reviewed:false,no_speech:false,unintelligible:false,notes:'',outputs_revealed:false}))};
const $=s=>document.querySelector(s),message=t=>$('#message').textContent=t;
function validImport(x){return x?.reference_kind==='human'&&x.corpus_sha256===data.corpus_sha256&&typeof x.reviewer==='string'&&Array.isArray(x.samples)&&x.samples.length===data.samples.length&&new Set(x.samples.map(s=>s.sample_id)).size===data.samples.length&&x.samples.every(s=>data.samples.some(t=>t.id===s.sample_id&&t.decoded_sha256===s.decoded_sha256)&&typeof s.reference_text==='string'&&typeof s.notes==='string'&&['reviewed','no_speech','unintelligible','outputs_revealed'].every(k=>typeof s[k]==='boolean'))}
try{const x=JSON.parse(localStorage.getItem(key));if(validImport(x))state=x;}catch{}
function save(){try{localStorage.setItem(key,JSON.stringify(state));}catch{message('浏览器未保存草稿，请用导出按钮备份。');}progress();}
function progress(){const n=state.samples.filter(s=>s.reviewed&&!s.unintelligible).length;$('#progress').textContent=`已核对可评分片段 ${n} / ${data.samples.length}；准确率待评分。`;}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function render(){
 $('#samples').replaceChildren();$('#reviewer').value=state.reviewer;
 for(const sample of data.samples){if($('#split').value!=='all'&&sample.split!==$('#split').value)continue;
  const r=state.samples.find(s=>s.sample_id===sample.id),card=node('section',undefined,'sample');card.dataset.sampleId=sample.id;
  card.append(node('h2',sample.title+' · '+sample.position));card.append(node('span',sample.split==='holdout'?'保留集':'开发集','tag'));card.append(node('p',`原录音 ${sample.source_offset_seconds.toFixed(1)} 秒起 · 本片段 ${sample.duration_seconds.toFixed(1)} 秒`,'muted'));
  const audio=node('audio');audio.controls=true;audio.preload='none';audio.src=sample.audio;card.append(audio);
  const label=node('label','听音后填写逐字稿'),text=node('textarea');text.value=r.reference_text;text.placeholder='只填写实际听到的内容';text.setAttribute('aria-label',sample.title+'逐字稿');label.append(text);card.append(label);
  const checks=node('div',undefined,'checks');const refs={};
  for(const [field,title]of [['no_speech','整段没有人声'],['unintelligible','有听不清的内容，暂不评分'],['reviewed','已听音核对此片段']]){const l=node('label'),c=node('input');c.type='checkbox';c.checked=r[field];refs[field]=c;l.append(c,document.createTextNode(' '+title));checks.append(l);c.onchange=()=>{r[field]=c.checked;if(field!=='reviewed'){r.reviewed=false;refs.reviewed.checked=false;}if(field==='reviewed'&&c.checked&&!r.unintelligible&&((!r.reference_text.trim()&&!r.no_speech)||(r.reference_text.trim()&&r.no_speech))){r.reviewed=c.checked=false;message('请填写逐字稿，或明确勾选整段没有人声；两者不能同时选择。');}save();};}
  text.oninput=()=>{r.reference_text=text.value;r.reviewed=false;refs.reviewed.checked=false;save();};card.append(checks);
  const notes=node('textarea',undefined,'notes');notes.value=r.notes;notes.placeholder='可选：术语、数字或听不清的位置';notes.setAttribute('aria-label','核对备注');notes.oninput=()=>{r.notes=notes.value;save();};card.append(notes);
  const details=node('details'),summary=node('summary','展开机器对照（不是标准答案）'),columns=node('div',undefined,'comparison');details.append(summary,columns);
  for(const result of sample.outputs){const out=node('div',undefined,'output');out.append(node('b',result.label),document.createTextNode(result.text));columns.append(out);}details.ontoggle=()=>{if(details.open){r.outputs_revealed=true;save();}};card.append(details);$('#samples').append(card);
 }progress();
}
$('#split').onchange=render;$('#reviewer').oninput=()=>{state.reviewer=$('#reviewer').value;save();};
$('#export').onclick=()=>{if(!state.reviewer.trim()){message('请填写核对人，便于区分人工核对与机器输出。');return;}const blob=new Blob([JSON.stringify({...state,exported_at:new Date().toISOString()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download='human-asr-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('已导出；未核对的片段不会计入有效评分。');};
$('#import').onchange=async e=>{try{const x=JSON.parse(await e.target.files[0].text());if(!validImport(x))throw Error('音频指纹或记录格式不匹配');state=x;save();render();message('已导入核对记录。');}catch(err){message('无法导入：'+err.message);}e.target.value='';};render();
</script></html>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus", type=Path)
    parser.add_argument("--report", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    corpus = json.loads(args.corpus.read_text("utf-8"))
    corpus_hash = digest(args.corpus)
    meetings = {m["id"]: m for m in corpus["meetings"]}
    candidates = []
    for path in args.report:
        report = json.loads(path.read_text("utf-8"))
        if (
            report["configuration"]["corpus_sha256"] != corpus_hash
            or report["status"] != "complete"
        ):
            raise ValueError("Incomplete or mismatched candidate run")
        candidates.append(report)
    samples = []
    for sample in corpus["samples"]:
        audio = (args.corpus.parent / sample["audio"]).resolve()
        if (
            not audio.is_relative_to(args.corpus.parent.resolve())
            or digest(audio) != sample["decoded_sha256"]
        ):
            raise ValueError("Corpus audio path/hash mismatch")
        outputs = []
        for report in candidates:
            for result in report["results"]:
                if result["sample_id"] == sample["id"]:
                    if result["decoded_sha256"] != sample["decoded_sha256"]:
                        raise ValueError("Candidate audio hash mismatch")
                    label = report["configuration"]["engine"] + (
                        " · 会议关键词" if report["configuration"]["hotwords"] else ""
                    )
                    outputs.append({"label": label, "text": result["text"]})
        outputs.append(
            {
                "label": "历史机器转录 · 含选区边缘外文字",
                "text": "".join(s["text"] for s in sample["baseline"]),
            }
        )
        relative = os.path.relpath(audio, args.output.parent.resolve()).replace(
            os.sep, "/"
        )
        samples.append(
            {
                **{
                    k: sample[k]
                    for k in (
                        "id",
                        "split",
                        "decoded_sha256",
                        "duration_seconds",
                        "source_offset_seconds",
                    )
                },
                "title": meetings[sample["meeting_id"]]["title"],
                "position": f"片段 {int(sample['id'].rsplit('-', 1)[1]) + 1}",
                "audio": quote(relative, safe="/"),
                "outputs": outputs,
            }
        )
    payload = (
        json.dumps(
            {"corpus_sha256": corpus_hash, "samples": samples}, ensure_ascii=False
        )
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    page = PAGE.replace("__DATA__", payload)
    # Keep counts truthful for corpora built from different installed libraries.
    page = page.replace(
        "6 场会议的固定抽样，共 18 段、约 6 分钟",
        html.escape(
            f"{len(meetings)} 场会议的固定抽样，共 {len(samples)} 段、约 {sum(s['duration_seconds'] for s in samples) / 60:g} 分钟"
        ),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as target:
        target.write(page)
    print(args.output)


if __name__ == "__main__":
    main()
