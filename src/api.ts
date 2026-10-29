import type { Catalog, CatalogResponse, CourseGroup } from './types';

export async function getCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  const response = await fetch('/api/catalog', { signal });
  const catalog = await response.json() as CatalogResponse;
  const valid = (entry: Catalog) => entry && ['WINTER', 'SUMMER', 'FALL'].includes(entry.term) && Number.isInteger(entry.year);
  if (!response.ok || !valid(catalog) || !Array.isArray(catalog.catalogs) || !catalog.catalogs.length || !catalog.catalogs.every(valid)) throw new Error('Unable to load the course catalog.');
  return catalog;
}

export async function searchCourse(query: string, catalog: Catalog, signal?: AbortSignal): Promise<Record<string, CourseGroup>> {
  const response = await fetch(`/api/course/search?${new URLSearchParams({ query, term: catalog.term, year: String(catalog.year) })}`, { signal });
  const payload = await response.json() as { data?: Record<string, CourseGroup>; message?: string };
  if (!response.ok || !payload.data) throw new Error(payload.message || 'Unable to find that course.');
  return payload.data;
}
