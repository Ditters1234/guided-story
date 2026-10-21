// Uses Corvus fileManager.ts's temp → fsync → rename pattern; see notices.
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export function atomicWriteFile(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`; let fd: number | undefined;
  try { fd = openSync(temporary, 'wx'); writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); fd = undefined; renameSync(temporary, path); }
  finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
}
