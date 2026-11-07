// Rev647 (Carlos 2026-11-06): the TinyPilot log capture wrote one file per
// day with no limit (708 MB on the boat, days of 290 MB). Past days are
// gzipped (text logs shrink to ~10 %), files older than `maxAgeDays` are
// deleted, and the oldest go first while the folder is above `maxTotalBytes`.
// Today's file is never touched: it is the one being appended to and the
// one the visor's tail / download read.
// Compression is streamed, one file at a time, so a 290 MB day never blocks
// Signal K's event loop (see the 5 h freeze of 2026-10-23).
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { pipeline } from "stream/promises";

export interface LogRetentionOptions {
  maxAgeDays: number;
  maxTotalBytes: number;
}
export const LOG_RETENTION_DEFAULTS: LogRetentionOptions = { maxAgeDays: 30, maxTotalBytes: 300 * 1024 * 1024 };

export interface LogRetentionResult { gzipped: string[]; deleted: string[]; totalBytes: number }

const NAME = /^pizero-(\d{8})\.log(\.gz)?$/;

function dayStamp(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function stampMs(stamp: string): number {
  return new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8))).getTime();
}

let running = false;

export async function pruneLogDir(dir: string, now: Date = new Date(), opts: LogRetentionOptions = LOG_RETENTION_DEFAULTS): Promise<LogRetentionResult> {
  const out: LogRetentionResult = { gzipped: [], deleted: [], totalBytes: 0 };
  if (running) return out;   // one pass at a time
  running = true;
  try {
    const today = dayStamp(now);
    const list = (): { name: string; stamp: string; gz: boolean }[] => {
      let names: string[] = [];
      try { names = fs.readdirSync(dir); } catch { return []; }
      return names.map((n) => { const m = NAME.exec(n); return m ? { name: n, stamp: m[1], gz: !!m[2] } : null; })
        .filter((x): x is { name: string; stamp: string; gz: boolean } => !!x)
        .sort((a, b) => a.stamp.localeCompare(b.stamp));
    };
    const rm = (name: string) => { try { fs.unlinkSync(path.join(dir, name)); out.deleted.push(name); } catch { /* gone */ } };

    // 1. Past days: gzip, then drop the plain file. A half-written .gz from
    //    an interrupted pass is replaced; the plain file is kept until the
    //    .gz is complete.
    for (const f of list()) {
      if (f.gz || f.stamp >= today) continue;
      const src = path.join(dir, f.name);
      const dst = `${src}.gz`;
      const tmp = `${dst}.tmp`;
      try {
        await pipeline(fs.createReadStream(src), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
        fs.renameSync(tmp, dst);
        fs.unlinkSync(src);
        out.gzipped.push(f.name);
      } catch {
        try { fs.unlinkSync(tmp); } catch { /* none */ }
      }
    }
    // 2. Too old.
    const oldest = now.getTime() - opts.maxAgeDays * 86400_000;
    for (const f of list()) if (f.stamp < today && stampMs(f.stamp) < oldest) rm(f.name);
    // 3. Size cap, oldest first, today's file never.
    const sized = list().map((f) => { let size = 0; try { size = fs.statSync(path.join(dir, f.name)).size; } catch { /* gone */ } return { ...f, size }; });
    let total = sized.reduce((a, f) => a + f.size, 0);
    for (const f of sized) {
      if (total <= opts.maxTotalBytes) break;
      if (f.stamp >= today) continue;
      rm(f.name);
      total -= f.size;
    }
    out.totalBytes = total;
    return out;
  } finally {
    running = false;
  }
}
