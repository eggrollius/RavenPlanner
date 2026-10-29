import type { CourseGroup } from './types';

export async function getCatalog(signal?: AbortSignal): Promise<{ term: string; year: number }> {
  const response = await fetch('/api/catalog', { signal });
  const catalog = await response.json() as { term: string; year: number };
  if (!response.ok || typeof catalog.term !== 'string' || !Number.isInteger(catalog.year)) throw new Error('Unable to load the course catalog.');
  return catalog;
}

export async function searchCourse(query: string): Promise<Record<string, CourseGroup>> {
  const response = await fetch(`/api/course/search?query=${encodeURIComponent(query)}`);
  const payload = await response.json() as { data?: Record<string, CourseGroup>; message?: string };
  if (!response.ok || !payload.data) throw new Error(payload.message || 'Unable to find that course.');
  return payload.data;
}
