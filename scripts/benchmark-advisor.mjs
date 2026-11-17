/* global URL, AbortSignal, setTimeout */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = new URL(process.argv.find((arg) => arg.startsWith('--base-url='))?.slice('--base-url='.length) || 'http://127.0.0.1:5173').origin;
const plan = { program: '', year: null, courseCount: null, courses: [], keepCourses: [], daysOff: [], preferredDaysOff: [], lightDays: [], avoidInstructors: [], excludeInstructors: [], earliest: '', latest: '', preferAfter: '', preferBefore: '', electiveQuery: '' };
let session = { plan, messages: [], previousCRNs: [] };
const samples = []; let probing = true; let failures = 0;
const probe = async () => {
  while (probing) {
    await Promise.all(['/api/health', '/api/catalog', '/api/course/search?query=ERTH+1006&term=FALL&year=2026'].map(async (endpoint) => {
      const started = Date.now();
      try { const response = await fetch(origin + endpoint, { signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error('HTTP request failed'); await response.arrayBuffer(); samples.push(Date.now() - started); }
      catch { failures++; }
    }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
const status = await fetch(`${origin}/api/advisor/status`).then((response) => response.json());
if (!status.configured) throw new Error('Install the server model with npm run model:download before benchmarking.');
const probes = probe();
const results = [];
function turn(text) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/advisor', origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { origin });
    const started = Date.now(); let firstTokenMs; let deltas = 0; let streamed = '';
    const id = randomUUID();
    socket.on('open', () => socket.send(JSON.stringify({ type: 'turn', id, catalog: { term: 'FALL', year: 2026 }, session, text })));
    socket.on('error', reject);
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'delta') { firstTokenMs ??= Date.now() - started; deltas++; streamed += event.text; }
      if (event.type === 'error') { socket.close(); reject(new Error(event.message)); }
      if (event.type === 'done') {
        socket.close();
        if (streamed !== event.result.reply || deltas < 2) return reject(new Error('Incomplete token stream.'));
        const result = { text, ms: Date.now() - started, firstTokenMs, deltas };
        results.push(result); console.log(JSON.stringify(result));
        session = { plan: event.result.plan, previousCRNs: event.result.schedules?.[0]?.flatMap(({ parent, child }) => [parent.crn, ...(child ? [child.crn] : [])]) || session.previousCRNs, messages: [...session.messages, { role: 'user', content: text }, { role: 'assistant', content: event.result.reply }] };
        resolve(event.result);
      }
    });
  });
}
const load = (schedule, day) => schedule.flatMap(({ parent, child }) => [parent, ...(child ? [child] : [])]).filter((course) => !/^Online Unscheduled/i.test(course.section_type || '')).flatMap((course) => course.meeting_infos).filter((meeting) => meeting.days.split(/\s+/).includes(day)).reduce((sum, meeting) => { const [start, end] = meeting.time.split(' - ').map((time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; }); return sum + end - start; }, 0);
try {
  await turn("I'm a 4th-year CS student. I want Fridays off, I like geology electives, and I hate Professor X.");
  const before = await turn('I am eligible for COMP 1405, MATH 1007 and ERTH 1006. Take these three courses.');
  const after = await turn('Make my Tuesdays lighter, but keep my geology elective.');
  const beforeMinutes = load(before.schedules[0], 'Tue'); const afterMinutes = load(after.schedules[0], 'Tue');
  if (afterMinutes >= beforeMinutes || load(after.schedules[0], 'Fri') !== 0 || !after.plan.keepCourses.includes('ERTH 1006')) throw new Error('Schedule refinement failed.');
  probing = false; await probes;
  samples.sort((a, b) => a - b);
  const report = { date: new Date().toISOString(), inference: 'server CPU / isolated native process', turns: results, tuesdayMinutesBefore: beforeMinutes, tuesdayMinutesAfter: afterMinutes, fridayMinutes: 0, httpRequests: samples.length + failures, httpFailures: failures, httpP95Ms: samples[Math.floor(samples.length * 0.95)], httpMaxMs: samples.at(-1), finalPlan: after.plan };
  await mkdir('docs/verification', { recursive: true });
  await writeFile('docs/verification/server-advisor-workflow.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { probing = false; await probes; }
