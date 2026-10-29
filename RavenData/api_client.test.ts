import { afterEach, describe, expect, it, vi } from 'vitest';
import { RavenApiClient } from './api_client.js';

afterEach(() => vi.unstubAllEnvs());

function client(response = () => new Response('{"ok":true}', { status: 200 })) {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => response());
  return { api: new RavenApiClient('https://example.test/api///', request, vi.fn()), request };
}

describe('legacy API client contract', () => {
  it('uses the same URLs, verbs, query encoding, and JSON bodies for every helper', async () => {
    const { api, request } = client();
    const payload = { crn: '12345', meeting_infos: { days: 'Mon Wed' } };
    const results = await Promise.all([
      api.addCourse(payload), api.getCourses(), api.searchCourse('COMP 1405 & A'),
      api.checkCourseExistsByCrn('12345'), api.updateCourseById(7, payload),
      api.updateCourseByCrn('12345', payload), api.deleteCourseById(7), api.deleteCourseByCrn('12345'),
    ]);
    expect(results).toEqual(Array.from({ length: 8 }, () => ({ ok: true })));
    const json = (method: string) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(request.mock.calls).toEqual([
      ['https://example.test/api/course', json('POST')],
      ['https://example.test/api/courses'],
      ['https://example.test/api/course/search?query=COMP+1405+%26+A'],
      ['https://example.test/api/course/exists/12345'],
      ['https://example.test/api/course/7', json('PUT')],
      ['https://example.test/api/course/crn/12345', json('PUT')],
      ['https://example.test/api/course/7', { method: 'DELETE' }],
      ['https://example.test/api/course/crn/12345', { method: 'DELETE' }],
    ]);
  });

  it('honors RAVEN_API_URL and keeps the original default', () => {
    vi.stubEnv('RAVEN_API_URL', undefined);
    expect(new RavenApiClient().baseUrl).toBe('https://www.ravenplanner.ca/api');
    vi.stubEnv('RAVEN_API_URL', 'http://localhost:5000/api/');
    expect(new RavenApiClient().baseUrl).toBe('http://localhost:5000/api');
  });

  it('raises HTTP errors only for course creation, as the Python client did', async () => {
    const { api } = client(() => new Response('{"message":"failed"}', { status: 500 }));
    await expect(api.addCourse({ crn: '1' })).rejects.toThrow('500');
    await expect(api.updateCourseByCrn('1', {})).resolves.toEqual({ message: 'failed' });
    await expect(api.checkCourseExistsByCrn('1')).resolves.toEqual({ message: 'failed' });
    await expect(api.getCourses()).resolves.toEqual({ message: 'failed' });
    await expect(api.searchCourse('COMP 1405')).resolves.toEqual({ message: 'failed' });
    await expect(api.updateCourseById(1, {})).resolves.toEqual({ message: 'failed' });
    await expect(api.deleteCourseById(1)).resolves.toEqual({ message: 'failed' });
    await expect(api.deleteCourseByCrn('1')).resolves.toEqual({ message: 'failed' });
  });

  it('tolerates invalid JSON only for existence checks and CRN updates', async () => {
    const { api } = client(() => new Response('not json'));
    await expect(api.checkCourseExistsByCrn('1')).resolves.toEqual({});
    await expect(api.updateCourseByCrn('1', {})).resolves.toEqual({});
    await expect(api.addCourse({})).rejects.toThrow();
    await expect(api.getCourses()).rejects.toThrow();
    await expect(api.searchCourse('COMP 1405')).rejects.toThrow();
    await expect(api.updateCourseById(1, {})).rejects.toThrow();
    await expect(api.deleteCourseById(1)).rejects.toThrow();
    await expect(api.deleteCourseByCrn('1')).rejects.toThrow();
  });

  it('rejects non-finite numbers at the request boundary just like requests json=', async () => {
    const { api, request } = client();
    for (const credits of [NaN, Infinity, -Infinity]) {
      await expect(api.addCourse({ crn: '1', credits })).rejects.toThrow('not JSON compliant');
      await expect(api.updateCourseByCrn('1', { credits })).rejects.toThrow('not JSON compliant');
      await expect(api.updateCourseById(1, { credits })).rejects.toThrow('not JSON compliant');
    }
    expect(request).not.toHaveBeenCalled();
  });
});
