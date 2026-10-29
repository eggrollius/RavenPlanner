import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.PORT || 5000}`;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, 200, `${method} ${path}: ${await response.clone().text()}`);
  return response.json();
}

assert.deepEqual(await api('/health'), { status: 'ok' });
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /<title>Raven Planner<\/title>/);

const fall = 'term=FALL&year=2026';
const winter = 'term=WINTER&year=2027';
const original = (await api(`/course/search?query=TEST+1000&${fall}`)).data.A.parent;
assert.equal(original.id, 1);
assert.equal(original.meeting_infos[0].room, 'Original room');
// The live PHYS 1004 list is 335 characters; the legacy VARCHAR(255) rejected it.
const registrationLinks = Array.from({ length: 24 }, (_, i) => `PHYS 1004 L${String(i + 1).padStart(2, '0')}`).join(',');
assert.equal(registrationLinks.length, 335);
await api(`/course/crn/migration-check?${fall}`, 'PUT', { also_register_in: registrationLinks });
assert.equal((await api(`/course/search?query=TEST+1000&${fall}`)).data.A.parent.also_register_in, registrationLinks);

for (const catalog of [{ term: 'WINTER', year: 2027 }, { term: 'SUMMER', year: 2026 }, { term: 'FALL', year: 2027 }]) {
  const body = { ...catalog, crn: 'migration-check', course_code: 'TEST 1000', section: 'A', instructor: catalog.term, meeting_infos: { room: catalog.term } };
  assert.equal((await api('/course', 'POST', body)).message, 'New course added');
  assert.equal((await api('/course', 'POST', body)).message, 'CRN already exists, duplicate');
  const courses = (await api(`/courses?term=${catalog.term}&year=${catalog.year}`)).courses;
  assert.equal(courses.length, 1);
  assert.equal(courses[0].term, catalog.term);
  assert.equal(courses[0].year, catalog.year);
}
await api(`/course/crn/migration-check?${winter}`, 'PUT', { instructor: 'Winter only', meeting_infos: { room: 'New winter room' } });
assert.equal((await api(`/course/search?query=TEST+1000&${winter}`)).data.A.parent.instructor, 'Winter only');
assert.equal((await api(`/course/search?query=TEST+1000&${fall}`)).data.A.parent.meeting_infos[0].room, 'Original room');
await api(`/course/crn/migration-check?${winter}`, 'DELETE');
assert.equal((await api(`/course/exists/migration-check?${winter}`)).exists, false);
assert.equal((await api(`/course/exists/migration-check?${fall}`)).exists, true);
assert.equal((await api('/catalog')).catalogs.length >= 3, true);
console.log('PostgreSQL migration, preserved data, catalog isolation, and rendered client verified.');
