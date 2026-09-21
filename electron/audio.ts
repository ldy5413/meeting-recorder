import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  statSync,
  truncateSync,
  existsSync,
  readSync,
  unlinkSync,
} from "node:fs";
// Preserve a solo source's level; saturate overlapping peaks to the PCM range.
function mixSample(mic: number, system: number) {
  return Math.max(-32768, Math.min(32767, mic + system));
}
function writeAll(fd: number, buffer: Buffer, position: number) {
  let written = 0;
  while (written < buffer.length) {
    const n = writeSync(
      fd,
      buffer,
      written,
      buffer.length - written,
      position + written,
    );
    if (!n) throw new Error("磁盘未能写入录音");
    written += n;
  }
}
export function wavHeader(bytes: number, rate: number) {
  const b = Buffer.alloc(44);
  b.write("RIFF");
  b.writeUInt32LE(bytes + 36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(bytes, 40);
  return b;
}
export function repairWav(path: string, rate: number) {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  const bytes = Math.max(0, Math.floor((size - 44) / 2) * 2);
  truncateSync(path, bytes + 44);
  const fd = openSync(path, "r+");
  try {
    writeAll(fd, wavHeader(bytes, rate), 0);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function recoverRecording(
  mic: string,
  system: string,
  mixed: string,
  rate: number,
) {
  for (const path of [mic, system, mixed]) repairWav(path, rate);
  if (!existsSync(mic) || !existsSync(system)) return;
  const bytes = Math.max(statSync(mic).size, statSync(system).size) - 44;
  const inputs = [openSync(mic, "r"), openSync(system, "r")],
    output = openSync(mixed, "w");
  try {
    writeAll(output, wavHeader(bytes, rate), 0);
    for (let offset = 0; offset < bytes; offset += 96000) {
      const count = Math.min(96000, bytes - offset),
        a = Buffer.alloc(count),
        b = Buffer.alloc(count),
        out = Buffer.alloc(count);
      readSync(inputs[0], a, 0, count, 44 + offset);
      readSync(inputs[1], b, 0, count, 44 + offset);
      for (let i = 0; i < count; i += 2)
        out.writeInt16LE(mixSample(a.readInt16LE(i), b.readInt16LE(i)), i);
      writeAll(output, out, 44 + offset);
    }
    fsyncSync(output);
  } finally {
    inputs.forEach(closeSync);
    closeSync(output);
  }
}
export class Recording {
  private fds: number[] = [];
  private bytes = 0;
  private seq = 0;
  constructor(
    public paths: string[],
    public rate: number,
  ) {
    try {
      for (const p of paths) {
        const fd = openSync(p, "wx");
        this.fds.push(fd);
        writeAll(fd, wavHeader(0, rate), 0);
        fsyncSync(fd);
      }
    } catch (e) {
      const created = this.paths.slice(0, this.fds.length);
      this.close();
      for (const path of created) unlinkSync(path);
      throw e;
    }
  }
  append(seq: number, mic: Uint8Array, system: Uint8Array) {
    if (seq !== this.seq)
      throw new Error("录音数据顺序不一致，已停止以保护已保存音频");
    if (
      mic.length !== system.length ||
      mic.length % 2 ||
      mic.length > this.rate * 4
    )
      throw new Error("无效音频数据块");
    if (this.bytes + mic.length > 0xffffff00)
      throw new Error("录音达到 WAV 文件容量上限");
    const m = Buffer.from(mic),
      s = Buffer.from(system),
      mix = Buffer.alloc(m.length);
    for (let i = 0; i < m.length; i += 2)
      mix.writeInt16LE(mixSample(m.readInt16LE(i), s.readInt16LE(i)), i);
    for (const [i, b] of [m, s, mix].entries()) {
      writeAll(this.fds[i], b, 44 + this.bytes);
      writeAll(this.fds[i], wavHeader(this.bytes + b.length, this.rate), 0);
      fsyncSync(this.fds[i]);
    }
    this.bytes += m.length;
    this.seq++;
  }
  close() {
    for (const fd of this.fds) closeSync(fd);
    this.fds = [];
  }
}
