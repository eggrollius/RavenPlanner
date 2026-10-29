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
    // Only creation called raise_for_status() in the Python API client.
    if (response.status >= 400) throw new Error(`${response.status} ${response.statusText} for url: ${url}`);
    return this.json(response);
  }

  async getCourses() {
    return this.json(await this.request(`${this.baseUrl}/courses`));
  }

  async searchCourse(query: string) {
    return this.json(await this.request(`${this.baseUrl}/course/search?${new URLSearchParams({ query })}`));
  }

  async checkCourseExistsByCrn(crn: string) {
    const url = `${this.baseUrl}/course/exists/${crn}`;
    this.log(`Requesting URL: ${url}`);
    const response = await this.request(url);
    this.log(`Response Status Code: ${response.status}`);
    const result = await this.json(response, true);
    this.log(`Response JSON: ${JSON.stringify(result)}`);
    return result;
  }

  async updateCourseById(id: string | number, course: JsonObject) {
    return this.json(await this.request(`${this.baseUrl}/course/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: encodePayload(course) }));
  }

  async updateCourseByCrn(crn: string, course: JsonObject) {
    const url = `${this.baseUrl}/course/crn/${crn}`;
    this.log(`Requesting URL: ${url}`);
    this.log(`Payload: ${JSON.stringify(course)}`);
    const response = await this.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: encodePayload(course) });
    this.log(`Response Status Code: ${response.status}`);
    const result = await this.json(response, true);
    this.log(`Response JSON: ${JSON.stringify(result)}`);
    return result;
  }

  async deleteCourseById(id: string | number) {
    return this.json(await this.request(`${this.baseUrl}/course/${id}`, { method: 'DELETE' }));
  }

  async deleteCourseByCrn(crn: string) {
    return this.json(await this.request(`${this.baseUrl}/course/crn/${crn}`, { method: 'DELETE' }));
  }
}
