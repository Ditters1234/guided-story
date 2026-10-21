/** Download saved setup metadata; HTTP failures stay in the app's error panel. */
export async function downloadSetup(id: string, expectedRevision?: number) {
  const query = expectedRevision === undefined ? '' : `?expectedRevision=${expectedRevision}`;
  const response = await fetch(`/api/setups/${encodeURIComponent(id)}/export${query}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not export the saved setup.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'storyweaver-setup.zip';
  document.body.append(link); link.click(); link.remove();
  // Let the browser begin consuming the object URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
