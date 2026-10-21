import { redact } from './redaction';

const secrets = new Set<string>();
let draftSecret = '';
export function registerClientSecret(value: string) { if (value) secrets.add(value); }
export function setClientDraftSecret(value: string) { draftSecret = value; }
export function redactClient(value: unknown, maxString = 6000) { return redact(value, draftSecret ? [...secrets, draftSecret] : secrets, maxString); }
