import type { Catalog } from '../server/catalog.js';

type JsonObject = Record<string, unknown>;
type Log = (message: string) => void;

function encodePayload(payload: JsonObject) {
  return JSON.stringify(payload, (_key, value: unknown) => {
    // requests' json= rejects non-finite floats rather than converting to null.
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Out of range float values are not JSON compliant');
    return value;
  });
}

export class RavenApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl = process.env.RAVEN_API_URL ?? 'https://www.ravenplanner.ca/api',
    private readonly request: typeof fetch = fetch,
    private readonly log: Log = console.log,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async json(response: Response, tolerateInvalid = false): Promise<JsonObject> {
    try {
      return await response.json() as JsonObject;
    } catch (error) {
      if (!tolerateInvalid) throw error;
      this.log(`Error parsing JSON: ${error}`);
      return {};
    }
  }

  async addCourse(course: JsonObject) {
    const url = `${this.baseUrl}/course`;
    this.log(`Request URL: ${url}`);
    this.log(`Request Data: ${JSON.stringify(course)}`);
    const response = await this.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: encodePayload(course) });
    this.log(`Response Status Code: ${response.status}`);
    this.log(`Response Content: ${await response.clone().text()}`);
    if (response.status >= 400) throw new Error(`${response.status} ${response.statusText} for url: ${url}`);
    return this.json(response);
  }

  private scoped(path: string, catalog?: Catalog) {
    const suffix = catalog ? `${path.includes('?') ? '&' : '?'}${new URLSearchParams({ term: catalog.term, year: String(catalog.year) })}` : '';
    return `${this.baseUrl}${path}${suffix}`;
  }

  async getCourses(catalog?: Catalog) {
    return this.json(await this.request(this.scoped('/courses', catalog)));
  }

  async searchCourse(query: string, catalog?: Catalog) {
    return this.json(await this.request(this.scoped(`/course/search?${new URLSearchParams({ query })}`, catalog)));
  }

  async checkCourseExistsByCrn(crn: string, catalog?: Catalog) {
    const url = this.scoped(`/course/exists/${encodeURIComponent(crn)}`, catalog);
    this.log(`Requesting URL: ${url}`);
    const response = await this.request(url);
    this.log(`Response Status Code: ${response.status}`);
    if (response.status >= 400) throw new Error(`${response.status} ${response.statusText} for url: ${url}`);
    const result = await this.json(response, true);
    this.log(`Response JSON: ${JSON.stringify(result)}`);
    return result;
  }

  async updateCourseById(id: string | number, course: JsonObject, catalog?: Catalog) {
    return this.json(await this.request(this.scoped(`/course/${id}`, catalog), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: encodePayload(course) }));
  }

  async updateCourseByCrn(crn: string, course: JsonObject, catalog?: Catalog) {
    const url = this.scoped(`/course/crn/${encodeURIComponent(crn)}`, catalog);
    this.log(`Requesting URL: ${url}`);
    this.log(`Payload: ${JSON.stringify(course)}`);
    const response = await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: encodePayload(course) });
    this.log(`Response Status Code: ${response.status}`);
    if (response.status >= 400) throw new Error(`${response.status} ${response.statusText} for url: ${url}`);
    const result = await this.json(response, true);
    this.log(`Response JSON: ${JSON.stringify(result)}`);
    return result;
  }

  async deleteCourseById(id: string | number, catalog?: Catalog) {
    return this.json(await this.request(this.scoped(`/course/${id}`, catalog), { method: 'DELETE' }));
  }

  async deleteCourseByCrn(crn: string, catalog?: Catalog) {
    return this.json(await this.request(this.scoped(`/course/crn/${encodeURIComponent(crn)}`, catalog), { method: 'DELETE' }));
  }
}
