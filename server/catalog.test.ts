import { describe, expect, it } from 'vitest';
import { catalogFromCode, parseCatalog, readCatalog } from './catalog.js';

describe('catalog configuration', () => {
  it('validates request catalogs and portal codes without silently falling back to defaults', () => {
    expect(parseCatalog(' winter ', '2027')).toEqual({ term: 'WINTER', year: 2027 });
    expect(catalogFromCode('202620')).toEqual({ term: 'SUMMER', year: 2026, termCode: '202620' });
    for (const code of ['', '202640', '20261', '000010', '202630extra']) expect(catalogFromCode(code)).toBeUndefined();
    expect(() => parseCatalog(['FALL'], 2026)).toThrow('term');
    expect(() => parseCatalog('FALL', undefined)).toThrow('year');
  });
  it('defaults to Fall 2026', () => {
    expect(readCatalog({})).toEqual({ term: 'FALL', year: 2026, termCode: '202630' });
  });

  it.each([
    ['WINTER', '2027', '202710'], ['SUMMER', '2025', '202520'], ['FALL', '2026', '202630'],
  ])('maps %s %s to the Carleton option value', (term, year, termCode) => {
    expect(readCatalog({ ACTIVE_TERM: term, ACTIVE_YEAR: year })).toEqual({ term, year: Number(year), termCode });
  });

  it('normalizes term casing and surrounding whitespace', () => {
    expect(readCatalog({ ACTIVE_TERM: ' fall ', ACTIVE_YEAR: ' 2026 ' })).toEqual({ term: 'FALL', year: 2026, termCode: '202630' });
  });

  it('rejects unsupported terms and malformed years before opening the browser', () => {
    expect(() => readCatalog({ ACTIVE_TERM: 'SPRING' })).toThrow('ACTIVE_TERM');
    for (const year of ['26', '2026.5', '2e3', 'NaN', '0000', '10000']) {
      expect(() => readCatalog({ ACTIVE_YEAR: year })).toThrow('ACTIVE_YEAR');
    }
  });
});
