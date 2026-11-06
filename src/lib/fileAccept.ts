const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Keep the native picker and drag/drop validator aligned with the advertised extensions. */
export function fileAccept(extensions: string[]): Record<string, string[]> {
  const accept: Record<string, string[]> = {};
  for (const entry of extensions) {
    const extension = entry.toLowerCase();
    const mime = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
    (accept[mime] ??= []).push(extension);
  }
  return accept;
}
