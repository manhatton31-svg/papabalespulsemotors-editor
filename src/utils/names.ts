export function fileNameWithoutExt(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? 'Untitled';
  return name.replace(/\.[^.]+$/, '');
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export function lookupLibraryName(
  filePath: string,
  library: Record<string, string>
): string | undefined {
  const target = normalizePath(filePath);
  for (const [key, name] of Object.entries(library)) {
    if (normalizePath(key) === target) return name;
  }
  return undefined;
}

/** Avoid showing ugly auto-generated or hash-like filenames in the library UI. */
export function defaultBRollName(
  filePath: string,
  index: number,
  library: Record<string, string>
): string {
  const saved = lookupLibraryName(filePath, library);
  if (saved) return saved;

  const base = fileNameWithoutExt(filePath);
  const isUgly =
    /grok|session|composer|pulse|temp|thumb|cache/i.test(base) ||
    /^[a-f0-9-]{16,}$/i.test(base) ||
    /%[0-9a-f]{2}/i.test(base) ||
    base.length > 36;

  if (isUgly) return `broll_${index + 1}`;
  if (base.length > 32) return base.slice(0, 32);
  return base;
}