/** Shared helpers for command builders. */

const YES_NO = (v: boolean) => (v ? 'yes' : 'no');

/** `=key=value` words for defined fields only (used by add/set). */
export function setWords(input: Record<string, string | number | boolean | undefined>): string[] {
  const words: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    words.push(`=${key}=${typeof value === 'boolean' ? YES_NO(value) : value}`);
  }
  return words;
}

/** `?key=value` filter words for print queries. */
export function queryWords(filter: Record<string, string | undefined> = {}): string[] {
  const words: string[] = [];
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    words.push(`?${key}=${value}`);
  }
  return words;
}

/** `=.id=<id>` word used by remove/set/enable/disable. */
export const idWord = (id: string): string => `=.id=${id}`;

/** Parse a RouterOS yes/no string. */
export const parseYesNo = (v: string | undefined): boolean => v === 'yes' || v === 'true';
