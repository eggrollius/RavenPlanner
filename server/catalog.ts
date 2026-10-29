const termCodes = { WINTER: '10', SUMMER: '20', FALL: '30' } as const;

export interface Catalog {
  term: keyof typeof termCodes;
  year: number;
}

export function parseCatalog(term: unknown, year: unknown): Catalog {
  const season = typeof term === 'string' ? term.trim().toUpperCase() : '';
  const yearText = typeof year === 'string' || typeof year === 'number' ? String(year).trim() : '';
  if (!Object.hasOwn(termCodes, season)) throw new Error('term must be WINTER, SUMMER, or FALL.');
  if (!/^\d{4}$/.test(yearText) || Number(yearText) < 1000) throw new Error('year must be a four-digit year.');
  return { term: season as Catalog['term'], year: Number(yearText) };
}

export function catalogFromCode(code: string): (Catalog & { termCode: string }) | undefined {
  if (!/^\d{4}(10|20|30)$/.test(code)) return;
  const term = (Object.keys(termCodes) as Catalog['term'][]).find((season) => code.endsWith(termCodes[season]))!;
  try { return { ...parseCatalog(term, code.slice(0, 4)), termCode: code }; } catch { return; }
}

export function readCatalog(env: NodeJS.ProcessEnv = process.env): Catalog & { termCode: string } {
  const term = (env.ACTIVE_TERM || 'FALL').trim().toUpperCase();
  const year = (env.ACTIVE_YEAR || '2026').trim();
  if (!Object.hasOwn(termCodes, term)) throw new Error('ACTIVE_TERM must be WINTER, SUMMER, or FALL.');
  if (!/^\d{4}$/.test(year) || Number(year) < 1000) throw new Error('ACTIVE_YEAR must be a four-digit year.');
  const season = term as Catalog['term'];
  return { term: season, year: Number(year), termCode: `${year}${termCodes[season]}` };
}
