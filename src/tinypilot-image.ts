// Rev735 (Carlos 2026-11-22): build, on the Signal K Raspberry Pi, a new
// TinyPilot image with the boat's settings already inside, for a SECOND
// card. The TinyPilot and its card are not touched at any point.
//
// Steps (each one a child process at the lowest CPU and disk priority, so
// Signal K keeps answering):
//   1. analyse: decompress the image (.img.xz / .img.gz / .img), find its
//      Linux partition in the MBR, read ~/.pypilot, tce/onboot.lst,
//      tce/optional and tce/mydata.tgz with debugfs (no mount, no root);
//   2. build: merge the boat's backup (tinypilot-migrate.ts), write the
//      files back with debugfs keeping each file's owner and mode, replace
//      the password hash and SSH host keys inside mydata.tgz, check the
//      file system with e2fsck, compress and checksum the result.
// Tools: e2fsprogs (debugfs, e2fsck), xz, gzip, python3 - all present on
// Raspberry Pi OS / OpenPlotter.
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  Groups, mergePypilotConf, mergeNetworking, mergeNetworkingClient, mergeHatConf, mergeSmallFile,
  leftoverFiles, mergeOnboot, mergeShadow, ConfChange,
} from "./tinypilot-migrate";

export interface MbrPart { index: number; type: number; start: number; sectors: number }

/** The four primary entries of an MBR (first 512 bytes). */
export function readMbr(sector0: Buffer): MbrPart[] | null {
  if (sector0.length < 512 || sector0[510] !== 0x55 || sector0[511] !== 0xaa) return null;
  const out: MbrPart[] = [];
  for (let i = 0; i < 4; i++) {
    const o = 446 + i * 16;
    const type = sector0[o + 4];
    const start = sector0.readUInt32LE(o + 8), sectors = sector0.readUInt32LE(o + 12);
    if (type && sectors) out.push({ index: i + 1, type, start, sectors });
  }
  return out;
}

/** The TinyPilot's data partition: the first Linux (0x83) one. */
export function linuxPartition(parts: MbrPart[]): MbrPart | null {
  return parts.find((p) => p.type === 0x83) ?? null;
}

export interface DirEntry { name: string; mode: number; uid: number; gid: number; size: number }

/** Parses `debugfs -R "ls -p DIR"`: /inode/mode/uid/gid/name/size/ */
export function parseLsP(out: string): DirEntry[] {
  const res: DirEntry[] = [];
  for (const line of String(out).split("\n")) {
    const m = /^\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(.*)\/(\d*)\/\s*$/.exec(line.trim());
    if (!m || m[5] === "." || m[5] === "..") continue;
    res.push({ name: m[5], mode: parseInt(m[2], 8), uid: Number(m[3]), gid: Number(m[4]), size: Number(m[6] || 0) });
  }
  return res;
}

/** A path debugfs accepts inside its command language (no spaces/quotes:
 *  every name we write is one of ours). */
export function safeImagePath(p: string): boolean {
  return /^\/[A-Za-z0-9._\/~-]+$/.test(p) && !p.includes("..");
}

export interface WriteOp { path: string; local: string; mode: number; uid: number; gid: number }

/** debugfs command file: remove what is there, write the new file, put
 *  back owner and mode; and plain removals. */
export function debugfsScript(writes: WriteOp[], removes: string[]): string {
  const lines: string[] = [];
  for (const r of removes) { if (!safeImagePath(r)) throw new Error(`bad path ${r}`); lines.push(`rm ${r}`); }
  for (const w of writes) {
    if (!safeImagePath(w.path)) throw new Error(`bad path ${w.path}`);
    if (/[\s"]/.test(w.local)) throw new Error(`bad local path ${w.local}`);
    lines.push(`rm ${w.path}`, `write ${w.local} ${w.path}`,
      `sif ${w.path} mode 0${(0o100000 | (w.mode & 0o7777)).toString(8)}`, `sif ${w.path} uid ${w.uid}`, `sif ${w.path} gid ${w.gid}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- child processes ----------

export interface RunResult { code: number; stdout: Buffer; stderr: string }

/** Runs a tool at the lowest priority. `ionice` only when present. */
export function run(cmd: string, args: string[], opts: { input?: string; stdoutFile?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const nice = ["-n", "19"];
    const hasIonice = fs.existsSync("/usr/bin/ionice");
    const argv = hasIonice ? [...nice, "ionice", "-c3", cmd, ...args] : [...nice, cmd, ...args];
    const p = spawn("nice", argv, { stdio: ["pipe", opts.stdoutFile ? "pipe" : "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    let file: fs.WriteStream | null = null;
    if (opts.stdoutFile) { file = fs.createWriteStream(opts.stdoutFile); p.stdout.pipe(file); }
    else p.stdout.on("data", (d: Buffer) => out.push(d));
    p.stderr.on("data", (d: Buffer) => { if (err.length < 8000) err += d.toString(); });
    const t = opts.timeoutMs ? setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } }, opts.timeoutMs) : null;
    p.on("error", (e) => { if (t) clearTimeout(t); resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e?.message || e) }); });
    p.on("close", (code) => {
      if (t) clearTimeout(t);
      const done = () => resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
      if (file) file.end(done); else done();
    });
    if (opts.input != null) p.stdin.end(opts.input); else p.stdin.end();
  });
}

const DEBUGFS = ["/sbin/debugfs", "/usr/sbin/debugfs"];
const E2FSCK = ["/sbin/e2fsck", "/usr/sbin/e2fsck"];
export function findTool(cands: string[]): string | null { return cands.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; } }) ?? null; }

export function toolsMissing(): string[] {
  const miss: string[] = [];
  if (!findTool(DEBUGFS)) miss.push("debugfs (e2fsprogs)");
  if (!findTool(E2FSCK)) miss.push("e2fsck (e2fsprogs)");
  for (const t of ["xz", "gzip", "python3"]) if (!findTool([`/usr/bin/${t}`, `/bin/${t}`])) miss.push(t);
  return miss;
}

export class ImageFs {
  constructor(public img: string, public offsetBytes: number) {}
  private dev(): string { return `${this.img}?offset=${this.offsetBytes}`; }
  async cmd(c: string): Promise<RunResult> { return run(findTool(DEBUGFS)!, ["-R", c, this.dev()], { timeoutMs: 120_000 }); }
  async ls(dir: string): Promise<DirEntry[] | null> {
    const r = await this.cmd(`ls -p ${dir}`);
    if (r.code !== 0 || /File not found/i.test(r.stderr)) return null;
    return parseLsP(r.stdout.toString());
  }
  async cat(file: string): Promise<string | null> {
    const r = await this.cmd(`cat ${file}`);
    if (r.code !== 0 || /File not found|not found by ext2_lookup/i.test(r.stderr)) return null;
    return r.stdout.toString("utf8");
  }
  async dump(file: string, local: string): Promise<boolean> {
    const r = await this.cmd(`dump ${file} ${local}`);
    return r.code === 0 && fs.existsSync(local) && !/not found/i.test(r.stderr);
  }
  async apply(script: string, scriptFile: string): Promise<RunResult> {
    fs.writeFileSync(scriptFile, script);
    return run(findTool(DEBUGFS)!, ["-w", "-f", scriptFile, this.dev()], { timeoutMs: 300_000 });
  }
  async fsck(): Promise<RunResult> { return run(findTool(E2FSCK)!, ["-fn", this.dev()], { timeoutMs: 600_000 }); }
}

/** Decompresses (or copies) the source image to `out`. */
export async function unpackImage(src: string, out: string): Promise<RunResult> {
  if (/\.xz$/i.test(src)) return run("xz", ["-dc", src], { stdoutFile: out, timeoutMs: 3_600_000 });
  if (/\.gz$/i.test(src)) return run("gzip", ["-dc", src], { stdoutFile: out, timeoutMs: 3_600_000 });
  if (/\.img$/i.test(src)) return run("cp", [src, out], { timeoutMs: 3_600_000 });
  return { code: -1, stdout: Buffer.alloc(0), stderr: "unsupported file (use .img.xz, .img.gz or .img)" };
}

export async function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

/** Python helper: rewrites members of mydata.tgz keeping every other
 *  member byte for byte with its owner and mode. argv: in out json.
 *  json = { "etc/shadow": "<full text>", "usr/local/etc/ssh/x": "<text>" }.
 *  Members not in the archive are added with the mode of a sibling or 0600. */
export const MYDATA_PY = String.raw`
import sys, tarfile, json, io, copy
src, dst, spec = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
tin = tarfile.open(src, "r:gz")
tout = tarfile.open(dst, "w:gz", format=tin.format)
seen = set()
names = {m.name.lstrip("./"): m for m in tin.getmembers()}
for m in tin.getmembers():
    key = m.name.lstrip("./")
    if key in spec and m.isfile():
        data = spec[key].encode()
        n = copy.copy(m); n.size = len(data)
        tout.addfile(n, io.BytesIO(data)); seen.add(key)
    else:
        tout.addfile(m, tin.extractfile(m) if m.isfile() else None)
for key, text in spec.items():
    if key in seen: continue
    data = text.encode()
    sib = next((v for k, v in names.items() if k.rsplit("/", 1)[0] == key.rsplit("/", 1)[0] and v.isfile()), None)
    pre = "./" if any(v.name.startswith("./") for v in names.values()) else ""
    n = tarfile.TarInfo(pre + key)
    n.size = len(data); n.mode = 0o600 if key.endswith("_key") or key == "etc/shadow" else 0o644
    if sib: n.uid, n.gid, n.uname, n.gname, n.mtime = sib.uid, sib.gid, sib.uname, sib.gname, sib.mtime
    tout.addfile(n, io.BytesIO(data))
tout.close(); tin.close()
print("ok")
`;

export const MYDATA_LIST_PY = String.raw`
import sys, tarfile
t = tarfile.open(sys.argv[1], "r:gz")
for m in t.getmembers():
    print(("F " if m.isfile() else "D ") + m.name.lstrip("./"))
`;

export const MYDATA_CAT_PY = String.raw`
import sys, tarfile
t = tarfile.open(sys.argv[1], "r:gz")
for m in t.getmembers():
    if m.name.lstrip("./") == sys.argv[2] and m.isfile():
        sys.stdout.write(t.extractfile(m).read().decode("utf-8", "replace")); break
`;

export function ensureDir(d: string): void { fs.mkdirSync(d, { recursive: true }); }
export function freeBytes(d: string): number | null { try { const s = fs.statfsSync(d); return s.bavail * s.bsize; } catch { return null; } }
export function workPaths(base: string) {
  return {
    dir: base,
    raw: path.join(base, "new.img"),
    tmp: path.join(base, "tmp"),
  };
}

// ---------- the two jobs ----------

/** What the new image carries, read once after unpacking. */
export interface ImageInfo {
  src: string;
  raw: string;
  offsetBytes: number;
  pypilotDir: DirEntry[];
  files: Record<string, string | null>;
  onboot: string | null;
  optional: string[];
  mydata: { present: boolean; members: string[]; shadowTc: string | null; hostKeys: string[] };
  pypilotVersion: string | null;
}

export const CRITICAL_FILES = ["pypilot.conf", "networking.txt", "networking.txt-client", "hat.conf", "servodevice", "pypilot_client.conf", "web.conf", "nmea0device", "lcddriver", "blacklist_serial_ports", "gpsd_baud_hint"];

export type Progress = (step: string, detail?: string) => void;

export async function analyzeImage(src: string, workDir: string, progress: Progress): Promise<ImageInfo> {
  const miss = toolsMissing();
  if (miss.length) throw new Error(`missing on this Raspberry Pi: ${miss.join(", ")}`);
  const w = workPaths(workDir);
  ensureDir(w.dir); ensureDir(w.tmp);
  progress("unpack", path.basename(src));
  try { fs.unlinkSync(w.raw); } catch { /* none */ }
  const u = await unpackImage(src, w.raw);
  if (u.code !== 0) throw new Error(`could not unpack the image: ${u.stderr.slice(0, 300)}`);
  const fd = fs.openSync(w.raw, "r"); const b = Buffer.alloc(512); fs.readSync(fd, b, 0, 512, 0); fs.closeSync(fd);
  const parts = readMbr(b);
  const p2 = parts ? linuxPartition(parts) : null;
  if (!p2) throw new Error("this file has no Linux partition: it is not a TinyPilot image");
  const ifs = new ImageFs(w.raw, p2.start * 512);
  progress("read", ".pypilot");
  const dir = await ifs.ls("/.pypilot");
  if (!dir) throw new Error("no .pypilot folder in the image: it is not a TinyPilot image");
  const files: Record<string, string | null> = {};
  for (const f of CRITICAL_FILES) files[f] = dir.some((e) => e.name === f) ? await ifs.cat(`/.pypilot/${f}`) : null;
  const onboot = await ifs.cat("/tce/onboot.lst");
  const optional = ((await ifs.ls("/tce/optional")) ?? []).map((e) => e.name);
  const mydata = { present: false, members: [] as string[], shadowTc: null as string | null, hostKeys: [] as string[] };
  const md = path.join(w.tmp, "mydata.tgz");
  if (await ifs.dump("/tce/mydata.tgz", md)) {
    const py = path.join(w.tmp, "list.py"); fs.writeFileSync(py, MYDATA_LIST_PY);
    const l = await run("python3", [py, md], { timeoutMs: 120_000 });
    if (l.code === 0) {
      mydata.present = true;
      mydata.members = l.stdout.toString().split("\n").filter((x) => x.startsWith("F ")).map((x) => x.slice(2));
      mydata.hostKeys = mydata.members.filter((m) => /ssh_host_.*_key$/.test(m));
      if (mydata.members.includes("etc/shadow")) {
        const c = path.join(w.tmp, "cat.py"); fs.writeFileSync(c, MYDATA_CAT_PY);
        const s = await run("python3", [c, md, "etc/shadow"], { timeoutMs: 60_000 });
        mydata.shadowTc = s.code === 0 ? (s.stdout.toString().split("\n").find((r) => r.startsWith("tc:")) ?? null) : null;
      }
    }
  }
  // pypilot's version, from its source in the image (best effort)
  let pypilotVersion: string | null = null;
  const v = await ifs.cat("/tinypilot/pypilot/pypilot/version.py");
  const m = v ? (/strversion\s*=\s*['"]([^'"]+)['"]/.exec(v) || /version\s*=\s*['"]([^'"]+)['"]/.exec(v)) : null;
  if (m) pypilotVersion = m[1];
  return { src, raw: w.raw, offsetBytes: p2.start * 512, pypilotDir: dir, files, onboot, optional, mydata, pypilotVersion };
}

export interface FileRow { file: string; inCopy: boolean; inImage: boolean; action: "merge" | "copy" | "skip" | "remove"; reason: string }

export interface BuildPlan {
  rows: FileRow[];
  conf: { changes: ConfChange[]; warnings: string[]; profiles: string[]; notCarried: string[]; droppedProfileKeys: string[] } | null;
  writes: { name: string; text: string }[];
  removes: string[];
  onbootAdded: string[];
  mydata: Record<string, string>;
}

const TC_LINE = "__TC_LINE__";

/** Works out every change, without writing anything. */
export function planBuild(info: ImageInfo, copy: Record<string, string>, groups: Groups): BuildPlan {
  const rows: FileRow[] = [];
  const writes: { name: string; text: string }[] = [];
  let conf: BuildPlan["conf"] = null;
  const boatConf = copy["pypilot.conf"];
  if (boatConf) {
    const m = mergePypilotConf(info.files["pypilot.conf"], boatConf, groups);
    conf = { changes: m.changes, warnings: m.warnings, profiles: m.profiles, notCarried: m.notCarried, droppedProfileKeys: m.droppedProfileKeys };
    writes.push({ name: "pypilot.conf", text: m.text }, { name: "pypilot.conf.bak", text: m.text });
    rows.push({ file: "pypilot.conf", inCopy: true, inImage: info.files["pypilot.conf"] != null, action: "merge", reason: `${m.changes.length} values changed; profiles: ${m.profiles.length}` });
  } else rows.push({ file: "pypilot.conf", inCopy: false, inImage: info.files["pypilot.conf"] != null, action: "skip", reason: "not in the copy (SSH was not configured when it was made)" });

  const add = (file: string, r: { text: string | null; action: "merge" | "copy" | "skip"; reason: string }, on: boolean) => {
    rows.push({ file, inCopy: copy[file] != null, inImage: info.files[file] != null, action: on ? r.action : "skip", reason: on ? r.reason : "not chosen" });
    if (on && r.text != null && r.action !== "skip") writes.push({ name: file, text: r.text });
  };
  add("networking.txt", mergeNetworking(info.files["networking.txt"], copy["networking.txt"] ?? null), groups.wifi);
  if (info.files["networking.txt-client"] != null) add("networking.txt-client", mergeNetworkingClient(info.files["networking.txt-client"], copy["networking.txt"] ?? null), groups.wifi);
  add("hat.conf", mergeHatConf(info.files["hat.conf"], copy["hat.conf"] ?? null), groups.remotes);
  for (const f of ["servodevice", "pypilot_client.conf", "web.conf", "lcddriver", "blacklist_serial_ports", "gpsd_baud_hint", "nmea0device"]) {
    if (copy[f] == null && info.files[f] == null) continue;
    if (f === "nmea0device" && copy[f] == null) continue;   // removed below
    add(f, mergeSmallFile(f, info.files[f], copy[f] ?? null), true);
  }
  const removes = leftoverFiles(info.pypilotDir.map((e) => e.name));
  // a GPS device of the image's previous owner that the boat has not
  if (info.files["nmea0device"] != null && copy["nmea0device"] == null) removes.push("nmea0device");
  for (const r of removes) rows.push({ file: r, inCopy: false, inImage: true, action: "remove", reason: "left by the image's previous owner" });

  let onbootAdded: string[] = [];
  if (groups.skFix && info.onboot != null) {
    const o = mergeOnboot(info.onboot, info.optional);
    onbootAdded = o.added;
    rows.push({ file: "tce/onboot.lst", inCopy: false, inImage: true, action: o.added.length ? "merge" : "skip", reason: o.added.length ? `Signal K packages added: ${o.added.length}` : "nothing to add (already there or not in the image)" });
    if (o.added.length) writes.push({ name: "/tce/onboot.lst", text: o.text });
  }

  const mydata: Record<string, string> = {};
  if (groups.login) {
    if (!info.mydata.present) rows.push({ file: "tce/mydata.tgz", inCopy: true, inImage: false, action: "skip", reason: "the image has no mydata.tgz: password and SSH keys stay as the image has them" });
    else {
      const parts: string[] = [];
      if (info.mydata.members.includes("etc/shadow") && copy["sys/shadow-tc"]) {
        mydata["etc/shadow"] = TC_LINE + copy["sys/shadow-tc"].trim();   // the image's full shadow is read at build time
        parts.push("password");
      }
      const sshInImage = info.mydata.members.some((m) => m.startsWith("usr/local/etc/ssh/"));
      for (const t of ["rsa", "ecdsa", "ed25519"]) {
        const k = `usr/local/etc/ssh/ssh_host_${t}_key`;
        if (sshInImage && copy[`sys/ssh_host_${t}_key`] && copy[`sys/ssh_host_${t}_key.pub`]) {
          mydata[k] = copy[`sys/ssh_host_${t}_key`];
          mydata[k + ".pub"] = copy[`sys/ssh_host_${t}_key.pub`];
          if (!parts.includes("SSH keys")) parts.push("SSH keys");
        }
      }
      rows.push({ file: "tce/mydata.tgz", inCopy: Object.keys(mydata).length > 0, inImage: true, action: parts.length ? "merge" : "skip", reason: parts.length ? parts.join(" + ") : "nothing usable in the copy (make a new copy)" });
    }
  }
  return { rows, conf, writes, removes, onbootAdded, mydata };
}

/** Applies a plan to the unpacked image and produces the .img.gz. */
export async function buildImage(info: ImageInfo, plan: BuildPlan, outFile: string, progress: Progress): Promise<{ file: string; sha256: string; bytes: number }> {
  const w = workPaths(path.dirname(info.raw));
  const ifs = new ImageFs(info.raw, info.offsetBytes);
  ensureDir(w.tmp);
  const ops: WriteOp[] = [];
  const meta = (name: string) => info.pypilotDir.find((e) => e.name === name);
  const tce = await ifs.ls("/tce");
  plan.writes.forEach((wr, i) => {
    const local = path.join(w.tmp, `w${i}`);
    fs.writeFileSync(local, wr.text);
    const isAbs = wr.name.startsWith("/");
    const target = isAbs ? wr.name : `/.pypilot/${wr.name}`;
    const m = isAbs ? tce?.find((e) => `/tce/${e.name}` === wr.name) : (meta(wr.name) ?? meta("pypilot.conf"));
    ops.push({ path: target, local, mode: m ? m.mode : 0o644, uid: m ? m.uid : 0, gid: m ? m.gid : 0 });
  });
  if (Object.keys(plan.mydata).length) {
    progress("mydata");
    const md = path.join(w.tmp, "mydata.tgz"), md2 = path.join(w.tmp, "mydata.new.tgz");
    if (!(await ifs.dump("/tce/mydata.tgz", md))) throw new Error("could not read mydata.tgz from the image");
    const spec: Record<string, string> = { ...plan.mydata };
    if (spec["etc/shadow"]?.startsWith(TC_LINE)) {
      const c = path.join(w.tmp, "cat.py"); fs.writeFileSync(c, MYDATA_CAT_PY);
      const s = await run("python3", [c, md, "etc/shadow"], { timeoutMs: 60_000 });
      const r = mergeShadow(s.stdout.toString(), spec["etc/shadow"].slice(TC_LINE.length));
      if (r.text) spec["etc/shadow"] = r.text; else delete spec["etc/shadow"];
    }
    const sp = path.join(w.tmp, "spec.json"); fs.writeFileSync(sp, JSON.stringify(spec));
    const py = path.join(w.tmp, "mydata.py"); fs.writeFileSync(py, MYDATA_PY);
    const r = await run("python3", [py, md, md2, sp], { timeoutMs: 120_000 });
    try { fs.unlinkSync(sp); } catch { /* gone */ }
    if (r.code !== 0) throw new Error(`could not rewrite mydata.tgz: ${r.stderr.slice(0, 300)}`);
    const ob = tce?.find((e) => e.name === "mydata.tgz");
    ops.push({ path: "/tce/mydata.tgz", local: md2, mode: ob ? ob.mode : 0o644, uid: ob ? ob.uid : 0, gid: ob ? ob.gid : 0 });
  }
  progress("write");
  const a = await ifs.apply(debugfsScript(ops, plan.removes.map((r) => `/.pypilot/${r}`)), path.join(w.tmp, "debugfs.cmd"));
  if (a.code !== 0) throw new Error(`debugfs failed: ${a.stderr.slice(0, 300)}`);
  for (const op of ops) {
    if (op.path.endsWith(".tgz")) continue;
    const back = await ifs.cat(op.path);
    if (back !== fs.readFileSync(op.local, "utf8")) throw new Error(`${op.path} did not read back as written`);
  }
  progress("check");
  const f = await ifs.fsck();
  if (f.code !== 0) throw new Error(`the image's file system did not pass e2fsck: ${(f.stderr || f.stdout.toString()).slice(0, 300)}`);
  progress("compress");
  const tmpOut = outFile + ".part";
  const g = await run("gzip", ["-c", "-6", info.raw], { stdoutFile: tmpOut, timeoutMs: 3_600_000 });
  if (g.code !== 0) throw new Error(`gzip failed: ${g.stderr.slice(0, 200)}`);
  fs.renameSync(tmpOut, outFile);
  progress("checksum");
  const sha = await sha256File(outFile);
  fs.writeFileSync(outFile + ".sha256", `${sha}  ${path.basename(outFile)}\n`);
  // secrets: nothing left behind but the finished image
  try { fs.rmSync(w.tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.unlinkSync(info.raw); } catch { /* best effort */ }
  return { file: outFile, sha256: sha, bytes: fs.statSync(outFile).size };
}
