import type { CourseGroup } from './types';

export async function searchCourse(query: string): Promise<Record<string, CourseGroup>> {
  const response = await fetch(`/api/course/search?query=${encodeURIComponent(query)}`);
  const payload = await response.json() as { data?: Record<string, CourseGroup>; message?: string };
  if (!response.ok || !payload.data) throw new Error(payload.message || 'Unable to find that course.');
  return payload.data;
}
