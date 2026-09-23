# Coke Codes UI Automation

End-to-end Playwright test suite for the Coke Codes admin portal (Programs,
Releases/Lots/Batches, Promotions, Real Time Test, Validate, Closure Matrix,
Organizations, Campaigns, Download Codes/Public Key, Queued Requests, Login/Logout),
plus a custom dashboard report generated on top of Playwright's own reporter.

---

## 1. Folder structure

```
coke-codes-ui-automation/
├── package.json
├── playwright.config.js
├── pages/                        # Page Object Model - one file per feature/page
│   ├── LoginPage.js
│   ├── NavigationBar.js
│   ├── ProgramsPage.js
│   ├── CreateProgramModal.js
│   ├── ProgramDetailPage.js      # Release / Lot / Batch actions live here
│   ├── PromotionsPage.js
│   ├── RealTimeTestPage.js
│   ├── ValidatePage.js
│   ├── ClosureMatrixPage.js
│   ├── OrganizationsPage.js
│   ├── CampaignsPage.js
│   ├── DownloadCodesPage.js
│   └── QueuedRequestsPage.js
├── scripts/
│   └── generate-report.js        # builds the custom dashboard HTML report
├── tests/
│   ├── create-program.spec.js    # focused Create Program flow (happy path + cancel)
│   └── full-flow.spec.js         # full portal walkthrough, positive + negative cases
└── test-results/                 # auto-created on first run - do not commit
    ├── results.json              # Playwright's own JSON reporter output
    ├── history.json              # rolling last-8-runs stability data
    └── dashboard-report.html     # the fancy custom report
```

---

## 2. First-time setup

```bash
# 1. clone / create the project folder and cd into it
mkdir coke-codes-ui-automation && cd coke-codes-ui-automation

# 2. place all files from this project into the structure above

# 3. install dependencies
npm install

# 4. download the browser binaries Playwright needs
npx playwright install
```

### Set test credentials
The login test reads credentials from environment variables rather than
hardcoding them in the spec:

```bash
export TEST_USER_EMAIL="your-test-account@example.com"
export TEST_USER_PASSWORD="your-test-password"
export TEST_VALID_CODE="A_REAL_UNUSED_CODE"   # used by the "valid code" Validate test
```
(Or put these in a `.env` file with a loader like `dotenv` if you'd rather not
export them every session — not wired in by default to keep the sample dependency-free.)

---

## 3. Get real selectors before running against the live app

Several selectors in the page objects are marked `// VERIFY:` or `// adjust` —
they're best guesses (some reconstructed from photos, some placeholders).
Record real ones by clicking through the app once instead of guessing:

```bash
npm run codegen
```
This opens a real browser; every click/fill/check you do is turned into code.
Copy the real locators into the matching `pages/*.js` file, especially:
- the risk gauge selector and the "per" redemption-rules input (`CreateProgramModal.js`)
- the accordion expand toggle (`ProgramDetailPage.js`)
- every validation-error selector (`[role="alert"], .error-message, .Mui-error` placeholders)
  used by the negative tests — these need to match your app's real error markup

---

## 4. Running tests

```bash
# run everything in tests/
npx playwright test

# run one spec file
npx playwright test tests/create-program.spec.js
npx playwright test tests/full-flow.spec.js

# run only positive (happy-path) tests
npx playwright test --grep-invert @negative

# run only negative (error/validation) tests
npx playwright test --grep @negative

# watch it run in a visible browser instead of headless
npx playwright test --headed

# run one test by name
npx playwright test -g "create a new program"
```

Or via the npm scripts already set up in `package.json`:

```bash
npm test                  # same as npx playwright test
npm run test:headed       # headed mode
npm run codegen           # opens the recorder
```

---

## 5. Reports

Two reports come out of every run:

### a) Playwright's built-in HTML report
```bash
npm run report             # opens playwright-report/index.html
```
Shows pass/fail, `test.step()` breakdown per test, and — because
`trace: 'on'` is set in `playwright.config.js` — a full trace (screenshots,
DOM snapshots, network calls) for every run, openable from the report or via
`npx playwright show-trace <trace.zip>`.

### b) Custom dashboard report
```bash
npm run report:dashboard   # writes test-results/dashboard-report.html
# or do both steps in one go:
npm run test:all           # runs tests, then builds the dashboard
```

The dashboard (`scripts/generate-report.js`, no extra npm packages needed)
reads Playwright's `test-results/results.json` and renders:

- **KPI summary** — total / passed / failed / skipped / pass rate / duration
- **Positive vs Negative coverage** — a pass-rate bar for happy-path tests vs.
  error/validation tests, read automatically from each test's Playwright tag
  (`{ tag: '@positive' }` / `{ tag: '@negative' }` — untagged tests default to positive)
- **Coverage by functionality** — a bar per feature area, grouped by each
  spec's outermost `test.describe()` title (e.g. `Create Program`,
  `Release, Lots & Batches`, `Validate`, `Organizations`...)
- **Stability tracker** — last 8 runs per test (stored in `test-results/history.json`,
  maintained automatically), flagging tests as "flaky" or "consistently failing"
- **Detailed results** — expandable per-test view with every `test.step()`,
  timing, and the full error message on failure

Open `test-results/dashboard-report.html` directly in a browser to view it.

---

## 6. How tests are organized (positive vs. negative)

Every test is tagged so the dashboard can group them automatically:

```js
test('create a new program with market, character set, and whitelist',
  { tag: '@positive' }, async ({ page }) => { ... });

test('rejects saving with no program name',
  { tag: '@negative' }, async ({ page }) => { ... });
```

When adding new tests:
- Group related tests under one outer `test.describe('Feature Name', ...)` —
  that title becomes the "functional area" in the dashboard.
- Tag each test `@positive` (happy path) or `@negative` (invalid input,
  missing required field, duplicate name, wrong credentials, etc.).
- For negative tests, prefer adding a small `attempt...()` /
  `...AndGetValidationError()` helper to the relevant page object (see
  `CreateProgramModal.saveAndGetValidationError()`, `PromotionsPage.attemptCreateWithNoName()`,
  `OrganizationsPage.attemptCreateDuplicate()` for examples) rather than
  inlining error-locator logic in the spec.

---

## 7. Handling popups
For any popup/new-tab flows:
```js
const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.getByRole('link', { name: 'Open in new tab' }).click(),
]);
await popup.waitForLoadState();
```

## 8. Scaling further
Add one page object per new page/component, one `test.describe()` per
feature with both a `@positive` and at least one `@negative` test, and the
dashboard report picks everything up with zero configuration changes.
