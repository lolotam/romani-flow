/** Accept the placeholder conventions used by both translation dictionaries. */
export function formatTranslation(value: string, params: Record<string, string | number>): string {
  return value.replace(/\{\{?(\w+)\}?\}/g, (match, key: string) => params[key]?.toString() ?? match);
}
