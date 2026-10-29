# Browser-local academic advisor prototype

Run `npm ci && npm run dev`, open the printed localhost URL, and select **AI
advisor**. Select **Load model** and leave the tab open during the first model
download. Use a normal browser profile with persistent storage, HTTPS (or
localhost), and enough free memory for a small model. The CPU runtime works
without WebGPU. Cross-origin isolation enables two CPU threads; deployments
without it use one. The manual planner does not download the AI runtime or weights.

SmolLM2 360M is the default; Qwen 2.5 0.5B is an alternative. The isolated CPU
comparison on Chromium 154 / Linux with a two-core quota and two inference
threads produced these results (Q4_K_M quantization, five guarded intent cases):

| Model | Weights | Passed | Median turn | Range |
| --- | --- | --- | --- | --- |
| SmolLM2 360M | 271 MB | 5/5 | 18.7 s | 18.2–40.3 s |
| Qwen 2.5 0.5B | 491 MB | 5/5 | 33.1 s | 22.3–51.5 s |

These include model prefill and generation, excluding course API/scheduler time.
The first profile turn was the slowest for SmolLM2. Loading weights from a local
loopback URL into the browser took 6.3 s for SmolLM2 and 15.6 s for Qwen; internet
download times depend on the connection. This remains a CPU prototype with
noticeable inference latency. Other browsers/devices are not yet verified.
The full three-turn UI workflow took 42.7 s, 51.7 s and 69.0 s per turn with
conversation and current-schedule context. It reduced Tuesday meetings from
180 to 90 minutes, preserved the geology elective and Friday off, restored the
proposal after reload, and recorded zero external AI requests or page errors.
See [desktop/mobile captures](screenshots/local-advisor/README.md) and
[the workflow record](verification/advisor-ui-workflow.json).
The raw decision/latency records are in
[`verification/advisor-model-benchmark.json`](verification/advisor-model-benchmark.json).
An earlier unrestricted prompt failed all five strict intent cases for both
models; its records are retained in
[`verification/advisor-model-benchmark-unrestricted.json`](verification/advisor-model-benchmark-unrestricted.json).

Try this conversation against the explicitly synthetic development catalog:

1. “I'm a 4th-year CS student. Plan my schedule. I want Fridays off, I like
   geology electives, and I hate Professor X.”
2. Answer the eligibility question: “I am eligible for COMP 1405, MATH 1007 and
   ERTH 1006. Take these three courses.” These are demo choices, not a suggested
   fourth-year curriculum.
3. “Make my Tuesdays lighter, but keep my geology elective.”
4. “Fridays are allowed now.” Or: “Never schedule Professor X.”

The calendar shows the best options found. The planning brief distinguishes
requirements and preferences. “Fridays off” excludes Friday meetings, including
linked tutorials. “Prefer Fridays off” ranks options. Instructor dislikes are
preferences; “never” makes an exclusion mandatory. “Keep” pins a course code
while allowing its section to change. Ask to release a pinned course before
removing it. Existing courses are never implicitly dropped to satisfy a count.

Chat, structured constraints and selected CRNs are stored in localStorage,
separately for each term/year. Model files use the runtime's browser cache.
Reloading rechecks sections with the API before displaying a saved proposal.
Changing modes or terms cancels pending work; **Stop** also cancels a turn.
**New conversation** clears the active term's chat and plan; **Clear downloaded
models** removes cached weights. Browser storage eviction/private mode can
prevent persistence; quota failures are shown as recoverable load errors.

## Architecture

`src/advisor/model.ts` runs quantized GGUF models in wllama/llama.cpp WASM workers
with `n_gpu_layers: 0`. Pinned Hugging Face revisions make downloads repeatable.
The runtime and WASM ship in the client bundle; there is no AI backend endpoint,
API key, external inference call, or remote chat transport. Downloads are network
requests for weights, not inference. Course data still comes from RavenPlanner.

The controller gives the model a context-specific grammar for three typed tools:

| Tool | Behavior |
| --- | --- |
| `search` | Search the selected term's catalog by code, name, subject or instructor; feed results back to the model |
| `plan` | Apply an additive validated patch, retrieve real sections, ask for missing course/count information, then generate a timetable |
| `clarify` | Ask a grounded controller-written question, with retrieved catalog matches when available |

The controller bounds each turn to four model/tool steps and three minutes,
retries one malformed model response, validates every argument, and commits only
completed turns. Course codes must come from student messages or retrieved
catalog results. Model-generated schedules, CRNs, arbitrary URLs, code execution
and academic requirements are not accepted. Final schedule summaries and failure
explanations are constructed from tool output. An expandable tool trace shows
what happened locally.

A small local hint layer narrows tool/field choices for recognizable requests
and anchors literal course codes, study years, counts, weekdays and unambiguous
references such as “keep my geology elective.” It does not ask a language model
to regenerate known identifiers or numeric facts. Free-form intent and values
outside those anchors are interpreted by the local model. This hybrid approach
is deliberate: the unrestricted small-model baseline copied example values and
missed constraints. The integrated benchmark measures the model **with** these
guards, rather than claiming the raw model can reliably call arbitrary tools.

Scheduling reuses `src/scheduler.ts`, including term-specific section groups,
date/time conflict checks and required linked tutorials/labs. The AI adapter
filters closed sections, unverified meeting information, excluded instructors
and hard day/time constraints. It ranks preferred days, instructors, time windows
and minutes on lighter days, using the current section choices to break ties.
Paging the calendar updates the current proposal supplied to subsequent turns.
A separate scheduling worker keeps the interface responsive. Search retains the
best ten results among at most 50,000 candidate visits and discloses truncation.
An impossible change keeps the old calendar visibly marked as a previous
proposal, while retaining the newly requested constraints.

## Academic and catalog limits

This is a timetable advisor, not a degree audit. The existing catalog has **no
prerequisite, transcript, completed-course, program-requirement or graduation-rule
data**. The advisor asks for eligible course codes instead of inventing rules
from a student's program/year. No registration is performed. Its guarantees are
limited to the supplied meeting and section data; the existing scraper retains
only the last meeting row for each section. Check Carleton Central before
registering. Catalog refreshes can change availability after a proposal.

The current section grouping supports a lecture with one linked tutorial/lab
choice. A section requiring linked components that are missing or explicitly
conjunctive is excluded from AI proposals and explained. Only explicitly
`Online Unscheduled` courses can omit meeting times. Unverifiable/TBA and weekend
meetings, or meetings outside the existing 07:00–22:00 calendar, are excluded.
AI mode supports up to eight courses and eight names in each instructor list.
If no valid option is found, it does not silently soften constraints or claim
that a truncated search proved impossibility.

Small local models can still misunderstand a request. Inspect the visible brief
and ask for corrections; validated syntax is not a guarantee of correct intent.
The prototype deliberately avoids a vector database, external agent framework,
model server, and separate scheduling implementation.

## Verification and model comparison

```bash
npm run validate
npm run test:e2e
```

The normal checks cover scheduling, tool validation, multi-turn conversations,
missing/unavailable courses, impossible constraints, persistence, model errors,
mode separation, and the existing planner/API/scraper flows. They do not download
model weights. The fast conversation tests inject decisions so they can exercise
controller failures deterministically; they are separate from the real-inference
checks below.

Download the two candidates once for benchmarking (about 762 MB total):

```bash
mkdir -p .local/models
curl --fail --location 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf' --output .local/models/qwen.gguf
curl --fail --location 'https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/7be6f65f1db715fe5dc5a4634c0d459b4eed42ec/SmolLM2-360M-Instruct-Q4_K_M.gguf' --output .local/models/smol.gguf
npm run dev
```

In another terminal:

```bash
npm run benchmark:advisor
RAVEN_AI_E2E=1 npm run test:e2e -- --grep 'real local model'
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` if using a system
Chromium instead of Playwright's browser download. The benchmark accepts
`--base-url=http://127.0.0.1:5173` and uses a persistent profile under `.local`.
It loads real GGUF weights, runs five CPU intent/tool cases for both candidates,
prints each decision and latency, and writes
`docs/verification/advisor-model-benchmark.json`. The real-model E2E uses an
ephemeral seeded API, loads the same weights from local disk, and drives the UI
through the full conversation, refinement, reload and mobile layout. It checks
that no external AI requests occur after model loading (the application's existing
Google Fonts requests are excluded). Screenshots and traces
are written under ignored `test-results`.

Weights, caches, browser profiles and generated build output are excluded from
Git. Model latency and correctness must be evaluated on the intended student
devices; a five-case sample does not establish broad language understanding.
