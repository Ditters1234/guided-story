import { redactClient } from './client-secrets';
import { reportUiError } from './ui-feedback';
export { registerClientSecret } from './client-secrets';

export function captureBrowserConsole() {
  let queue: { level: string; message: string; data: unknown }[] = [];
  let sending = false, stopped = false;
  const enqueue = (level: string, args: unknown[]) => {
    const safe = redactClient(args) as unknown[];
    const message = safe.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 12000);
    queue.push({ level, message, data: safe });
    if (level === 'error') reportUiError(message, 'Browser');
    queue = queue.slice(-100);
  };
  const restores: (() => void)[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[method];
    const wrapped = (...args: unknown[]) => { const safe = redactClient(args) as unknown[]; original.apply(console, safe); enqueue(method === 'log' ? 'info' : method, safe); };
    console[method] = wrapped; restores.push(() => { if (console[method] === wrapped) console[method] = original; });
  }
  const onError = (event: ErrorEvent) => {
    if (event.target instanceof HTMLImageElement) { reportUiError('A picture could not be loaded. Reload the story or open its gallery to try again.', 'Pictures'); return; }
    if (event.message) enqueue('error', [event.message, event.error || { file: event.filename, line: event.lineno }]);
  };
  const onRejection = (event: PromiseRejectionEvent) => enqueue('error', ['Unhandled rejection', event.reason]);
  const onInvalid = (event: Event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    const label = field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || field.getAttribute('aria-label') || field.name || 'Form field';
    reportUiError(`${label.slice(0, 120)}: ${field.validationMessage}`, 'Check form fields');
  };
  window.addEventListener('error', onError, true); window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('invalid', onInvalid, true);
  const timer = setInterval(async () => {
    if (sending || stopped || !queue.length) return;
    const batch = queue.splice(0, 20); sending = true;
    try { await fetch('/api/dev/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: batch }), keepalive: true }); } catch { /* Avoid recursive log storms on disconnect. */ }
    finally { sending = false; }
  }, 1200);
  return () => { stopped = true; clearInterval(timer); restores.forEach(fn => fn()); window.removeEventListener('error', onError, true); window.removeEventListener('unhandledrejection', onRejection); document.removeEventListener('invalid', onInvalid, true); };
}
