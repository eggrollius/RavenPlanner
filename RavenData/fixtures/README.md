# Legacy parity fixtures

`legacy-cases.json` was generated before removing the Python implementation from
`RavenData/scrape.py` at commit `98b2249`. Each case was executed with that file's
original BeautifulSoup parsing loop and missing-key default loop, using its pinned
BeautifulSoup 4.12.3. Expected results were serialized directly from Python.

The recorded `example.html` and constructed cases cover text-node whitespace,
HTML entities, subject order, last-meeting replacement, linked registration
sections (including literal spaces and nested anchors), ignored section info,
unknown rows, separators, and unterminated records. Keep these expectations fixed
when changing the TypeScript parser. The parity test explicitly supplies the
legacy `SUMMER` / `2025` configuration to preserve these original expectations;
the current default catalog is Fall 2026. Python is not required to run the tests.

`public-results.html` is the ACCS Fall 2026 result-table fragment retrieved from
Carleton's public timetable on October 29, 2026. Link query strings were removed
to exclude the temporary timetable session ID. It covers the public 11-column
layout and meetings that omit building and room assignments.
