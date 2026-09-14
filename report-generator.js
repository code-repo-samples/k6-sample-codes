#!/usr/bin/env node
'use strict';
const fs = require('fs');

// ========================================================
// CLI ARGS
// ========================================================
// Usage:
//   node report-generator.js --protocol=raw-protocol.json --log=k6-protocol.log --out=report.html
//   node report-generator.js --browser=raw-browser.json --out=report.html
//   node report-generator.js --protocol=raw-protocol.json --browser=raw-browser.json --log=k6-protocol.log --out=report.html
//
// At least one of --protocol / --browser is required. --log is only used by the protocol
// side (it's where the DISCOVERY_JSON line lives) — omit it if you're only doing --browser.
// --profile can also be set via the PROFILE env var; the flag takes precedence.
const args = {};
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m) args[m[1]] = m[2];
}

const PROTOCOL_FILE = args.protocol || null;
const BROWSER_FILE = args.browser || null;
const LOG_FILE = args.log || null;
const OUT_FILE = args.out || 'load_test_report.html';
const PROFILE_LABEL = (args.profile || process.env.PROFILE || 'smoke').toUpperCase();

if (!PROTOCOL_FILE && !BROWSER_FILE) {
  console.error('Nothing to report on. Pass --protocol=<file> and/or --browser=<file>.');
  process.exit(1);
}

function readLines(file) {
  if (!file) return [];
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch (e) {
    console.error(`Could not read ${file}: ${e.message}`);
    return [];
  }
}

// Both files use the same k6 JSON-output line format, so they can be concatenated and
// walked in a single pass — metric names are namespaced enough (resp_time_ms vs.
// ux_web_vital_fcp, etc.) that there's no collision risk.
const lines = [...readLines(PROTOCOL_FILE), ...readLines(BROWSER_FILE)];

function parseDiscoveryFromLog(logText) {
  if (!logText || !String(logText).trim()) return {};

  const text = String(logText);
  const token = 'DISCOVERY_JSON=';
  const tokenIndex = text.indexOf(token);
  if (tokenIndex < 0) return {};

  const objStart = text.indexOf('{', tokenIndex + token.length);
  if (objStart < 0) return {};

  let depth = 0;
  let inString = false;
  let escaped = false;
  let found = '';

  for (let i = objStart; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        found = text.slice(objStart, i + 1);
        break;
      }
    }
  }

  if (!found) return {};

  // Normalize the single-line probe payload that arrives from the k6 console stream:
  // remove BOM/console wrapping line noise, dropped quote escapes, and any CR/LF bytes
  // that may be inserted while the logger writes a very long JSON message.
  const recovered = found
    .replace(/\\\"/g, '"')
    .replace(/\"/g, '"')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .replace(/\t/g, '');

  try {
    return JSON.parse(recovered);
  } catch (e) {
    try {
      return JSON.parse(recovered.replace(/\"/g, '"'));
    } catch (e2) {
      return {};
    }
  }
}

let discovery = {};
if (LOG_FILE) {
  try {
    const raw = fs.readFileSync(LOG_FILE);
    const log = raw && raw[0] === 0xFE && raw[1] === 0xFF
      ? raw.toString('utf16le')
      : raw && raw[0] === 0xFF && raw[1] === 0xFE
        ? raw.toString('utf16le')
        : raw.toString('utf8');
    discovery = parseDiscoveryFromLog(log);
  } catch (e) { /* optional — report still renders without the discovery table */ }
}

// ========================================================
// PROTOCOL-SIDE ACCUMULATORS
// ========================================================
const perUrl = {};
const perUrlStage = {};
let minTs = null, maxTs = null;
const cacheMix = { cache_disabled: 0, cache_enabled: 0 };
let embeddedAttempts = 0, pageIterTotal = 0;
let embeddedAttemptsNew = 0, embeddedAttemptsReturning = 0;

function ensureUrl(url) {
  if (!perUrl[url]) {
    perUrl[url] = {
      resp: [], dns: [], connect: [], tls: [], ttfb: [], download: [],
      fullWithAssets: [], fullWithoutAssets: [],
      pageTotal: 0, pagePassed: 0, pageFailed: 0,
      page2xx: 0, page3xx: 0, page4xx: 0, page5xx: 0,
      resourceTotal: 0, resourcePassed: 0, resourceFailed: 0,
      resource2xx: 0, resource3xx: 0, resource4xx: 0, resource5xx: 0,
      errors: new Map(),
      codeCounts: new Map(),
    };
  }
  return perUrl[url];
}
function ensureUrlStage(url, stage) {
  const key = `${url}|${stage}`;
  if (!perUrlStage[key]) {
    perUrlStage[key] = {
      url, stage, resp: [],
      pageTotal: 0, pagePassed: 0, pageFailed: 0,
      page2xx: 0, page3xx: 0, page4xx: 0, page5xx: 0,
      resourceTotal: 0, resourcePassed: 0, resourceFailed: 0,
      resource2xx: 0, resource3xx: 0, resource4xx: 0, resource5xx: 0,
      errors: new Map(),
      codeCounts: new Map(),
    };
  }
  return perUrlStage[key];
}

// ========================================================
// BROWSER-SIDE ACCUMULATORS
// ========================================================
// One entry per REAL browser page (a "page" = a distinct url_label tag
// emitted by the k6/browser script). Every resource that page loaded is
// nested inside that same entry's `resources` map, keyed by resource URL —
// resources are never promoted into pages of their own, and the same
// resource reported more than once (retries, duplicate metric points,
// legacy tag shapes) is merged into a single row rather than duplicated.
const perUrlBrowser = {};
function ensureUrlBrowser(url) {
  if (!perUrlBrowser[url]) {
    perUrlBrowser[url] = {
      fcp: [], lcp: [], cls: [], ttfb: [], tti: [], pageDuration: [],
      navSuccess: 0, navFailure: 0,
      errors: new Map(),
      samples: 0,
      resources: new Map(), // resource_url -> merged resource record
    };
  }
  return perUrlBrowser[url];
}
function ensureBrowserResource(pageBucket, resourceUrl) {
  if (!pageBucket.resources.has(resourceUrl)) {
    pageBucket.resources.set(resourceUrl, {
      url: resourceUrl,
      type: null,
      domain: null,
      status: null,
      duration: null,
      dns: null,
      tcp: null,
      tls: null,
      ttfb: null,
      download: null,
      bytes: null,
    });
  }
  return pageBucket.resources.get(resourceUrl);
}

// Fallback association for older/incomplete logs where a resource-level
// point doesn't carry its own url_label tag: attach it to whichever page
// was most recently identified for that same environment (falling back to
// the last page seen at all, if there's no env tag either). Keeping this
// per-environment avoids misattributing resources when TARGET_ENV=all
// interleaves iterations across environments.
let globalLastPageLabel = null;
const lastPageLabelByEnv = {};

let sawProtocolData = false;
let sawBrowserData = false;

for (const line of lines) {
  let point;
  try { point = JSON.parse(line); } catch (e) { continue; }
  if (point.type !== 'Point') continue;
  const name = point.metric;
  const data = point.data;
  const tags = data.tags || {};
  const ts = new Date(data.time).getTime();
  if (minTs === null || ts < minTs) minTs = ts;
  if (maxTs === null || ts > maxTs) maxTs = ts;

  // ---- Browser Web Vitals / page metrics / resource metrics ----
  if (name.startsWith('ux_')) {
    sawBrowserData = true;
    const isResourceMetric = name.startsWith('ux_resource_');

    if (!isResourceMetric) {
      // Page-level metric: web vitals, DOM interactive, page duration,
      // navigation outcome, DOM errors. Always keyed by url_label.
      const url = tags.url_label;

      if (name === 'ux_dom_errors') {
        const key = tags.type || 'unknown';
        if (url) {
          const b = ensureUrlBrowser(url);
          b.errors.set(key, (b.errors.get(key) || 0) + data.value);
          globalLastPageLabel = url;
          if (tags.env) lastPageLabelByEnv[tags.env] = url;
        }
        continue;
      }

      if (!url) continue;
      const b = ensureUrlBrowser(url);
      globalLastPageLabel = url;
      if (tags.env) lastPageLabelByEnv[tags.env] = url;

      if (name === 'ux_web_vital_fcp') { b.fcp.push(data.value); b.samples++; }
      else if (name === 'ux_web_vital_lcp') b.lcp.push(data.value);
      else if (name === 'ux_web_vital_cls') b.cls.push(data.value);
      else if (name === 'ux_web_vital_ttfb') b.ttfb.push(data.value);
      else if (name === 'ux_dom_interactive_ms') b.tti.push(data.value);
      else if (name === 'ux_page_duration_ms') b.pageDuration.push(data.value);
      else if (name === 'ux_navigation_success') b.navSuccess += data.value;
      else if (name === 'ux_navigation_failure') b.navFailure += data.value;
      continue;
    }

    // ---- Resource-level metric: attaches to a page, never becomes one ----
    const resourceUrl = tags.resource_url;
    if (!resourceUrl) continue; // nothing to key a row on

    let pageLabel = tags.url_label;
    if (!pageLabel) {
      pageLabel = (tags.env && lastPageLabelByEnv[tags.env]) || globalLastPageLabel;
    }
    if (!pageLabel) continue; // no page context established yet — nothing safe to attach to

    const b = ensureUrlBrowser(pageLabel);
    const r = ensureBrowserResource(b, resourceUrl);

    // Descriptive fields are set once; a later duplicate point for the same
    // request can't blank out already-known detail.
    if (tags.resource_type && !r.type) r.type = tags.resource_type;
    if (tags.domain && !r.domain) r.domain = tags.domain;
    if (tags.status && (r.status === null || r.status === 'unknown')) r.status = tags.status;

    // Numeric measurements: a duplicate point for the exact same request
    // (retry, replayed log line, etc.) overwrites rather than appending —
    // one resource_url within one page always renders as one row.
    switch (name) {
      case 'ux_resource_duration_ms': r.duration = data.value; break;
      case 'ux_resource_dns_ms': r.dns = data.value; break;
      case 'ux_resource_tcp_ms': r.tcp = data.value; break;
      case 'ux_resource_tls_ms': r.tls = data.value; break;
      case 'ux_resource_ttfb_ms': r.ttfb = data.value; break;
      case 'ux_resource_download_ms': r.download = data.value; break;
      case 'ux_resource_bytes': r.bytes = data.value; break;
      default: break; // ux_resource_2xx/3xx/4xx/5xx counters — status already captured above
    }
    continue;
  }

  // ---- Protocol-level metrics (everything else) ----
  const url = tags.url_label;
  if (!url || tags.stage === 'setup') continue; // skip the one-time setup() discovery hit
  sawProtocolData = true;
  const stage = tags.stage;
  const u = ensureUrl(url);
  const us = stage ? ensureUrlStage(url, stage) : null;

  switch (name) {
    case 'resp_time_ms':
      if (tags.resource === 'page') {
        u.resp.push(data.value);
        if (us) us.resp.push(data.value);
      }
      break;
    case 'dns_time_ms': if (tags.resource === 'page') u.dns.push(data.value); break;
    case 'connect_time_ms': if (tags.resource === 'page') u.connect.push(data.value); break;
    case 'tls_time_ms': if (tags.resource === 'page') u.tls.push(data.value); break;
    case 'ttfb_ms': if (tags.resource === 'page') u.ttfb.push(data.value); break;
    case 'download_time_ms': if (tags.resource === 'page') u.download.push(data.value); break;
    case 'full_page_time_ms':
      if (tags.assets_fetched === 'true') u.fullWithAssets.push(data.value);
      else u.fullWithoutAssets.push(data.value);
      break;
    case 'page_total':
      u.pageTotal += data.value;
      if (us) us.pageTotal += data.value;
      pageIterTotal += data.value;
      if (tags.cache_state) cacheMix[tags.cache_state] = (cacheMix[tags.cache_state] || 0) + data.value;
      break;
    case 'page_passed':
      u.pagePassed += data.value;
      if (us) us.pagePassed += data.value;
      break;
    case 'page_failed':
      u.pageFailed += data.value;
      if (us) us.pageFailed += data.value;
      break;
    case 'page_2xx':
      u.page2xx += data.value;
      if (us) us.page2xx += data.value;
      break;
    case 'page_3xx':
      u.page3xx += data.value;
      if (us) us.page3xx += data.value;
      break;
    case 'page_4xx':
      u.page4xx += data.value;
      if (us) us.page4xx += data.value;
      break;
    case 'page_5xx':
      u.page5xx += data.value;
      if (us) us.page5xx += data.value;
      break;
    case 'resource_total':
      u.resourceTotal += data.value;
      if (us) us.resourceTotal += data.value;
      break;
    case 'resource_passed':
      u.resourcePassed += data.value;
      if (us) us.resourcePassed += data.value;
      break;
    case 'resource_failed':
      u.resourceFailed += data.value;
      if (us) us.resourceFailed += data.value;
      break;
    case 'resource_2xx':
      u.resource2xx += data.value;
      if (us) us.resource2xx += data.value;
      break;
    case 'resource_3xx':
      u.resource3xx += data.value;
      if (us) us.resource3xx += data.value;
      break;
    case 'resource_4xx':
      u.resource4xx += data.value;
      if (us) us.resource4xx += data.value;
      break;
    case 'resource_5xx':
      u.resource5xx += data.value;
      if (us) us.resource5xx += data.value;
      break;
    case 'embedded_fetch_attempts':
      embeddedAttempts += data.value;
      // user_type is only present on runs using the corrected k6 script;
      // older logs without the tag just won't populate the split numbers,
      // and the two per-type cards below will read "n/a" instead of 0%
      // so they aren't mistaken for a real zero.
      if (tags.user_type === 'new') embeddedAttemptsNew += data.value;
      else if (tags.user_type === 'returning') embeddedAttemptsReturning += data.value;
      break;
    case 'error_events': {
      const resource = tags.resource || 'unknown';
      const code = String(tags.code || 'unknown');
      const normalized = normalizeErrorDescription(tags.desc);
      const key = `${resource}|${code}|${normalized}`;
      const count = Number(data.value) || 1;

      u.errors.set(key, (u.errors.get(key) || 0) + count);
      u.codeCounts.set(code, (u.codeCounts.get(code) || 0) + count);

      if (us) {
        us.errors.set(key, (us.errors.get(key) || 0) + count);
        us.codeCounts.set(code, (us.codeCounts.get(code) || 0) + count);
      }
      break;
    }
    default: break;
  }
}

// ========================================================
// HELPERS
// ========================================================
function pct(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function mn(arr) { return arr.length ? Math.min(...arr) : 0; }
function mx(arr) { return arr.length ? Math.max(...arr) : 0; }
function f1(n) { return Number(n).toFixed(1); }
function f3(n) { return Number(n).toFixed(3); }
function pctFmt(n) { return `${f1(n)}%`; }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function avgOrDash(arr) { return arr.length ? f1(avg(arr)) : '–'; }
function pctOrDash(arr, p) { return arr.length ? f1(pct(arr, p)) : '–'; }
function normalizeErrorDescription(desc) {
  if (!desc) return 'unknown error';
  // Collapse URL-heavy errors into a short, stable token so repeated assets do not
  // create a noisy row list in the HTML error breakdown.
  let out = String(desc);
  const assetMatch = out.match(/^asset\s+https?:\/\/[^\s]+/i);
  if (assetMatch) {
    const url = assetMatch[0].replace(/^asset\s+/, '');
    const path = url.split('/').slice(3).join('/');
    const file = path.split('/').pop() || 'asset';
    const ext = file.includes('.') ? file.split('.').pop() : 'resource';
    out = `asset ${file} (${ext.toUpperCase()})`;
  } else if (/^page\s+https?:\/\//i.test(out)) {
    out = 'page HTML request';
  } else {
    out = out.replace(/https?:\/\/[^\s]+/g, '<url>');
  }
  return out;
}

const urls = Object.keys(perUrl);
const browserUrls = Object.keys(perUrlBrowser);

const stageFirstSeenOrder = [];
Object.values(perUrlStage).forEach((s) => {
  if (!stageFirstSeenOrder.includes(s.stage)) stageFirstSeenOrder.push(s.stage);
});
const stages = stageFirstSeenOrder;

let totalPageTx = 0, totalPagePass = 0, totalPageFail = 0, totalResTx = 0, totalResFail = 0;
urls.forEach((u) => {
  totalPageTx += perUrl[u].pageTotal;
  totalPagePass += perUrl[u].pagePassed;
  totalPageFail += perUrl[u].pageFailed;
  totalResTx += perUrl[u].resourceTotal;
  totalResFail += perUrl[u].resourceFailed;
});
const durationSec = minTs && maxTs ? Math.round((maxTs - minTs) / 1000) : 0;
const startedAt = minTs ? new Date(minTs).toISOString() : 'n/a';
const finishedAt = maxTs ? new Date(maxTs).toISOString() : 'n/a';

// ---------------- Console summary ----------------
console.log('='.repeat(78));
console.log(`k6 Load Test Summary — profile: ${PROFILE_LABEL}`);
console.log(`Sources: ${PROTOCOL_FILE ? 'protocol=' + PROTOCOL_FILE + ' ' : ''}${BROWSER_FILE ? 'browser=' + BROWSER_FILE : ''}`);
console.log(`Started:  ${startedAt}`);
console.log(`Finished: ${finishedAt}`);
console.log(`Duration: ${durationSec}s`);
if (sawProtocolData) {
  console.log(`Page transactions: ${totalPageTx}  Passed: ${totalPagePass}  Failed: ${totalPageFail}  Error rate: ${totalPageTx ? pctFmt((totalPageFail / totalPageTx) * 100) : '0%'}`);
} else if (PROTOCOL_FILE) {
  console.log('No protocol-level data points found in the given file.');
}
if (sawBrowserData) {
  console.log(`Browser Web Vitals recorded for ${browserUrls.length} page(s).`);
} else if (BROWSER_FILE) {
  console.log('No browser Web Vitals data points found in the given file.');
}
console.log('='.repeat(78));

// ---------------- HTML rendering ----------------
function errorRowsHtml(errorsMap, urlLabel) {
  if (!errorsMap.size) return `<tr><td colspan="5" style="text-align:center;color:#6B7280">No errors recorded</td></tr>`;
  return [...errorsMap.entries()].map(([key, count]) => {
    const [resource, code, desc] = key.split('|');
    return `<tr><td>${esc(urlLabel)}</td><td>${esc(resource)}</td><td>${esc(code)}</td><td>${esc(desc)}</td><td class="num">${count}</td></tr>`;
  }).join('\n');
}

let protocolSectionsHtml = '';
if (sawProtocolData) {
  const urlAggRows = urls.map((u) => {
    const d = perUrl[u];
    const errPct = d.pageTotal ? (d.pageFailed / d.pageTotal) * 100 : 0;
    const pillClass = errPct === 0 ? 'ok' : errPct < 1 ? 'warn' : 'bad';
    const tps = durationSec ? (d.pageTotal / durationSec).toFixed(1) : '0.0';
    return `<tr>
      <td>${esc(u)}</td><td class="num">${d.pageTotal}</td><td class="num">${d.pagePassed}</td>
      <td class="num">${d.pageFailed}</td><td class="num">${f1(avg(d.resp))}</td>
      <td class="num">${f1(mn(d.resp))}</td><td class="num">${f1(mx(d.resp))}</td>
      <td class="num">${f1(pct(d.resp, 90))}</td><td class="num">${f1(pct(d.resp, 95))}</td>
      <td class="num"><span class="pill ${pillClass}">${pctFmt(errPct)}</span></td>
      <td class="num">${tps}/s</td>
    </tr>`;
  }).join('\n');

  const fullLoadRows = urls.map((u) => {
    const d = perUrl[u];
    return `<tr>
      <td>${esc(u)}</td>
      <td class="num">${d.fullWithAssets.length}</td>
      <td class="num">${avgOrDash(d.fullWithAssets)}</td>
      <td class="num">${pctOrDash(d.fullWithAssets, 95)}</td>
      <td class="num">${d.fullWithoutAssets.length}</td>
      <td class="num">${avgOrDash(d.fullWithoutAssets)}</td>
      <td class="num">${pctOrDash(d.fullWithoutAssets, 95)}</td>
    </tr>`;
  }).join('\n');

  const resourceAggRows = urls.map((u) => {
    const d = perUrl[u];
    const errPct = d.resourceTotal ? (d.resourceFailed / d.resourceTotal) * 100 : 0;
    const pillClass = errPct === 0 ? 'ok' : errPct < 2 ? 'warn' : 'bad';
    return `<tr><td>${esc(u)}</td><td class="num">${d.resourceTotal}</td><td class="num">${d.resourcePassed}</td>
      <td class="num">${d.resourceFailed}</td><td class="num"><span class="pill ${pillClass}">${pctFmt(errPct)}</span></td></tr>`;
  }).join('\n');

  const resourceAccordionRows = urls.map((u) => {
    const d = perUrl[u];
    const errPct = d.resourceTotal ? (d.resourceFailed / d.resourceTotal) * 100 : 0;
    const pillClass = errPct === 0 ? 'ok' : errPct < 2 ? 'warn' : 'bad';

    function pageLabelFromDiscoveryKey(pageKey) {
      if (!pageKey) return '';
      const key = String(pageKey);
      const dotted = key.includes('.') ? key.split('.') : [key];
      return dotted.slice(1).join('.') || dotted[0] || '';
    }

    function matchDiscoveryForUrl(pageKey, info) {
      if (!pageKey || !info) return false;
      const label = pageLabelFromDiscoveryKey(pageKey);
      if (!label) return false;

      // Exact page label should match, and catch environment-prefixed keys such as
      // onexp_alpha.Homepage and onexp_gamma.Homepage-Gamma.
      const discovered = String(label);
      const report = String(u);
      if (discovered === report) return true;
      if (discovered.toLowerCase() === report.toLowerCase()) return true;

      // Support labels that vary by environment suffix while the report key itself is
      // the canonical page label, like Homepage-xtnd or Homepage-Gamma.
      const discoveredNoEnv = discovered.split('-').slice(0, 1).join('-');
      const discoveryNames = [discovered, discoveredNoEnv];
      return discoveryNames.some((name) => name === report || name.toLowerCase() === report.toLowerCase());
    }

    // Try a direct exact-key match first (this is what the current k6 script
    // actually emits — discoveryLog[page.name], e.g. discovery["ContactUs"] —
    // so most of the time this single lookup is all that's needed and the
    // fuzzy dotted-key matching below only exists as a fallback for older
    // discovery payloads that prefixed keys with an environment name).
    let matches = discovery[u] ? [[u, discovery[u]]] : [];
    if (!matches.length) {
      matches = Object.entries(discovery).filter(([pageKey, info]) => matchDiscoveryForUrl(pageKey, info));
    }

    const assetUrls = [];
    for (const [pageKey, info] of matches) {
      const list = Array.isArray(info.assets) ? info.assets : [];
      for (const asset of list) {
        const cleanAsset = String(asset || '').trim();
        if (!cleanAsset || assetUrls.includes(cleanAsset)) continue;
        assetUrls.push(cleanAsset);
      }
    }

    const assetRows = assetUrls.length
      ? assetUrls.map((a) => `<tr><td>${esc(a)}</td></tr>`).join('\n')
      : `<tr><td colspan="1" style="text-align:center;color:#6B7280">No captured asset URLs discovered</td></tr>`;

    return `<details class="resource-accordion" ${u === urls[0] ? 'open' : ''}>
      <summary>
        <span class="caret">&#9654;</span>
        <span class="resource-title">${esc(u)}</span>
        <span class="resource-count">Requests: <b class="num">${d.resourceTotal}</b></span>
        <span class="resource-pass">Passed: <b class="num">${d.resourcePassed}</b></span>
        <span class="resource-fail">Failed: <b class="num">${d.resourceFailed}</b></span>
        <span class="resource-rate"><span class="pill ${pillClass}">${pctFmt(errPct)}</span></span>
      </summary>
      <div class="resource-accordion-body">
        <table class="card"><thead><tr><th style="text-align:left">Asset URL</th></tr></thead><tbody>${assetRows}</tbody></table>
      </div>
    </details>`;
  }).join('\n');

  const allStatusCodes = Array.from(new Set(urls.flatMap((u) => Array.from(perUrl[u].codeCounts.keys()))))
    .filter((code) => /^\d+$/.test(code))
    .sort((a, b) => Number(a) - Number(b));

  const failureSummaryRows = urls.map((u) => {
    const d = perUrl[u];
    const totalErrorEvents = [...d.errors.values()].reduce((a, c) => a + c, 0);
    const codeCells = allStatusCodes.map((code) => `<td class="num">${d.codeCounts.get(code) || 0}</td>`).join('\n');
    return `<tr><td>${esc(u)}</td><td class="num">${d.pageFailed}</td><td class="num">${d.resourceFailed}</td>
      ${codeCells}
      <td class="num">${d.errors.size}</td><td class="num">${totalErrorEvents}</td></tr>`;
  }).join('\n');

  const failureSummaryHeader = `<th style="text-align:left">URL</th><th>Page Failed</th><th>Resource Failed</th>${allStatusCodes.map((code) => `<th>${code}</th>`).join('')}<th>Distinct Error Groups</th><th>Raw Error Events</th>`;

  // Only render rows for URLs that actually have errors — a URL with zero
  // errors used to still emit its own "No errors recorded" placeholder row,
  // which just adds noise when other URLs in the same table have real data.
  // A single placeholder is shown only if NO url in the whole run had any error.
  const urlsWithErrors = urls.filter((u) => perUrl[u].errors.size > 0);
  const urlErrorRows = urlsWithErrors.length
    ? urlsWithErrors.map((u) => errorRowsHtml(perUrl[u].errors, u)).join('\n')
    : `<tr><td colspan="5" style="text-align:center;color:#6B7280">No errors recorded across any URL</td></tr>`;

  const networkRows = urls.map((u) => {
    const d = perUrl[u];
    return `<tr><td>${esc(u)}</td><td class="num">${avgOrDash(d.dns)}</td><td class="num">${avgOrDash(d.connect)}</td>
      <td class="num">${avgOrDash(d.tls)}</td><td class="num">${avgOrDash(d.ttfb)}</td><td class="num">${avgOrDash(d.download)}</td></tr>`;
  }).join('\n');

  const stageSections = stages.map((st, idx) => {
    const rows = urls.map((u) => {
      const s = perUrlStage[`${u}|${st}`];
      if (!s) return '';
      return `<tr><td>${esc(u)}</td><td class="num">${s.resp.length}</td><td class="num">${s.pagePassed}</td><td class="num">${s.pageFailed}</td><td class="num">${f1(avg(s.resp))}</td>
        <td class="num">${f1(mn(s.resp))}</td><td class="num">${f1(mx(s.resp))}</td>
        <td class="num">${f1(pct(s.resp, 90))}</td><td class="num">${f1(pct(s.resp, 95))}</td>
        <td class="num">${s.page2xx + s.resource2xx}</td><td class="num">${s.page3xx + s.resource3xx}</td><td class="num">${s.page4xx + s.resource4xx}</td><td class="num">${s.page5xx + s.resource5xx}</td></tr>`;
    }).join('\n');
    const errRows = urls.map((u) => {
      const s = perUrlStage[`${u}|${st}`];
      if (!s || !s.errors.size) return '';
      return errorRowsHtml(s.errors, u);
    }).filter(Boolean).join('\n') || `<tr><td colspan="5" style="text-align:center;color:#6B7280">No errors in this phase</td></tr>`;
    let stageTx = 0, stagePass = 0, stageErr = 0, stageResFail = 0, stage2xx = 0, stage3xx = 0, stage4xx = 0, stage5xx = 0;
    urls.forEach((u) => {
      const s = perUrlStage[`${u}|${st}`];
      if (s) {
        stageTx += s.pageTotal;
        stagePass += s.pagePassed;
        stageErr += s.pageFailed;
        stageResFail += s.resourceFailed;
        stage2xx += s.page2xx + s.resource2xx;
        stage3xx += s.page3xx + s.resource3xx;
        stage4xx += s.page4xx + s.resource4xx;
        stage5xx += s.page5xx + s.resource5xx;
      }
    });
    return `<details class="stage" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="caret">&#9654;</span>
        <span class="stage-name">Phase ${idx + 1} &mdash; ${esc(st)}</span>
        <span class="stage-stats">
          <span>Page Transactions: <b class="num">${stageTx}</b></span>
          <span>Page Passed: <b class="num">${stagePass}</b></span>
          <span>Page Failed: <b class="num">${stageErr}</b></span>
          <span>Resource Failed: <b class="num">${stageResFail}</b></span>
          <span>2xx: <b class="num">${stage2xx}</b></span>
          <span>3xx: <b class="num">${stage3xx}</b></span>
          <span>4xx: <b class="num">${stage4xx}</b></span>
          <span>5xx: <b class="num">${stage5xx}</b></span>
          <span>Page Error Rate: <b class="num">${pctFmt(stageTx ? (stageErr / stageTx) * 100 : 0)}</b></span>
        </span>
      </summary>
      <div class="stage-body">
        <h3>Server response time per URL (HTML only)</h3>
        <table class="card"><thead><tr><th>URL</th><th>Samples</th><th>Page Passed</th><th>Page Failed</th><th>Avg</th><th>Min</th><th>Max</th><th>p90</th><th>p95</th><th>2xx</th><th>3xx</th><th>4xx</th><th>5xx</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <h3>Errors in this phase</h3>
        <details class="error-accordion">
          <summary>
            <span class="caret">&#9654;</span>
            <span class="error-title">Error rows for ${esc(st)}</span>
            <span class="error-count">${errRows.includes('No errors in this phase') ? '0 rows' : `${urls.length} URL groups`}</span>
          </summary>
          <div class="error-accordion-body">
            <table class="card"><thead><tr><th style="text-align:left">URL</th><th style="text-align:left">Resource</th><th style="text-align:left">Code</th><th style="text-align:left">Description</th><th>Count</th></tr></thead>
            <tbody>${errRows}</tbody></table>
          </div>
        </details>
      </div>
    </details>`;
  }).join('\n');

  const totalCacheDisabled = cacheMix.cache_disabled || 0;
  const totalCacheEnabled = cacheMix.cache_enabled || 0;
  const cacheBase = totalCacheDisabled + totalCacheEnabled || 1;
  const embeddedBase = pageIterTotal || 1;
  // Per-user-type denominators for the split resource-fetch rate cards.
  // Falls back gracefully (shows "n/a") if the log predates the user_type tag.
  const hasUserTypeSplit = (embeddedAttemptsNew + embeddedAttemptsReturning) > 0;
  const newUserRate = totalCacheDisabled ? (embeddedAttemptsNew / totalCacheDisabled * 100) : null;
  const returningUserRate = totalCacheEnabled ? (embeddedAttemptsReturning / totalCacheEnabled * 100) : null;

  const discoveryRows = Object.entries(discovery).map(([label, info]) => {
    return (info.domains || []).map((d) => {
      const pillClass = d.kept ? 'ok' : 'warn';
      return `<tr><td>${esc(label)}</td><td>${esc(d.domain)}</td><td><span class="pill ${pillClass}">${d.kept ? 'kept' : 'filtered'}</span></td><td>${esc(d.reason)}</td></tr>`;
    }).join('\n');
  }).join('\n') || `<tr><td colspan="4" style="text-align:center;color:#6B7280">No discovery data available</td></tr>`;

  protocolSectionsHtml = `
  <section class="section-heading"><h1>Protocol-Level Results <span class="scope">HTTP</span></h1>
    <p class="note">From the ramping-arrival-rate load script — server response times, throughput, and errors under load.</p>
  </section>

  <div class="kpi-row">
    <div class="kpi"><div class="label">Page Transactions</div><div class="value num">${totalPageTx}</div></div>
    <div class="kpi pass"><div class="label">Passed</div><div class="value num">${totalPagePass}</div></div>
    <div class="kpi fail"><div class="label">Failed</div><div class="value num">${totalPageFail}</div></div>
    <div class="kpi"><div class="label">Page Error Rate</div><div class="value num">${pctFmt(totalPageTx ? (totalPageFail / totalPageTx) * 100 : 0)}</div></div>
    <div class="kpi"><div class="label">Embedded Requests</div><div class="value num">${totalResTx}</div></div>
  </div>

  <section>
    <h2>Load Phase Breakdown <span class="sub">results grouped by ramp phase, in the order they ran</span></h2>
    <p class="note">Named phases come straight from the k6 script's STAGES config — expand a phase to see per-URL response times and errors for just that window.</p>
    ${stageSections}
  </section>

  <section>
    <h2>Server Response Time <span class="sub">HTML document only</span></h2>
    <p class="note">Time to receive and finish the main page request. Does NOT include embedded asset (JS/CSS/image) downloads — see "Full Page Load Time" below for the end-to-end number.</p>
    <table class="card"><thead><tr>
      <th>URL</th><th>Samples</th><th>Passed</th><th>Failed</th><th>Avg</th><th>Min</th><th>Max</th><th>p90</th><th>p95</th><th>Error %</th><th>Throughput</th>
    </tr></thead><tbody>${urlAggRows}</tbody></table>
  </section>

  <section>
    <h2>Full Page Load Time <span class="sub">HTML document + embedded assets, where fetched</span></h2>
    <p class="note">"With assets" = new-user iterations that also downloaded the page's JS/CSS/images (cold-cache simulation). "Page only" = returning-user iterations that skipped asset downloads (warm-cache simulation). A blank or zero sample count under the asset branch means that URL did not produce an asset-fetch sample in this run because the page had no discovered asset list or because the iteration was not in the new-user branch.</p>
    <table class="card"><thead><tr>
      <th>URL</th><th>Samples (w/ assets)</th><th>Avg (w/ assets)</th><th>p95 (w/ assets)</th>
      <th>Samples (page only)</th><th>Avg (page only)</th><th>p95 (page only)</th>
    </tr></thead><tbody>${fullLoadRows}</tbody></table>
  </section>

  <section>
    <h2>Embedded Resource Summary <span class="sub">per URL &mdash; individual asset requests, not iterations</span></h2>
    <table class="card"><thead><tr>
      <th>URL</th><th>Requests</th><th>Passed</th><th>Failed</th><th>Error %</th>
    </tr></thead><tbody>${resourceAggRows}</tbody></table>
    <details class="resource-accordion-root">
      <summary>
        <span class="caret">&#9654;</span>
        <span class="section-title">Show per-URL discovered asset detail</span>
      </summary>
      <div class="resource-accordion-root-body">
        ${resourceAccordionRows}
      </div>
    </details>
  </section>

  <section>
    <h2>Failure Summary <span class="sub">page failures, resource failures, and grouped issue count per URL</span></h2>
    <p class="note">Page Failed = HTML page responses that were not HTTP 200. Resource Failed = embedded asset responses that were not HTTP 2xx. Distinct Error Groups = unique normalized signatures after grouping by resource, HTTP status code, and a short normalized error description. Raw Error Events = the total number of error rows emitted from the k6 protocol stream for that URL. Status-code columns show the HTTP code distribution you can inspect alongside the grouped signature.</p>
    <table class="card"><thead><tr>
      ${failureSummaryHeader}
    </tr></thead><tbody>${failureSummaryRows}</tbody></table>
  </section>

  <section>
    <h2>Error Breakdown <span class="sub">whole run, by URL &mdash; page vs. resource, code, description, count</span></h2>
    <details class="error-accordion error-accordion-wide" open>
      <summary>
        <span class="caret">&#9654;</span>
        <span class="error-title">Show / hide grouped error details</span>
        <span class="error-count">${urls.length} URL groups</span>
      </summary>
      <div class="error-accordion-body">
        <table class="card"><thead><tr>
          <th style="text-align:left">URL</th><th style="text-align:left">Resource</th><th style="text-align:left">Code</th><th style="text-align:left">Description</th><th>Count</th>
        </tr></thead><tbody>${urlErrorRows}</tbody></table>
      </div>
    </details>
  </section>

  <section>
    <h2>Client-Side Network Timing <span class="sub">HTML document only, avg ms</span></h2>
    <p class="note">A dash means that timing wasn't recorded for this run — not that it measured zero. These averages are taken from the page HTML samples shown in the phase tables; total sample counts are not repeated in the table for non-technical readability.</p>
    <table class="card"><thead><tr>
      <th>URL</th><th>Blocked (DNS+Queue)</th><th>TCP Connect</th><th>TLS Handshake</th><th>TTFB</th><th>Content Download</th>
    </tr></thead><tbody>${networkRows}</tbody></table>
  </section>

  <section>
    <h2>Embedded-Resource Discovery <span class="sub">from setup() &mdash; domain/extension filtering transparency</span></h2>
    <table class="card"><thead><tr>
      <th style="text-align:left">URL</th><th style="text-align:left">Domain</th><th>Status</th><th style="text-align:left">Reason</th>
    </tr></thead><tbody>${discoveryRows}</tbody></table>
  </section>

  <section>
    <h2>User Behavior Mix <span class="sub">new vs. returning traffic split, and each type's resource-validation rate</span></h2>
    <p class="note">The first two cards show the actual new/returning traffic split achieved by the scenarios. The next two show, separately for each user type, what fraction of THEIR page transactions also validated embedded resources — kept separate because the two user types can use different resource-validation rules (e.g. new users always validating vs. returning users sampled at a flat ratio), so a single blended percentage would misrepresent both.</p>
    <div class="mix-row">
      <div class="mix-card"><div class="label">New users (of all page transactions)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(totalCacheDisabled / cacheBase * 100).toFixed(0)}%"></div></div>
        <div class="value num">${pctFmt(totalCacheDisabled / cacheBase * 100)}</div></div>
      <div class="mix-card"><div class="label">Returning users (of all page transactions)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(totalCacheEnabled / cacheBase * 100).toFixed(0)}%"></div></div>
        <div class="value num">${pctFmt(totalCacheEnabled / cacheBase * 100)}</div></div>
      <div class="mix-card"><div class="label">Resource-fetch rate — new users</div>
        <div class="bar-track"><div class="bar-fill" style="width:${newUserRate === null ? 0 : newUserRate.toFixed(0)}%"></div></div>
        <div class="value num">${newUserRate === null ? 'n/a' : pctFmt(newUserRate)}</div></div>
      <div class="mix-card"><div class="label">Resource-fetch rate — returning users</div>
        <div class="bar-track"><div class="bar-fill" style="width:${returningUserRate === null ? 0 : returningUserRate.toFixed(0)}%"></div></div>
        <div class="value num">${returningUserRate === null ? 'n/a' : pctFmt(returningUserRate)}</div></div>
    </div>
    ${!hasUserTypeSplit ? `<p class="note">Note: this run's logs predate the per-user-type tag on embedded_fetch_attempts, so the two resource-fetch-rate cards above show n/a. Combined rate across all transactions was ${pctFmt(embeddedAttempts / embeddedBase * 100)}.</p>` : ''}
  </section>`;
} else if (PROTOCOL_FILE) {
  protocolSectionsHtml = `<section class="section-heading"><h1>Protocol-Level Results <span class="scope">HTTP</span></h1></section>
  <section><p class="note">A --protocol file was given, but it contained no recognizable data points. Check the file path and that the k6 run actually completed.</p></section>`;
}

let browserSectionHtml = '';
if (sawBrowserData) {
  const LCP_THRESHOLD = 2500, FCP_THRESHOLD = 1500;

  // ---- Top-of-section KPI cards: whole-run totals only. No resource cards. ----
  let totalNavSuccess = 0, totalNavFailure = 0, totalDomErrors = 0, totalResources = 0, totalSamples = 0;
  browserUrls.forEach((u) => {
    const b = perUrlBrowser[u];
    totalSamples += b.samples;
    totalNavSuccess += b.navSuccess;
    totalNavFailure += b.navFailure;
    totalResources += b.resources.size;
    for (const c of b.errors.values()) totalDomErrors += c;
  });

  const browserKpiRow = `<div class="kpi-row">
    <div class="kpi"><div class="label">Pages Measured</div><div class="value num">${browserUrls.length}</div></div>
    <div class="kpi"><div class="label">Page Load Samples</div><div class="value num">${totalSamples}</div></div>
    <div class="kpi pass"><div class="label">Navigations OK</div><div class="value num">${totalNavSuccess}</div></div>
    <div class="kpi fail"><div class="label">Navigations Failed</div><div class="value num">${totalNavFailure}</div></div>
    <div class="kpi"><div class="label">Resources Captured</div><div class="value num">${totalResources}</div></div>
  </div>`;

  // One accordion per real browser page. Resources never get their own
  // accordion or card — they only ever appear as rows in that page's
  // Resources table.
  const pageAccordions = browserUrls.map((u, idx) => {
    const b = perUrlBrowser[u];
    const lcpP95 = pct(b.lcp, 95);
    const fcpP95 = pct(b.fcp, 95);
    const lcpPill = !b.lcp.length ? '' : `<span class="pill ${lcpP95 < LCP_THRESHOLD ? 'ok' : 'bad'}">LCP ${lcpP95 < LCP_THRESHOLD ? 'pass' : 'fail'}</span>`;
    const fcpPill = !b.fcp.length ? '' : `<span class="pill ${fcpP95 < FCP_THRESHOLD ? 'ok' : 'bad'}">FCP ${fcpP95 < FCP_THRESHOLD ? 'pass' : 'fail'}</span>`;
    const domErrCount = [...b.errors.values()].reduce((a, c) => a + c, 0);

    const pageMetricsTable = `<table class="card"><thead><tr>
        <th>Samples</th><th>FCP Avg</th><th>FCP p95</th><th>LCP Avg</th><th>LCP p95</th>
        <th>CLS Avg</th><th>TTFB Avg</th><th>DOM Interactive Avg</th><th>Page Duration Avg</th>
        <th>Nav OK</th><th>Nav Failed</th><th>DOM Errors</th>
      </tr></thead><tbody><tr>
        <td class="num">${b.samples}</td>
        <td class="num">${avgOrDash(b.fcp)}</td><td class="num">${pctOrDash(b.fcp, 95)}</td>
        <td class="num">${avgOrDash(b.lcp)}</td><td class="num">${pctOrDash(b.lcp, 95)}</td>
        <td class="num">${b.cls.length ? f3(avg(b.cls)) : '–'}</td>
        <td class="num">${avgOrDash(b.ttfb)}</td>
        <td class="num">${avgOrDash(b.tti)}</td>
        <td class="num">${avgOrDash(b.pageDuration)}</td>
        <td class="num">${b.navSuccess}</td><td class="num">${b.navFailure}</td>
        <td class="num">${domErrCount}</td>
      </tr></tbody></table>`;

    const resourceRows = [...b.resources.values()];
    const resourcesTableBody = resourceRows.length
      ? resourceRows.map((r) => `<tr>
          <td class="url-cell" style="text-align:left">${esc(r.url)}</td>
          <td style="text-align:left">${esc(r.type || 'other')}</td>
          <td style="text-align:left">${esc(r.domain || 'unknown')}</td>
          <td class="num">${esc(r.status || 'unknown')}</td>
          <td class="num">${r.duration != null ? f1(r.duration) : '–'}</td>
          <td class="num">${r.dns != null ? f1(r.dns) : '–'}</td>
          <td class="num">${r.tcp != null ? f1(r.tcp) : '–'}</td>
          <td class="num">${r.tls != null ? f1(r.tls) : '–'}</td>
          <td class="num">${r.ttfb != null ? f1(r.ttfb) : '–'}</td>
          <td class="num">${r.download != null ? f1(r.download) : '–'}</td>
          <td class="num">${r.bytes != null ? r.bytes : '–'}</td>
        </tr>`).join('\n')
      : `<tr><td colspan="11" style="text-align:center;color:#6B7280">No resources captured for this page</td></tr>`;

    const resourcesTable = `<table class="card"><thead><tr>
        <th style="text-align:left">URL</th><th style="text-align:left">Type</th><th style="text-align:left">Domain</th>
        <th>Status</th><th>Total</th><th>DNS</th><th>TCP</th><th>TLS</th><th>TTFB</th><th>Download</th><th>Bytes</th>
      </tr></thead><tbody>${resourcesTableBody}</tbody></table>`;

    return `<details class="page-accordion" ${idx === 0 ? 'open' : ''}>
      <summary>
        <span class="caret">&#9654;</span>
        <span class="page-title">${esc(u)}</span>
        <span class="page-stats">
          ${fcpPill}
          ${lcpPill}
          <span>Resources: <b class="num">${resourceRows.length}</b></span>
          <span>DOM Errors: <b class="num">${domErrCount}</b></span>
        </span>
      </summary>
      <div class="page-accordion-body">
        <h3>Page Metrics</h3>
        ${pageMetricsTable}
        <h3>Resources <span class="sub">${resourceRows.length} captured</span></h3>
        ${resourcesTable}
      </div>
    </details>`;
  }).join('\n');

  browserSectionHtml = `
  <section class="section-heading"><h1>Browser-Level Results <span class="scope">WEB VITALS</span></h1>
    <p class="note">From the k6/browser Web Vitals script — real Chromium rendering metrics, gathered concurrently while the protocol-level script (if run) put the infrastructure under load. Each accordion below is exactly one real browser page; every resource that page loaded is a single row in that page's Resources table — resources are never listed as pages of their own, and a resource reported more than once is merged into one row.</p>
  </section>

  ${browserKpiRow}

  <section>
    <h2>Pages <span class="sub">thresholds: LCP p95 &lt; 2500ms, FCP p95 &lt; 1500ms</span></h2>
    ${pageAccordions}
  </section>`;
} else if (BROWSER_FILE) {
  browserSectionHtml = `<section class="section-heading"><h1>Browser-Level Results <span class="scope">WEB VITALS</span></h1></section>
  <section><p class="note">A --browser file was given, but it contained no recognizable Web Vitals data points. Check the file path and that the k6 run actually completed.</p></section>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>k6 Load Test Report</title>
<style>
  :root{ --bg:#F5F6F8; --card:#FFFFFF; --ink:#1C2130; --muted:#6B7280; --line:#E4E7EC;
    --accent:#2A5CDB; --pass:#1A8754; --pass-bg:#E7F6EE; --fail:#C6303E; --fail-bg:#FBEAEC;
    --warn:#B5750A; --warn-bg:#FBF1DF; }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:"IBM Plex Sans","Segoe UI",Arial,sans-serif; font-size:14px; line-height:1.5; }
  .num{ font-family:"IBM Plex Mono",Consolas,monospace; font-variant-numeric:tabular-nums; }
  header.run{ background:#171B26; color:#F5F6F8; padding:28px 40px; }
  header.run h1{ margin:0 0 4px 0; font-size:20px; font-weight:600; }
  header.run .meta{ color:#AEB4C2; font-size:13px; margin-top:10px; }
  header.run .meta span{ margin-right:22px; }
  header.run .meta b{ color:#F5F6F8; font-weight:600; }
  header.run .badges{ margin-top:8px; }
  header.run .badge{ display:inline-block; margin-right:8px; padding:3px 10px; background:#2A5CDB22; border:1px solid #2A5CDB55; color:#9DB6F5; border-radius:12px; font-size:11.5px; font-weight:600; }
  main{ max-width:1180px; margin:0 auto; padding:28px 40px 60px; }
  .section-heading{ margin:44px 0 18px; }
  .section-heading:first-of-type{ margin-top:0; }
  .section-heading h1{ font-size:17px; margin:0; display:flex; align-items:center; gap:10px; }
  .section-heading .scope{ font-size:11px; font-weight:700; letter-spacing:.04em; color:var(--accent); background:#2A5CDB14; border:1px solid #2A5CDB33; padding:2px 8px; border-radius:10px; }
  .section-heading + .kpi-row{ margin-top:0; }
  .kpi-row{ display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:34px; }
  .kpi{ background:var(--card); border:1px solid var(--line); border-radius:6px; padding:16px 18px; }
  .kpi .label{ color:var(--muted); font-size:12px; margin-bottom:6px; }
  .kpi .value{ font-size:24px; font-weight:600; }
  .kpi.pass .value{ color:var(--pass); }
  .kpi.fail .value{ color:var(--fail); }
  section{ margin-bottom:40px; }
  section > h2{ font-size:15px; font-weight:600; margin:0 0 4px 0; padding-bottom:8px; border-bottom:2px solid var(--ink); display:flex; align-items:baseline; gap:10px; }
  section > h2 .sub{ font-weight:400; color:var(--muted); font-size:12px; }
  section > p.note{ margin:8px 0 14px; font-size:12.5px; color:var(--muted); }
  table{ width:100%; border-collapse:collapse; background:var(--card); }
  table.card{ border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  th, td{ padding:9px 12px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
  th{ background:#FAFBFC; color:var(--muted); font-weight:600; font-size:11.5px; }
  th:first-child, td:first-child{ text-align:left; }
  tr:last-child td{ border-bottom:none; }
  .pill{ display:inline-block; padding:2px 8px; border-radius:10px; font-size:11.5px; font-weight:600; }
  .pill.ok{ background:var(--pass-bg); color:var(--pass); }
  .pill.warn{ background:var(--warn-bg); color:var(--warn); }
  .pill.bad{ background:var(--fail-bg); color:var(--fail); }
  details.stage{ background:var(--card); border:1px solid var(--line); border-radius:6px; margin-bottom:12px; }
  details.stage summary{ list-style:none; cursor:pointer; padding:14px 18px; display:flex; align-items:center; gap:16px; }
  details.stage summary::-webkit-details-marker{ display:none; }
  details.stage summary .caret{ color:var(--muted); font-size:11px; transition:transform .15s; }
  details.stage[open] summary .caret{ transform:rotate(90deg); }
  details.stage summary .stage-name{ font-weight:600; font-size:14px; }
  details.stage summary .stage-stats{ margin-left:auto; display:flex; gap:22px; font-size:12.5px; color:var(--muted); }
  details.stage summary .stage-stats b{ color:var(--ink); }
  details.stage .stage-body{ padding:4px 18px 18px; border-top:1px solid var(--line); }
  details.stage .stage-body h3{ font-size:12px; color:var(--muted); font-weight:600; margin:16px 0 8px; }
  details.resource-accordion-root{ background:var(--card); border:1px solid var(--line); border-radius:6px; margin-top:8px; }
  details.resource-accordion-root summary{ list-style:none; cursor:pointer; padding:12px 14px; display:flex; align-items:center; gap:10px; }
  details.resource-accordion-root summary::-webkit-details-marker{ display:none; }
  details.resource-accordion-root summary .caret{ color:var(--muted); font-size:11px; transition:transform .15s; }
  details.resource-accordion-root[open] summary .caret{ transform:rotate(90deg); }
  details.resource-accordion-root summary .section-title{ font-weight:600; color:var(--ink); }
  details.resource-accordion-root .resource-accordion-root-body{ padding:0 14px 14px; }
  details.resource-accordion{ background:var(--card); border:1px solid var(--line); border-radius:6px; margin:8px 0; }
  details.resource-accordion summary{ list-style:none; cursor:pointer; padding:11px 12px; display:flex; align-items:center; gap:12px; color:var(--muted); font-size:12.5px; }
  details.resource-accordion summary::-webkit-details-marker{ display:none; }
  details.resource-accordion summary .caret{ color:var(--muted); font-size:11px; transition:transform .15s; }
  details.resource-accordion[open] summary .caret{ transform:rotate(90deg); }
  details.resource-accordion summary .resource-title{ color:var(--ink); font-weight:700; flex:1; }
  details.resource-accordion summary .resource-count,
  details.resource-accordion summary .resource-pass,
  details.resource-accordion summary .resource-fail,
  details.resource-accordion summary .resource-rate{ font-size:11.5px; }
  details.resource-accordion .resource-accordion-body{ padding:0 14px 14px; }
  details.error-accordion{ background:var(--card); border:1px solid var(--line); border-radius:6px; margin-top:8px; }
  details.error-accordion summary{ list-style:none; cursor:pointer; padding:12px 14px; display:flex; align-items:center; gap:10px; font-size:12.5px; color:var(--muted); }
  details.error-accordion summary::-webkit-details-marker{ display:none; }
  details.error-accordion summary .caret{ color:var(--muted); font-size:11px; transition:transform .15s; }
  details.error-accordion[open] summary .caret{ transform:rotate(90deg); }
  details.error-accordion summary .error-title{ flex:1; color:var(--ink); font-weight:600; }
  details.error-accordion summary .error-count{ color:var(--muted); font-size:11px; }
  details.error-accordion .error-accordion-body{ padding:0 14px 14px; }
  details.error-accordion-wide > summary{ border-bottom:1px solid var(--line); }
  details.page-accordion{ background:var(--card); border:1px solid var(--line); border-radius:6px; margin-bottom:12px; }
  details.page-accordion summary{ list-style:none; cursor:pointer; padding:14px 18px; display:flex; align-items:center; gap:16px; }
  details.page-accordion summary::-webkit-details-marker{ display:none; }
  details.page-accordion summary .caret{ color:var(--muted); font-size:11px; transition:transform .15s; }
  details.page-accordion[open] summary .caret{ transform:rotate(90deg); }
  details.page-accordion summary .page-title{ font-weight:600; font-size:14px; }
  details.page-accordion summary .page-stats{ margin-left:auto; display:flex; align-items:center; gap:16px; font-size:12.5px; color:var(--muted); }
  details.page-accordion summary .page-stats b{ color:var(--ink); }
  details.page-accordion .page-accordion-body{ padding:4px 18px 18px; border-top:1px solid var(--line); }
  details.page-accordion .page-accordion-body h3{ font-size:12px; color:var(--muted); font-weight:600; margin:16px 0 8px; }
  details.page-accordion .page-accordion-body h3 .sub{ font-weight:400; color:var(--muted); }
  .url-cell{ max-width:420px; overflow:hidden; text-overflow:ellipsis; }
  .mix-row{ display:grid; grid-template-columns:repeat(4,1fr); gap:14px; }
  .mix-card{ background:var(--card); border:1px solid var(--line); border-radius:6px; padding:14px 16px; }
  .mix-card .label{ color:var(--muted); font-size:12px; margin-bottom:8px; }
  .bar-track{ background:#EEF0F3; border-radius:4px; height:8px; overflow:hidden; margin-bottom:8px; }
  .bar-fill{ background:var(--accent); height:100%; }
  .mix-card .value{ font-size:18px; font-weight:600; }
</style>
</head>
<body>
<header class="run">
  <h1>k6 Load Test Report</h1>
  <div class="badges">
    ${PROTOCOL_FILE ? '<span class="badge">PROTOCOL</span>' : ''}
    ${BROWSER_FILE ? '<span class="badge">BROWSER</span>' : ''}
  </div>
  <div class="meta">
    <span>Profile: <b>${esc(PROFILE_LABEL)}</b></span>
    <span>Started: <b>${esc(startedAt)}</b></span>
    <span>Finished: <b>${esc(finishedAt)}</b></span>
    <span>Duration: <b>${durationSec}s</b></span>
  </div>
</header>
<main>
  ${protocolSectionsHtml}
  ${browserSectionHtml}
</main>
</body>
</html>`;

fs.writeFileSync(OUT_FILE, html);
console.log(`\nHTML report written to ${OUT_FILE}`);