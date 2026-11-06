/** The caller owns this transient local URL and must release it on replacement/unmount. */
export function createDocumentPreview(file: File): { file: File; url: string; release: () => void } | null {
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) return null;
  const url = URL.createObjectURL(file);
  return { file, url, release: () => URL.revokeObjectURL(url) };
}
