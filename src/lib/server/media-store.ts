import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWriteFile } from './atomic-files';
import { StoryError } from '../errors';
import type { MediaAsset, Passage } from '../story';

export const MAX_ARCHIVE_BYTES = 128_000_000;
export function passageImageHash(p: Passage) { return createHash('sha256').update(JSON.stringify([p.id, p.paragraphs])).digest('hex'); }
export class MediaStore {
  constructor(readonly root: string) {}
  private path(hash: string, thumbnail = false) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new StoryError('Invalid image identity.');
    return resolve(this.root, hash + (thumbnail ? '.thumb.webp' : '.original'));
  }
  async inspect(bytes: Uint8Array) {
    if (!bytes.length || bytes.length > 20_000_000) throw new StoryError('Images must be no larger than 20 MB.', 413);
    try {
      const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false }), m = await image.metadata();
      if (!['png','jpeg','webp'].includes(m.format || '') || !m.width || !m.height || (m.pages || 1) > 1 || m.width > 16384 || m.height > 16384) throw new Error();
      const thumb = await image.rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
      const swap = (m.orientation || 1) >= 5;
      return { hash: createHash('sha256').update(bytes).digest('hex'), mime: `image/${m.format}` as MediaAsset['mime'], width: swap ? m.height : m.width, height: swap ? m.width : m.height, bytes: bytes.length, thumb };
    } catch { throw new StoryError('Use a valid, single-frame PNG, JPEG, or WebP image (up to 40 megapixels).'); }
  }
  save(bytes: Uint8Array, info: Awaited<ReturnType<MediaStore['inspect']>>) {
    // Content-addressed files may be shared by imported copies. Never delete them on a metadata edit.
    const path = this.path(info.hash);
    if (!existsSync(path) || statSync(path).size !== bytes.length || createHash('sha256').update(readFileSync(path)).digest('hex') !== info.hash) atomicWriteFile(path, bytes);
    if (!existsSync(this.path(info.hash, true))) atomicWriteFile(this.path(info.hash, true), info.thumb);
  }
  original(asset: MediaAsset) {
    let bytes: Buffer;
    try { if (statSync(this.path(asset.hash)).size > 20_000_000) throw new Error(); bytes = readFileSync(this.path(asset.hash)); } catch { throw new StoryError('This story image is missing or unreadable in local storage.', 404); }
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.hash) throw new StoryError('This story image failed its integrity check. Restore it from a story export.', 409);
    return bytes;
  }
  async file(asset: MediaAsset, thumbnail = false) {
    if (!thumbnail) return { bytes: this.original(asset), mime: asset.mime };
    const path = this.path(asset.hash, true);
    if (!existsSync(path)) { const bytes = this.original(asset); const info = await this.inspect(bytes); this.save(bytes, info); }
    return { bytes: readFileSync(path), mime: 'image/webp' };
  }
  audit(assets: MediaAsset[]) {
    const files = existsSync(this.root) ? readdirSync(this.root) : [];
    const originals = files.filter(n => /^[a-f0-9]{64}\.original$/.test(n));
    const referenced = new Set(assets.map(a => a.hash)), missing: string[] = [], corrupt: string[] = [];
    for (const a of new Map(assets.map(a => [a.hash, a])).values()) {
      if (!existsSync(this.path(a.hash))) missing.push(a.hash);
      else { try { this.original(a); } catch { corrupt.push(a.hash); } }
    }
    return { records: assets.length, uniqueImages: referenced.size, originals: originals.length, bytes: originals.reduce((sum, n) => sum + statSync(resolve(this.root, n)).size, 0), thumbnails: files.filter(n => /^[a-f0-9]{64}\.thumb\.webp$/.test(n)).length, unreferenced: originals.map(n => n.slice(0,64)).filter(hash => !referenced.has(hash)), missing, corrupt, stagingFiles: files.filter(n => /^[a-f0-9]{64}\.(original|thumb\.webp)\.[a-f0-9-]{36}\.tmp$/.test(n)).length };
  }
}
