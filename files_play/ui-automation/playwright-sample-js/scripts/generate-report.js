#!/usr/bin/env node
/**
 * generate-report.js
 * ---------------------------------------------------------------
 * Reads Playwright's JSON reporter output (test-results/results.json)
 * and renders a dashboard-style HTML report:
 *   - KPI summary (total / passed / failed / skipped / pass rate / duration)
 *   - Coverage-by-functionality bars (grouped by top-level `test.describe` name)
 *   - Stability tracker across the last N runs (reads/writes history.json)
 *   - Detailed, expandable per-test results with steps + error text
 *
 * No extra npm packages needed - just Node's built-in fs/path.
 *
 * Usage:
 *   node scripts/generate-report.js
 *   (run this after `npx playwright test`, since it needs
 *    test-results/results.json to already exist)
 *
 * Requires playwright.config.js to include the json reporter, e.g.:
 *   reporter: [ ['list'], ['html'], ['json', { outputFile: 'test-results/results.json' }] ]
 *
 * Grouping tests into "functional areas":
 *   The script uses the OUTERMOST test.describe() title as the area name.
 *   So in your spec files, wrap related tests like:
 *     test.describe('Risk Calculator', () => { ... });
 *     test.describe('Release Accordion', () => { ... });
 *   Tests with no describe wrapper fall under "General".
 */

const fs = require('fs');
const path = require('path');

const RESULTS_JSON = path.join(process.cwd(), 'test-results', 'results.json');
const HISTORY_JSON = path.join(process.cwd(), 'test-results', 'history.json');
const OUTPUT_HTML = path.join(process.cwd(), 'test-results', 'dashboard-report.html');
const MAX_HISTORY_RUNS = 8;

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------
// 1. Walk the Playwright JSON suite tree and flatten into test records
// ---------------------------------------------------------------
function flattenTests(rawResults) {
  const tests = [];

  function walkSuite(suite, areaStack) {
    // A suite with `specs` is a leaf group (describe block or file root)
    const nextAreaStack = suite.title ? [...areaStack, suite.title] : areaStack;

    (suite.specs || []).forEach((spec) => {
      spec.tests.forEach((test) => {
        const lastResult = test.results[test.results.length - 1] || {};
        const allResults = test.results || [];

        tests.push({
          // outermost describe title = functional area; fall back to "General"
          area: nextAreaStack[0] || 'General',
          fullTitlePath: [...nextAreaStack, spec.title].join(' > '),
          title: spec.title,
          status: lastResult.status || 'skipped', // passed | failed | timedOut | skipped
          duration: allResults.reduce((sum, r) => sum + (r.duration || 0), 0),
          steps: flattenSteps(lastResult.steps || []),
          error: lastResult.error ? lastResult.error.message : null,
          attachments: (lastResult.attachments || []).map((a) => a.name),
          retries: allResults.length - 1,
          type: getTestType(test, spec.title),
        });
      });
    });

    (suite.suites || []).forEach((child) => walkSuite(child, nextAreaStack));
  }

  (rawResults.suites || []).forEach((fileSuite) => walkSuite(fileSuite, []));
  return tests;
}

// Classify a test as 'positive' or 'negative' using its Playwright tag,
// e.g. test('title', { tag: '@negative' }, async () => {...}).
// Falls back to scanning the title for "@negative"/"@positive" in case
// the JSON reporter version in use doesn't expose test.tags directly,
// and defaults to 'positive' if nothing is found (untagged = happy path).
function getTestType(test, title) {
  const tags = test.tags || [];
  if (tags.includes('@negative') || /@negative\b/.test(title)) return 'negative';
  if (tags.includes('@positive') || /@positive\b/.test(title)) return 'positive';
  return 'positive';
}

// Playwright nests step objects; flatten to a simple list with pass/fail
function flattenSteps(steps, acc = []) {
  steps.forEach((step) => {
    // skip Playwright's internal "expect" / "pw:api" noise, keep test.step() entries
    if (step.category === 'test.step') {
      acc.push({
        title: step.title,
        duration: step.duration,
        status: step.error ? 'failed' : 'passed',
      });
    }
    if (step.steps && step.steps.length) flattenSteps(step.steps, acc);
  });
  return acc;
}

// ---------------------------------------------------------------
// 2. Roll tests up into functional-area pass/fail counts
// ---------------------------------------------------------------
function buildAreaSummary(tests) {
  const areas = {};
  tests.forEach((t) => {
    if (!areas[t.area]) areas[t.area] = { passed: 0, failed: 0, total: 0 };
    areas[t.area].total += 1;
    if (t.status === 'passed') areas[t.area].passed += 1;
    else if (t.status !== 'skipped') areas[t.area].failed += 1;
  });
  return areas;
}

// ---------------------------------------------------------------
// 2b. Roll tests up into positive/negative pass-fail counts
// ---------------------------------------------------------------
function buildTypeSummary(tests) {
  const summary = {
    positive: { passed: 0, failed: 0, total: 0 },
    negative: { passed: 0, failed: 0, total: 0 },
  };
  tests.forEach((t) => {
    const bucket = summary[t.type] || summary.positive;
    bucket.total += 1;
    if (t.status === 'passed') bucket.passed += 1;
    else if (t.status !== 'skipped') bucket.failed += 1;
  });
  return summary;
}

// ---------------------------------------------------------------
// 3. Stability history — append this run, keep last N
// ---------------------------------------------------------------
function updateHistory(tests) {
  const history = loadJson(HISTORY_JSON, []);
  const runEntry = {
    timestamp: new Date().toISOString(),
    results: Object.fromEntries(tests.map((t) => [t.fullTitlePath, t.status])),
  };
  history.push(runEntry);
  const trimmed = history.slice(-MAX_HISTORY_RUNS);
  fs.writeFileSync(HISTORY_JSON, JSON.stringify(trimmed, null, 2));
  return trimmed;
}

function buildStabilityRows(tests, history) {
  return tests.map((t) => {
    const dots = history.map((run) => run.results[t.fullTitlePath] || 'skip');
    const failCount = dots.filter((d) => d === 'failed' || d === 'timedOut').length;
    let verdict = 'stable';
    if (failCount === dots.length && dots.length > 1) verdict = 'consistently failing';
    else if (failCount > 0) verdict = 'flaky';
    return { title: t.title, dots, verdict };
  });
}

// ---------------------------------------------------------------
// 4. Render HTML
// ---------------------------------------------------------------
function esc(str = '') {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderTypeSummary(typeSummary) {
  const rowFor = (label, s, colorVar) => {
    const passPct = s.total ? Math.round((s.passed / s.total) * 100) : 0;
    return `
      <div class="type-card">
        <div class="type-head">
          <span class="type-label" style="color:${colorVar}">${label}</span>
          <span class="type-count">${s.passed}/${s.total} passed</span>
        </div>
        <div class="bar-track">
          <div class="bar-pass" style="width:${passPct}%"></div>
          <div class="bar-fail" style="width:${100 - passPct}%"></div>
        </div>
      </div>`;
  };
  return `
    <div class="type-row">
      ${rowFor('✓ Positive (happy-path)', typeSummary.positive, 'var(--green)')}
      ${rowFor('✕ Negative (error / validation)', typeSummary.negative, 'var(--red)')}
    </div>`;
}

function renderAreaBars(areaSummary) {
  return Object.entries(areaSummary)
    .map(([name, s]) => {
      const passPct = s.total ? Math.round((s.passed / s.total) * 100) : 0;
      const failPct = 100 - passPct;
      return `
        <div class="area-row">
          <div class="top-line"><span class="name">${esc(name)}</span><span class="count">${s.passed}/${s.total}</span></div>
          <div class="bar-track">
            <div class="bar-pass" style="width:${passPct}%"></div>
            <div class="bar-fail" style="width:${failPct}%"></div>
          </div>
        </div>`;
    })
    .join('\n');
}

function renderStabilityRows(rows) {
  const colorFor = { stable: 'var(--green)', flaky: 'var(--amber)', 'consistently failing': 'var(--red)' };
  return rows
    .map(
      (r) => `
      <div class="history-row">
        <span class="name">${esc(r.title)}</span>
        <div class="history-dots">
          ${r.dots.map((d) => `<i class="${d === 'passed' ? 'p' : d === 'skip' ? 's' : 'f'}"></i>`).join('')}
        </div>
        <span class="duration" style="color:${colorFor[r.verdict]}">${r.verdict === 'stable' ? 'stable' : '⚠ ' + r.verdict}</span>
      </div>`
    )
    .join('\n');
}

function renderTestDetails(tests) {
  return tests
    .map((t) => {
      const badgeClass = t.status === 'passed' ? 'pass' : 'fail';
      const stepsHtml = t.steps
        .map(
          (s) => `
        <div class="step">
          <span class="dot ${s.status}"></span>
          <span class="step-name">${esc(s.title)}</span>
          <span class="step-time">${(s.duration / 1000).toFixed(1)}s</span>
        </div>`
        )
        .join('\n');

      const typeClass = t.type === 'negative' ? 'tag-negative' : 'tag-positive';
      const typeLabel = t.type === 'negative' ? 'Negative' : 'Positive';

      return `
      <div class="test ${badgeClass === 'fail' ? 'open' : ''}" onclick="this.classList.toggle('open')">
        <div class="test-header">
          <div class="test-title">
            <span class="chevron">▶</span>
            <span class="tag">${esc(t.area)}</span>
            <span class="tag ${typeClass}">${typeLabel}</span>
            <span class="badge ${badgeClass}">${badgeClass === 'pass' ? 'Passed' : 'Failed'}</span>
            <span>${esc(t.title)}</span>
          </div>
          <span class="duration">${(t.duration / 1000).toFixed(1)}s</span>
        </div>
        <div class="steps">
          ${stepsHtml}
          ${t.error ? `<div class="error-box">${esc(t.error)}</div>` : ''}
        </div>
      </div>`;
    })
    .join('\n');
}

function renderHtml({ kpi, areaSummary, typeSummary, stabilityRows, tests }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>UI Automation Report</title>
<style>
  :root{--bg:#0e1014;--panel:#171a21;--panel2:#1e222b;--border:#2a2f3a;--text:#e6e8ec;--muted:#8b93a3;--green:#2ecc71;--red:#e74c3c;--amber:#f2b134;--accent:#4da3ff;}
  *{box-sizing:border-box;}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);}
  header{background:linear-gradient(135deg,#161a22,#1c2130);border-bottom:1px solid var(--border);padding:24px 32px;}
  header h1{margin:0;font-size:20px;}
  header .meta{color:var(--muted);font-size:13px;margin-top:6px;}
  main{padding:28px 32px 60px;max-width:1280px;margin:0 auto;}
  section{margin-bottom:34px;}
  section > h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 14px;}
  .kpi-row{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;}
  .kpi{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;}
  .kpi .num{font-size:28px;font-weight:800;}
  .kpi .label{font-size:11.5px;color:var(--muted);text-transform:uppercase;margin-top:6px;}
  .kpi.pass .num{color:var(--green);} .kpi.fail .num{color:var(--red);} .kpi.skip .num{color:var(--amber);} .kpi.rate .num{color:var(--accent);}
  .area-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px 22px;}
  .area-row{margin-bottom:14px;}
  .top-line{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;}
  .top-line .name{font-weight:600;} .top-line .count{color:var(--muted);}
  .bar-track{height:9px;border-radius:5px;background:var(--panel2);overflow:hidden;display:flex;}
  .bar-pass{background:var(--green);height:100%;} .bar-fail{background:var(--red);height:100%;}
  .history-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px 22px;}
  .history-row{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
  .history-row .name{width:300px;font-size:13px;flex-shrink:0;}
  .history-dots{display:flex;gap:4px;}
  .history-dots i{width:14px;height:14px;border-radius:3px;display:inline-block;}
  .history-dots i.p{background:var(--green);} .history-dots i.f{background:var(--red);} .history-dots i.s{background:var(--panel2);border:1px solid var(--border);}
  .test{background:var(--panel);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden;}
  .test-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;}
  .test-title{display:flex;align-items:center;gap:10px;font-size:14px;}
  .tag{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:5px;background:var(--panel2);color:var(--accent);border:1px solid var(--border);}
  .tag-positive{color:var(--green);}
  .tag-negative{color:var(--red);}
  .type-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .type-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 20px;}
  .type-head{display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;}
  .type-label{font-weight:700;}
  .type-count{color:var(--muted);}
  .badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;}
  .badge.pass{background:rgba(46,204,113,.15);color:var(--green);} .badge.fail{background:rgba(231,76,60,.15);color:var(--red);}
  .duration{color:var(--muted);font-size:12px;}
  .steps{border-top:1px solid var(--border);padding:6px 18px 14px;display:none;}
  .test.open .steps{display:block;} .test.open .chevron{transform:rotate(90deg);}
  .chevron{transition:transform .15s;color:var(--muted);}
  .step{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:13px;border-bottom:1px dashed var(--border);}
  .step:last-child{border-bottom:none;}
  .step .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;} .dot.pass{background:var(--green);} .dot.failed{background:var(--red);}
  .step .step-name{flex:1;} .step .step-time{color:var(--muted);font-size:11px;}
  .error-box{margin-top:8px;background:#2a1518;border:1px solid #5a2a2f;border-radius:8px;padding:12px 14px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#ff9d9d;white-space:pre-wrap;}
</style>
</head>
<body>
<header>
  <h1>UI Automation Report</h1>
  <div class="meta">Generated ${new Date().toLocaleString()}</div>
</header>
<main>
  <section>
    <div class="kpi-row">
      <div class="kpi total"><div class="num">${kpi.total}</div><div class="label">Total Tests</div></div>
      <div class="kpi pass"><div class="num">${kpi.passed}</div><div class="label">Passed</div></div>
      <div class="kpi fail"><div class="num">${kpi.failed}</div><div class="label">Failed</div></div>
      <div class="kpi skip"><div class="num">${kpi.skipped}</div><div class="label">Skipped</div></div>
      <div class="kpi rate"><div class="num">${kpi.passRate}%</div><div class="label">Pass Rate</div></div>
      <div class="kpi"><div class="num">${kpi.durationSec}s</div><div class="label">Duration</div></div>
    </div>
  </section>

  <section>
    <h2>Positive vs Negative Coverage</h2>
    ${renderTypeSummary(typeSummary)}
  </section>

  <section>
    <h2>Coverage by Functionality</h2>
    <div class="area-card">${renderAreaBars(areaSummary)}</div>
  </section>

  <section>
    <h2>Stability — Last ${MAX_HISTORY_RUNS} Runs</h2>
    <div class="history-card">${renderStabilityRows(stabilityRows)}</div>
  </section>

  <section>
    <h2>Detailed Results</h2>
    ${renderTestDetails(tests)}
  </section>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------
// main
// ---------------------------------------------------------------
function main() {
  const raw = loadJson(RESULTS_JSON, null);
  if (!raw) {
    console.error(`Could not find ${RESULTS_JSON}. Run "npx playwright test" first (with the json reporter enabled).`);
    process.exit(1);
  }

  const tests = flattenTests(raw);
  const areaSummary = buildAreaSummary(tests);
  const typeSummary = buildTypeSummary(tests);
  const history = updateHistory(tests);
  const stabilityRows = buildStabilityRows(tests, history);

  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed' || t.status === 'timedOut').length;
  const skipped = tests.filter((t) => t.status === 'skipped').length;
  const total = tests.length;
  const durationMs = tests.reduce((sum, t) => sum + t.duration, 0);

  const kpi = {
    total,
    passed,
    failed,
    skipped,
    passRate: total ? Math.round((passed / total) * 100) : 0,
    durationSec: (durationMs / 1000).toFixed(1),
  };

  const html = renderHtml({ kpi, areaSummary, typeSummary, stabilityRows, tests });
  fs.mkdirSync(path.dirname(OUTPUT_HTML), { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html);
  console.log(`Dashboard report written to ${OUTPUT_HTML}`);
}

main();
