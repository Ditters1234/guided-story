import { z } from 'zod';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { setupDraftSchema, validateSetupPlan, type SetupDraft } from '../setup';
import { StoryError } from '../errors';

export const MAX_SETUP_ARCHIVE_BYTES = 5_000_000;
export const MAX_EXPANDED_SETUP_BYTES = 10_000_000;
const names = ['manifest.json', 'setup.json'];
const manifestSchema = z.strictObject({ kind: z.literal('storyweaver-setup'), version: z.literal(1), exportedAt: z.string().datetime() });

// Schema defaults remain useful for development saves, but unknown fields must never
// sneak provider credentials, jobs or unrelated files into a portable setup.
function rejectUnknownFields(raw: unknown, parsed: unknown, path = 'setup') {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    raw.forEach((value, i) => rejectUnknownFields(value, parsed[i], `${path}[${i}]`));
  } else if (raw && parsed && typeof raw === 'object' && typeof parsed === 'object') {
    const valid = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(valid, key)) throw new StoryError(`Unsupported field in ${path.slice(0, 160)}. Use a setup ZIP exported by this app.`);
      rejectUnknownFields(value, valid[key], `${path}.${key}`);
    }
  }
}

export function validatePortableSetup(value: unknown): SetupDraft {
  const draft = setupDraftSchema.parse(value);
  rejectUnknownFields(value, draft);
  if (draft.storyId) throw new StoryError('This setup is already a written story. Use a story ZIP instead.', 409);
  if (draft.plan) {
    try { draft.plan = validateSetupPlan(draft.plan); }
    catch (error) { throw new StoryError(error instanceof Error ? error.message : 'Check the setup references.'); }
  }
  return draft;
}

export function encodeSetupArchive(value: SetupDraft): Uint8Array {
  const draft = validatePortableSetup(value);
  const payload = strToU8(JSON.stringify(draft));
  const manifest = strToU8(JSON.stringify({ kind: 'storyweaver-setup', version: 1, exportedAt: new Date().toISOString() }));
  if (payload.length + manifest.length > MAX_EXPANDED_SETUP_BYTES) throw new StoryError('This setup exceeds the 10 MB metadata export limit.', 413);
  const bytes = zipSync({ 'manifest.json': manifest, 'setup.json': payload }, { level: 6 });
  if (bytes.length > MAX_SETUP_ARCHIVE_BYTES) throw new StoryError('This setup exceeds the 5 MB ZIP export limit.', 413);
  return bytes;
}

export function decodeSetupArchive(bytes: Uint8Array): SetupDraft {
  if (!bytes.length || bytes.length > MAX_SETUP_ARCHIVE_BYTES) throw new StoryError('Setup ZIP files must be no larger than 5 MB.', 413);
  let total = 0;
  const seen = new Set<string>();
  let files: ReturnType<typeof unzipSync>;
  try {
    files = unzipSync(bytes, { filter(file) {
      if (seen.has(file.name) || seen.size >= 2) throw new StoryError('Setup ZIP contains duplicate or too many entries.');
      if (!names.includes(file.name)) throw new StoryError('Unsupported file or unsafe path in this setup ZIP.');
      seen.add(file.name);
      total += file.originalSize;
      if (total > MAX_EXPANDED_SETUP_BYTES || (file.name === 'manifest.json' && file.originalSize > 2000)) throw new StoryError('Expanded setup ZIP is too large.', 413);
      return true;
    } });
  } catch (error) {
    if (error instanceof StoryError) throw error;
    throw new StoryError('This archive is corrupt or is not a supported setup ZIP.');
  }
  if (seen.size !== 2 || names.some(name => !files[name])) throw new StoryError('This is not a complete Storyweaver setup ZIP. It needs manifest.json and setup.json.');
  if (Object.values(files).reduce((size, file) => size + file.length, 0) > MAX_EXPANDED_SETUP_BYTES) throw new StoryError('Expanded setup ZIP is too large.', 413);
  let manifest: unknown, draft: unknown;
  try {
    // Fatal UTF-8 decoding also rejects damaged metadata instead of silently replacing it.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    manifest = JSON.parse(decoder.decode(files['manifest.json']));
    draft = JSON.parse(decoder.decode(files['setup.json']));
  } catch { throw new StoryError('The setup ZIP contains corrupt or invalid JSON metadata.'); }
  if (!manifestSchema.safeParse(manifest).success) throw new StoryError('Incompatible setup ZIP format. Export the unfinished setup with this version of Storyweaver.');
  return validatePortableSetup(draft);
}
