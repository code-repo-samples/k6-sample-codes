# Archived spec files

These are superseded by `tests/all-flows.spec.js`, which covers everything
in these files plus lets you run any single stage or combination via
`--grep` tags, using shared `flows/*.js` functions instead of duplicating
logic per file.

Kept here for reference only — **not run** by Playwright, since this folder
is outside `testDir` (`./tests`) in `playwright.config.js`.

| Archived file | Now covered by |
|---|---|
| `e2e-program-journey.spec.js` | `tests/all-flows.spec.js` (all tags, run together or in any combo) |
| `other-pages.spec.js` | `tests/all-flows.spec.js` (`@organization`, `@realtime`, `@validate`, `@closurematrix`, `@download`, `@gpg`) |
| `login-and-program.spec.js` | `npm run test:flow:program` |
| `login-and-realtime-check.spec.js` | `npm run test:flow:realtime` / `test:flow:validate` |
| `create-program.spec.js` | `npm run test:flow:program` |

Safe to delete this folder entirely once you're comfortable with the new
tag-based structure.
