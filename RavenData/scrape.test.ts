import type { WebElement } from 'selenium-webdriver';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCatalog } from '../server/catalog.js';
import { selectCatalogTerm } from './scrape.js';

afterEach(() => vi.unstubAllEnvs());

function option(value: string, label: string) {
  return { getAttribute: vi.fn().mockResolvedValue(value), getText: vi.fn().mockResolvedValue(label) } as unknown as WebElement;
}

describe('Carleton term selection', () => {
  it('selects Fall 2026 by its value without depending on the displayed label', async () => {
    vi.stubEnv('ACTIVE_TERM', undefined);
    vi.stubEnv('ACTIVE_YEAR', undefined);
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('202620', 'Summer 2026'), option('202630', 'Fall 2026 (September - December)')]),
      selectByValue: vi.fn().mockResolvedValue(undefined),
    };
    await selectCatalogTerm(dropdown);
    expect(dropdown.selectByValue).toHaveBeenCalledExactlyOnceWith('202630');
  });

  it('honors the configured term and year for future catalog changes', async () => {
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('202630', 'Fall 2026'), option('202710', 'Winter 2027 (Jan-Apr)')]),
      selectByValue: vi.fn().mockResolvedValue(undefined),
    };
    await selectCatalogTerm(dropdown, readCatalog({ ACTIVE_TERM: 'WINTER', ACTIVE_YEAR: '2027' }));
    expect(dropdown.selectByValue).toHaveBeenCalledExactlyOnceWith('202710');
  });

  it('lists available terms when the requested term is unavailable', async () => {
    const dropdown = {
      getOptions: vi.fn().mockResolvedValue([option('', 'Select a term'), option('202710', 'Winter 2027')]),
      selectByValue: vi.fn(),
    };
    await expect(selectCatalogTerm(dropdown, readCatalog({}))).rejects.toThrow('does not offer FALL 2026 (202630). Available terms: Winter 2027 (202710). Set ACTIVE_TERM and ACTIVE_YEAR');
    expect(dropdown.selectByValue).not.toHaveBeenCalled();
  });
});
