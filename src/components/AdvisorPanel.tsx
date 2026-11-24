import { useEffect, useMemo, useRef, useState } from 'react';
import { propose } from '../advisor/agent';
import { advisorStatus, streamTurn } from '../advisor/model';
import { freshSession, readSession, saveSession } from '../advisor/storage';
import { createTools } from '../advisor/tools';
import { scheduleCourses } from '../scheduler';
import type { Catalog, ScheduleSection } from '../types';
import { ScheduleView } from './ScheduleView';

export function AdvisorPanel({ catalog }: { catalog: Catalog }) {
  const [session, setSession] = useState(() => readSession(catalog));
  const [schedules, setSchedules] = useState<ScheduleSection[][]>([]);
  const [current, setCurrent] = useState(false);
  const [available, setAvailable] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [streaming, setStreaming] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [trace, setTrace] = useState<string[]>([]);
  const [text, setText] = useState('');
  const operation = useRef<AbortController>();
  const latestSession = useRef(session);
  const transcript = useRef<HTMLDivElement>(null);
  const tools = useMemo(() => createTools(catalog), [catalog]);

  useEffect(() => {
    const controller = new AbortController();
    advisorStatus(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setAvailable(result.configured);
        if (!result.configured) setError('The server’s advisor model is not configured. Manual planning is available.');
        else setError('');
      }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to reach the advisor.'); });
    return () => controller.abort();
  }, [connectionAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    const saved = latestSession.current;
    if (saved.previousCRNs.length && saved.plan.courses.length) {
      const timer = setTimeout(() => {
        setStatus('Rechecking the saved proposal against the term catalog…');
        propose(saved.plan, tools, saved.previousCRNs, controller.signal, []).then((result) => {
          if (controller.signal.aborted) return;
          setSchedules(result.schedules || []);
          setCurrent(result.current);
          if (!result.current) setError(`Saved proposal needs attention. ${result.reply}`);
        }).catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to restore the saved proposal.');
        }).finally(() => { if (!controller.signal.aborted) setStatus(''); });
      }, 0);
      return () => { clearTimeout(timer); controller.abort(); operation.current?.abort(); };
    }
    return () => { controller.abort(); operation.current?.abort(); };
  }, [tools]);

  useEffect(() => { transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'auto' }); }, [session.messages, status, streaming]);

  const persist = (next: typeof session) => {
    latestSession.current = next;
    setSession(next);
    setStorageError(!saveSession(catalog, next));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim() || status || !available) return;
    const input = text.trim();
    const before = session;
    const next = { ...before, messages: [...before.messages, { role: 'user' as const, content: input }].slice(-20) };
    persist(next);
    setText('');
    setError('');
    setTrace([]);
    setStreaming('');
    setStatus('Connecting to the advisor…');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await streamTurn(catalog, before, input, controller.signal, setStatus, (chunk) => { if (!controller.signal.aborted) setStreaming((current) => current + chunk); });
      if (controller.signal.aborted) return;
      if (result.schedules) setSchedules(result.schedules);
      // A question without plan changes leaves the existing proposal valid.
      const unchanged = JSON.stringify(result.plan) === JSON.stringify(before.plan);
      setCurrent(result.current || (unchanged && current));
      setTrace(result.trace);
      persist({ plan: result.plan, messages: [...next.messages, { role: 'assistant' as const, content: result.reply }].slice(-20), previousCRNs: result.schedules?.[0]?.flatMap(scheduleCourses).map(({ crn }) => crn) || before.previousCRNs });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'The advisor could not complete this request.');
        setText((draft) => draft || input);
      }
    } finally {
      setStreaming('');
      if (operation.current === controller) setStatus('');
    }
  };

  const stop = () => { operation.current?.abort(); setStreaming(''); setStatus(''); };
  const reset = () => { operation.current?.abort(); setStatus(''); setStreaming(''); persist(freshSession()); setSchedules([]); setTrace([]); setCurrent(false); setError(''); };
  const plan = session.plan;
  const requirements = [
    ...plan.courses.map((code) => `${plan.keepCourses.includes(code) ? 'Pinned · ' : ''}${code}`),
    ...plan.daysOff.map((day) => `${day} off`),
    ...plan.excludeInstructors.map((name) => `Exclude ${name}`),
    ...(plan.earliest ? [`Start ≥ ${plan.earliest}`] : []), ...(plan.latest ? [`Finish ≤ ${plan.latest}`] : []),
  ];
  const preferences = [
    ...plan.preferredDaysOff.map((day) => `Prefer ${day} off`), ...plan.lightDays.map((day) => `Lighter ${day}`), ...plan.avoidInstructors.map((name) => `Prefer avoiding ${name}`),
    ...(plan.preferAfter ? [`Prefer after ${plan.preferAfter}`] : []), ...(plan.preferBefore ? [`Prefer before ${plan.preferBefore}`] : []), ...(plan.electiveQuery ? [`Interested in ${plan.electiveQuery}`] : []),
  ];

  return <section className="advisor" aria-label="AI academic advisor">
    <div className="advisor-intro"><div><p className="step-label">Your planning companion</p><h2>Let’s shape your semester.</h2><p>Tell me what you’re studying and what a good week looks like.</p></div><span className="local-badge">Server AI · Live replies</span></div>
    <div className="advisor-layout">
      <section className="panel advisor-chat" aria-label="Advisor conversation">
        <div className="advisor-model"><b>{available ? 'Advisor connected' : 'Advisor unavailable'}</b><button type="button" disabled={Boolean(status)} onClick={() => setConnectionAttempt((attempt) => attempt + 1)}>Reconnect</button></div>
        <p className="advisor-privacy">AI runs on RavenPlanner’s server, and replies appear as they are generated. Your messages and planning context are sent to the server; your saved conversation stays in this browser. No model download is needed on your device.</p>
        <div className="advisor-transcript" ref={transcript} role="log" aria-label="Conversation" aria-live="polite">
          {!session.messages.length && <div className="advisor-welcome"><span className="advisor-avatar" aria-hidden="true">R</span><h3>A timetable, in your own words.</h3><p>Start with your year, program, eligible courses, and preferences. I’ll ask for anything else I need.</p><button type="button" className="advisor-example" onClick={() => setText("I'm a 4th-year CS student. I want Fridays off, I like geology electives, and I hate Professor X.")}>“I’m a 4th-year CS student. I want Fridays off…”</button></div>}
          {session.messages.map((message, index) => <article className={`advisor-message ${message.role}`} key={index}><b>{message.role === 'user' ? 'You' : 'Raven advisor'}</b><p>{message.content}</p></article>)}
          {streaming && <article className="advisor-message assistant" aria-label="Advisor reply in progress" aria-busy="true"><b>Raven advisor</b><p>{streaming}<span className="stream-cursor" aria-hidden="true">▌</span></p></article>}
          {status && <p className="advisor-status" role="status"><span className="pulse" />{status}</p>}
        </div>
        {error && <div className="alert" role="alert">{error}</div>}
        {storageError && <p role="alert">Browser storage is unavailable. Keep this tab open to retain your conversation.</p>}
        <form className="advisor-composer" onSubmit={submit}><label className="sr-only" htmlFor="advisor-message">Message the advisor</label><textarea id="advisor-message" value={text} maxLength={1500} rows={3} placeholder="Plan my schedule, or ask for a change…" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><small>{text.length}/1500 · Enter to send</small>{status ? <button type="button" onClick={stop}>Stop</button> : <button type="submit" disabled={!text.trim() || !available}>Send message</button>}</div></form>
        <div className="advisor-actions"><button type="button" disabled={Boolean(status)} onClick={reset}>New conversation</button></div>
        {trace.length > 0 && <details className="advisor-trace"><summary>Tools used</summary><ol>{trace.map((entry, index) => <li key={index}>{entry}</li>)}</ol></details>}
      </section>
      <aside className="panel advisor-plan" aria-label="Saved planning state"><p className="step-label">Remembered for this term</p><h3>Your planning brief</h3><p>{plan.program || 'Program not provided'}{plan.year ? ` · Year ${plan.year}` : ''}{plan.courseCount ? ` · ${plan.courseCount} courses` : ''}</p><h4>Requirements</h4>{requirements.length ? <ul>{requirements.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No requirements yet.</p>}<h4>Preferences</h4>{preferences.length ? <ul>{preferences.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No preferences yet.</p>}<p className="advisor-note">Requirements are enforced. Preferences rank valid options. Ask to change or remove either at any time.</p><p className="advisor-note">This catalog has no prerequisite or degree-audit data. Provide courses you’re eligible to take; confirm academic requirements with Carleton.</p></aside>
    </div>
    {schedules.length > 0 && !current && <div className="alert" role="status">Previous proposal — it does not satisfy your latest planning request. Your courses remain here for reference.</div>}
    <ScheduleView schedules={schedules} onSelect={(schedule) => persist({ ...session, previousCRNs: schedule.flatMap(scheduleCourses).map(({ crn }) => crn) })} />
  </section>;
}
