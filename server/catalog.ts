const termCodes = { WINTER: '10', SUMMER: '20', FALL: '30' } as const;

export interface Catalog {
  term: keyof typeof termCodes;
  year: number;
}

export function readCatalog(env: NodeJS.ProcessEnv = process.env): Catalog & { termCode: string } {
  const term = (env.ACTIVE_TERM || 'FALL').trim().toUpperCase();
  const year = (env.ACTIVE_YEAR || '2026').trim();
  if (!Object.hasOwn(termCodes, term)) throw new Error('ACTIVE_TERM must be WINTER, SUMMER, or FALL.');
  if (!/^\d{4}$/.test(year) || Number(year) < 1000) throw new Error('ACTIVE_YEAR must be a four-digit year.');
  const season = term as Catalog['term'];
  return { term: season, year: Number(year), termCode: `${year}${termCodes[season]}` };
}
