# Server advisor UI verification

Captured from the real server-hosted CPU model workflow against RavenPlanner's
synthetic development catalog. WebSocket text deltas were visible before each
reply completed. The student completed all scheduling actions through chat,
then reloaded the page and restored the proposal. No model/GGUF/WASM downloads
occurred in the browser.

- [Desktop: server connection, refined proposal and full weekly calendar](desktop.png)
- [Mobile: restored conversation, saved requirements and scrollable calendar](mobile.png)

The refinement reduced Tuesday meetings from 180 minutes to 90 minutes while
retaining ERTH 1006 and a required Friday off. Meeting choices include linked
tutorials. No browser page errors were observed.

The browser run observed 335 generated text chunks, exercised a second queued
client cancelling independently, and made 216 concurrent API probes with a
48 ms 95th-percentile response time. The separate repeatable benchmark and
its HTTP responsiveness measurements are recorded in
[server-advisor-workflow.json](../../verification/server-advisor-workflow.json).
