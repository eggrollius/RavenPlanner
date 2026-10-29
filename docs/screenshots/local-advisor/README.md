# Local advisor UI verification

Captured from the real CPU-model browser workflow against RavenPlanner's
synthetic development catalog. The student completed all scheduling actions
through chat, then reloaded the page and restored the proposal.

- [Desktop: model loaded, refined proposal and full weekly calendar](desktop.png)
- [Mobile: restored conversation, saved requirements and scrollable calendar](mobile.png)

The refinement reduced Tuesday meetings from 180 minutes to 90 minutes while
retaining ERTH 1006 and a required Friday off. Meeting choices include linked
tutorials. No external AI requests or browser page errors were observed.

The real model took 42.7 s, 51.7 s and 69.0 s for the three conversation turns on
the two-core verification environment. These end-to-end timings include the
larger conversation/current-schedule context, API reads and scheduling, and
are higher than the isolated intent benchmark.
