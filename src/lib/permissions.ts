export function canEdit(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'owner' || role === 'editor';
}

export function isOwner(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'owner';
}
