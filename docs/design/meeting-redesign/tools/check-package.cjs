const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const required = ['README.md','AGENT-TASK.md','docs/design-baseline.md','docs/integration-map.md','docs/implementation-plan.md','docs/acceptance.md','reference/design-system.css','reference/prototype-interactions.js','reference/library-approved.png','source-baseline.json'];
const names = new Set();
for (const entry of manifest.files) {
  assert.ok(!names.has(entry.path), `重复文件：${entry.path}`); names.add(entry.path);
  const file = path.resolve(root, entry.path);
  assert.ok(file.startsWith(root + path.sep), '文件路径越界');
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, entry.bytes, `文件大小不匹配：${entry.path}`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, `文件哈希不匹配：${entry.path}`);
}
for (const file of required) assert.ok(names.has(file), `缺少文件：${file}`);
const css = fs.readFileSync(path.join(root, 'reference/design-system.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'reference/prototype-interactions.js'), 'utf8');
for (const page of ['index.html','meeting-workspace.html','project-tracking.html','meeting-ask.html','app-settings.html']) {
  const html = fs.readFileSync(path.join(root, 'design', page), 'utf8');
  assert.equal((html.match(/<html[ >]/g) || []).length, 1);
  assert.equal((html.match(/<style[ >]/g) || []).length, 1);
  assert.equal((html.match(/<script[ >]/g) || []).length, 1);
  assert.ok(!html.includes('[REPLACE]'));
  assert.ok(!/<(?:script|img)[^>]+src=["']https?:/i.test(html));
  assert.equal(html.match(/<style>([\s\S]*?)<\/style>/)[1].trim(), css.trim(), `样式参考不一致：${page}`);
  assert.equal(html.match(/<script>([\s\S]*?)<\/script>/)[1].trim(), js.trim(), `交互参考不一致：${page}`);
  for (const name of new Set(html.match(/(?:index|meeting-workspace|project-tracking|meeting-ask|app-settings)\.html/g) || [])) assert.ok(names.has('design/' + name));
}
console.log(`PASS: ${manifest.files.length} 个文件哈希一致；5 个页面及其样式、脚本和内部页面引用完整。`);
