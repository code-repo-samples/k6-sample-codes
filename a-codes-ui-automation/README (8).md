# Coke Codes UI Automation

Playwright test suite for the Coke Codes admin portal. Every stage (Login,
Create Program, Release, Lot, Batch, Promotion, Campaign, Organizations,
Real Time Test, Validate, Closure Matrix, Download Codes, GPG Upload) is
independently runnable via a tag, or you can run any combination of them
together — login always happens automatically first, no matter what you pick.

---

## 1. Folder structure

```
coke-codes-ui-automation/
├── .env.example                  # copy to .env - never commit the real .env
├── .gitignore
├── package.json
├── package-lock.json
├── playwright.config.js          # loads .env via dotenv
├── test-data/
│   ├── test-config.json          # organization ID, promotion, program/release/lot/batch/GPG defaults,
│   │                              # + "existingIds" overrides to point a stage at real existing data
│   └── fixtures/
│       └── sample-public-key.asc # placeholder file for the GPG upload test - replace with a real key
├── utils/
│   └── generatedCodesStore.js    # records generated campaign codes to test-results/generated-codes.json
├── flows/                        # reusable orchestration functions - ONE place per stage's logic
│   ├── loginFlow.js               # login(page) - always run, not tag-filterable
│   ├── programFlow.js             # ensureProgram(), editProgram()
│   ├── promotionFlow.js           # ensurePromotion() - self-heals: creates a program first if needed
│   ├── releaseFlow.js             # ensureRelease(), editRelease() - self-heals a program if needed
│   ├── lotFlow.js                 # ensureLot(), editLot() - self-heals a release if needed
│   ├── batchFlow.js               # ensureBatch() - self-heals a lot + promotion, triggers/polls codegen
│   ├── campaignFlow.js            # ensureCampaign(), editCampaign() - self-heals a program, captures code
│   ├── organizationFlow.js        # createOrganization() - fully independent
│   ├── realTimeTestFlow.js        # openRealTimeTest() - fully independent
│   ├── validateFlow.js            # validateLatestCode() - reads generated-codes.json or .env fallback
│   ├── closureMatrixFlow.js       # createClosureList() - fully independent
│   ├── downloadCodesFlow.js       # downloadCodes() - fully independent
│   └── gpgUploadFlow.js           # uploadPublicKey() - fully independent
├── pages/                        # Page Object Model - one file per feature/page (used BY the flows above)
│   ├── LoginPage.js               # SSO/IAP flow, reads LOGIN_USERNAME/LOGIN_PASSWORD from env
│   ├── NavigationBar.js
│   ├── ProgramsPage.js            # includes getProgramIdByName()
│   ├── CreateProgramModal.js      # includes fillFromConfig()
│   ├── ProgramDetailPage.js       # program edit + release/lot create-edit-expand, returns generated IDs
│   ├── BatchPage.js               # batch creation (org/promotion from config) + codegen trigger/poll
│   ├── PromotionsPage.js          # includes createPromotionForProgram()
│   ├── CampaignsPage.js           # create/edit + getViralCode()
│   ├── GpgUploadPage.js           # public key upload: file + date range + submit
│   ├── OrganizationsPage.js
│   ├── ValidatePage.js
│   ├── ClosureMatrixPage.js
│   ├── RealTimeTestPage.js
│   ├── QueuedRequestsPage.js
│   └── DownloadCodesPage.js
├── scripts/
│   └── generate-report.js        # builds the custom dashboard HTML report - reads test-results/results.json,
│                                  # writes test-results/dashboard-report.html. Nothing to reconfigure when
│                                  # adding new stages - it reads whatever ran, automatically.
├── tests/
│   ├── all-flows.spec.js         # THE main file - every stage as its own tagged test, run any combo
│   └── negative-cases.spec.js    # independent negative/error-path tests (Login, Program, Release, Promotions)
├── archived-specs/                # OLD files, superseded by all-flows.spec.js - kept for reference only,
│                                  # NOT run by Playwright (outside testDir) - see its own README
└── test-results/                 # auto-created on first run - do not commit
    ├── results.json              # Playwright's JSON reporter output
    ├── history.json              # rolling last-8-runs stability data
    ├── generated-codes.json      # every campaign code generated, read back by @validate
    └── dashboard-report.html     # the custom dashboard report
```

---

## 2. Running any single stage, or any combination

This is the main thing this structure gives you. `tests/all-flows.spec.js`
has one tagged test per stage. Login always runs first automatically
(it's in `test.beforeAll`, not a filterable test) — you only ever choose
which stage(s) come *after* login.

### Run just one thing
```bash
npm run test:flow:organization   # just Organizations
npm run test:flow:realtime       # just Real Time Test
npm run test:flow:validate       # just Validate
npm run test:flow:program        # just Create Program
npm run test:flow:closurematrix  # just Closure Matrix
npm run test:flow:download       # just Download Codes
npm run test:flow:gpg            # just GPG Upload
```

### Run a custom combination
```bash
npm run test:flow -- "@program|@release"    # Program then Release
npm run test:flow -- "@program|@campaign"   # Program then Campaign (skips Release/Lot/Batch)
npm run test:flow -- "@release|@lot|@batch" # just the Release→Lot→Batch chain
```
(the `--` passes your tag expression through to `--grep`; `|` means OR)

### Run everything
```bash
npm run test:flow:all      # every stage, in order
```

### Available tags
`@program` `@editprogram` `@promotion` `@release` `@editrelease` `@lot`
`@editlot` `@batch` `@campaign` `@editcampaign` `@organization` `@realtime`
`@validate` `@closurematrix` `@download` `@gpg`

### Why picking a "later" stage still works on its own
Say you run `--grep "@campaign"` without ever running `@program`. The
campaign flow needs a program to attach to, so it checks: is there already
one from earlier in *this* run? No. Is one pinned in
`test-data/test-config.json` under `existingIds`? If you've filled that in,
it uses that. Otherwise, it creates a fresh program itself, then proceeds.
Same pattern for Release→Lot→Batch and Promotion. You never get a crash from
a missing prerequisite — worst case, it just creates more than you asked for.

To avoid that "more than you asked for" behavior (e.g. you want to test
Campaign against a program you already know exists, not a brand new one),
fill in `test-data/test-config.json`:
```json
{
  "existingIds": {
    "programId": "abc-123",
    "programName": "MyExistingProgram"
  }
}
```

---

## 3. First-time setup

```bash
mkdir coke-codes-ui-automation && cd coke-codes-ui-automation
# place all project files into the structure above

npm install
npx playwright install
```

### Configure credentials (.env)
```bash
cp .env.example .env
```
Then edit `.env`:
```
BASE_URL=https://ui-gcp.alpha.codes.coke.com
LOGIN_USERNAME=your-test-account@example.com
LOGIN_PASSWORD=your-test-password
TEST_VALID_CODE=REPLACE_WITH_REAL_UNUSED_CODE
```
`.env` is gitignored — real credentials never get committed. `playwright.config.js`
loads it via `dotenv`, and `flows/loginFlow.js` reads `LOGIN_USERNAME`/`LOGIN_PASSWORD`.

### Configure test parameters (test-data/test-config.json)
Organization ID, promotion, program/release/lot/batch/campaign/GPG defaults,
and the `existingIds` overrides described above all live here — change
values without touching any code.

---

## 4. Get real selectors before running against the live app

Almost every page object has `// VERIFY:` comments marking guessed selectors
— labels, dropdown names, row/column layout, the code-gen status text, the
container attributes used to scope Lot/Batch panels. Record the real ones:
```bash
npm run codegen
```
Click through the actual Create Batch, Campaign, and GPG Upload screens
especially — the organization/promotion dropdown labels, the "viral code"
display element, and the file-upload/date-picker selectors are the most
likely to need correcting.

---

## 5. Negative tests

```bash
npm run test:negative
```
`negative-cases.spec.js` is separate from `all-flows.spec.js` on purpose —
each test tries something invalid (blank name, bad date range, wrong
password) and confirms the app rejects it, using its own fresh page per test
so a failure in one can't cascade into others.

---

## 6. Reports

```bash
npm run report              # Playwright's built-in HTML report + trace viewer
npm run report:dashboard    # writes test-results/dashboard-report.html
npm run test:all            # runs the full default suite, then builds the dashboard
```
`scripts/generate-report.js` reads whichever tests actually ran from
`test-results/results.json` — nothing to reconfigure when you run a
different combination of tags. It groups "Coverage by Functionality" by
each test's `test.describe()` (Create Program, Create Release, Organizations,
etc.), so even a `--grep "@organization"` run still produces a clean,
correctly-labeled report for just that one stage.

---

## 7. Where the generated code goes

The Campaign stage (`flows/campaignFlow.js`) captures the generated ("viral")
code and:
1. Prints it to the console: `[flow:campaign] created campaign ... code=...`
2. Appends it to `test-results/generated-codes.json`
3. Attaches it to that test's entry in Playwright's HTML report

`@validate` automatically reads the most recent entry from that file. Since
code generation can take 5–10 minutes after a batch completes, run `@validate`
a few minutes after `@batch`/`@campaign`, not immediately after — it falls
back to `TEST_VALID_CODE` from `.env` if no generated code is available yet.

---

## 8. Extending with a new stage

1. Add a page object (or extend an existing one) with the methods needed.
2. Add a new `flows/yourStageFlow.js` exporting an `ensureX()`/`doX()`
   function that reads/writes the shared `journey` object as needed —
   self-heal any prerequisite by calling that prerequisite's own flow
   function first (see `campaignFlow.js` calling `ensureProgram()` as a model).
3. Add one `test.describe(...)` block with one tagged `test(...)` to
   `tests/all-flows.spec.js`.
4. Add an npm script shortcut if it's a combo you'll run often.
5. If it needs its own parameter, add it to `test-data/test-config.json`.
6. Add a matching negative case to `negative-cases.spec.js` if relevant.

---

## 9. `archived-specs/`

Earlier iterations of this suite (`e2e-program-journey.spec.js`,
`other-pages.spec.js`, `login-and-program.spec.js`,
`login-and-realtime-check.spec.js`, `create-program.spec.js`) are kept there
for reference. They're outside `testDir`, so Playwright never runs them —
everything they did is now covered, more flexibly, by `all-flows.spec.js`.
See `archived-specs/README.md` for the mapping. Safe to delete that whole
folder once you're comfortable with the new structure.
