#!/usr/bin/env node
/**
 * report.js -- builds the HTML report from the raw JSON files written by
 * k6-test.js. One generator VM or many: a single machine is simply a merge
 * of one, so there is only one report format to maintain.
 *
 * USAGE
 *   node report.js --dir ./results --name endurance-run     all matching VMs
 *   node report.js gen1.json gen2.json                      explicit files
 *
 * OPTIONS
 *   --dir  <folder>  read every *.json raw summary in the folder
 *   --name <name>    only files whose REPORT_NAME matches (also names the output)
 *   --out  <prefix>  output prefix (default: <dir>/<name>-report)  -> .html + .json
 *   --each           ALSO write one HTML report per machine (<prefix>-<machine>.html)
 *
 * NO DEPENDENCIES (plain Node.js). Charts load Chart.js from a CDN when the
 * HTML is opened in a browser.
 *
 * WHAT IS EXACT AND WHAT IS NOT WHEN MERGING VMs
 *   Exact:   all counts (transactions, requests, pass/fail, status classes,
 *            dropped iterations), avg latency (count-weighted), min, max.
 *   Approx.: P90/P95/P99. Percentiles from separate machines cannot be
 *            combined exactly, so the report shows the count-weighted average
 *            and, underneath, the worst single machine ("worst ...").
 *   Cache hit/miss/backend counts come from a SAMPLE of responses (sum across
 *   machines is still a valid sample; use Hit % for the ratio).
 *   Merged Target TPS = SUM of every machine's target for that phase.
 *
 * FILE MAP
 *   1. helpers   2. read files   3. extract one run   4. merge runs
 *   5. HTML      6. main
 */
'use strict';

const fs = require('fs');
const path = require('path');

// =============================================================================
// 1. HELPERS
// =============================================================================

// Must build metric names exactly like k6-test.js does (tags sorted).
const sub = (name, tags) => `${name}{${Object.keys(tags).sort().map((k) => `${k}:${tags[k]}`).join(',')}}`;

const sum = (a) => a.reduce((s, x) => s + x, 0);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n) ? 'n/a' : Number(n).toFixed(d));
const int = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const badge = (status) => `<span class="badge ${status === 'PASS' ? 'pass' : 'fail'}">${esc(status)}</span>`;

function fmtBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return 'n/a';
    if (n < 1024) return `${n.toFixed(0)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function seconds(d) {
    let s = 0;
    String(d).replace(/(\d+)\s*(h|m|s)/g, (_, n, u) => { s += Number(n) * { h: 3600, m: 60, s: 1 }[u]; });
    return s;
}

const NET_LABELS = {
    http_req_blocked: 'Blocked (waiting for TCP/TLS connection slot)',
    http_req_connecting: 'Connecting (TCP handshake)',
    http_req_tls_handshaking: 'TLS Handshaking',
    http_req_sending: 'Sending',
    http_req_waiting: 'Waiting (TTFB)',
    http_req_receiving: 'Receiving',
};

// =============================================================================
// 2. READ FILES
// =============================================================================

function parseArgs(argv) {
    const a = { files: [], dir: null, out: null, name: null, each: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const x = argv[i];
        if (x === '--dir') a.dir = argv[++i];
        else if (x === '--out') a.out = argv[++i];
        else if (x === '--name') a.name = argv[++i];
        else if (x === '--each') a.each = true;
        else if (x === '--help' || x === '-h') a.help = true;
        else if (!x.startsWith('--')) a.files.push(x);
    }
    return a;
}

function loadRuns(args) {
    let files = args.files.slice();
    if (args.dir) {
        fs.readdirSync(args.dir).filter((f) => f.endsWith('.json')).sort()
            .forEach((f) => files.push(path.join(args.dir, f)));
    }
    const runs = [];
    files.forEach((file) => {
        let raw;
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
        if (!raw || raw.kind !== 'k6-raw-summary') return;              // skips reports / other json
        if (args.name && raw.meta.reportName !== args.name) return;
        runs.push(extractRun(raw, file));
    });
    if (!runs.length) {
        throw new Error('No k6 raw summary files found. Check --dir / --name (files are <REPORT_NAME>-<machine>.json).');
    }
    validate(runs);
    return runs;
}

function validate(runs) {
    const ids = {};
    runs.forEach((r) => {
        if (ids[r.machineId]) {
            throw new Error(`Machine id "${r.machineId}" appears twice (${ids[r.machineId]} and ${r.file}). ` +
                'Give every generator a unique K6_MACHINE_ID, or use --name to pick one run.');
        }
        ids[r.machineId] = r.file;
    });
    const shape = (r) => JSON.stringify([r.phases.map((p) => [p.name, p.duration]), r.pages.map((u) => u.id)]);
    runs.forEach((r) => {
        if (shape(r) !== shape(runs[0])) {
            throw new Error(`${r.file} ran different phases/pages than ${runs[0].file}. Only merge machines that ran the same profile.`);
        }
    });
}

// =============================================================================
// 3. EXTRACT ONE RUN  (raw k6 metrics -> plain numbers)
// =============================================================================

function extractRun(raw, file) {
    const meta = raw.meta;
    const m = raw.metrics;

    const count = (name) => (m[name] && m[name].count) || 0;
    const trend = (name) => {
        const v = m[name];
        return v && v.avg !== undefined
            ? { avg: v.avg, min: v.min, max: v.max, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'] }
            : null;                                                     // not tracked in this run -> n/a
    };
    const classes = (tags) => {
        const o = {};
        meta.statusClasses.forEach((c) => { o[c] = count(sub('status_class_count', { ...tags, class: c })); });
        return o;
    };
    const classesTotal = (list) => {
        const o = {};
        meta.statusClasses.forEach((c) => { o[c] = sum(list.map((x) => x[c])); });
        return o;
    };

    const pages = meta.urls.map((u) => ({
        id: u.id, name: u.name, url: u.url, auth: u.auth,
        transactions: count(sub('transaction_count', { page: u.id })),
        classes: classes({ page: u.id }),
    }));

    const phases = meta.phases.map((p) => {
        const s = { scenario: p.name };
        const failedM = m[sub('http_req_failed', s)];
        const net = {};
        meta.networkKeys.forEach((k) => { net[k] = trend(sub(k, s)); });
        return {
            name: p.name, targetTps: p.targetTPS, duration: p.duration, durSec: seconds(p.duration),
            reqs: count(sub('http_reqs', s)),
            transactions: count(sub('transaction_count', s)),
            dropped: count(sub('dropped_iterations', s)),
            classes: classes(s),
            dur: trend(sub('http_req_duration', s)),
            failedRate: (failedM && failedM.rate) || 0,
            dataSent: count(sub('data_sent', s)),
            dataRecv: count(sub('data_received', s)),
            iter: meta.networkMode === 'all' ? trend(sub('iteration_duration', s)) : null,
            net,
            pages: meta.urls.map((u) => {
                const t = { scenario: p.name, page: u.id };
                return {
                    id: u.id, name: u.name, url: u.url, auth: u.auth,
                    reqs: count(sub('http_reqs', t)),
                    transactions: count(sub('transaction_count', t)),
                    dur: trend(sub('http_req_duration', t)),
                    classes: classes(t),
                };
            }),
        };
    });

    const cache = meta.urls.map((u) => {
        const t = { page: u.id };
        const dirs = {};
        meta.directives.forEach((d) => { dirs[d] = count(sub('cache_control_directive_count', { page: u.id, directive: d })); });
        const extra = (meta.extraProbeHeaders || [])
            .filter((h) => !h.pages || h.pages.includes(u.id))
            .map((h) => ({
                key: h.key, label: h.label, numeric: h.numeric,
                present: count(sub('extra_header_present_count', { page: u.id, header: h.key })),
                stats: h.numeric ? trend(sub(`extra_header_${h.key}`, { page: u.id })) : null,
            }));
        return {
            id: u.id, name: u.name, url: u.url, strategy: u.strategy,
            hit: count(sub('cache_hit_count', t)), miss: count(sub('cache_miss_count', t)),
            unknown: count(sub('cache_unknown_count', t)),
            backend: count(sub('backend_response_count', t)), cacheResp: count(sub('cache_response_count', t)),
            transactions: count(sub('transaction_count', t)), probes: count(sub('probe_count', t)),
            agePresent: count(sub('age_present_count', t)), age: trend(sub('cache_age', t)),
            ccPresent: count(sub('cache_control_present_count', t)), maxAge: trend(sub('cache_control_max_age', t)),
            etag: count(sub('etag_present_count', t)), vary: count(sub('vary_present_count', t)),
            dirs, extra,
        };
    });

    return {
        file, machineId: meta.machineId, meta,
        startTime: meta.startTime, endTime: meta.endTime, durationSec: meta.durationSec,
        phases, pages, cache,
        // Probe traffic (header_probe scenario) is subtracted so totals reflect load phases only.
        reqs: Math.max(0, count('http_reqs') - count(sub('http_reqs', { scenario: meta.probe }))),
        transactions: sum(pages.map((p) => p.transactions)),
        classes: classesTotal(pages.map((p) => p.classes)),
        dropped: sum(phases.map((p) => p.dropped)),
        dur: trend('http_req_duration'),
        vusMax: (m.vus_max && m.vus_max.max) || 0,
    };
}

// =============================================================================
// 4. MERGE RUNS  (works for 1 run or many)
// =============================================================================

function mergeTrend(items) {                          // items: [{ t: trend|null, w: weight }]
    const ok = items.filter((x) => x.t);
    if (!ok.length) return null;
    const total = sum(ok.map((x) => x.w));
    const wt = (x) => (total > 0 ? x.w / total : 1 / ok.length);
    const wavg = (k) => sum(ok.map((x) => x.t[k] * wt(x)));
    const worst = (k) => Math.max(...ok.map((x) => x.t[k]));
    return {
        avg: wavg('avg'), min: Math.min(...ok.map((x) => x.t.min)), max: worst('max'),
        p90: wavg('p90'), p95: wavg('p95'), p99: wavg('p99'),
        worst: { p90: worst('p90'), p95: worst('p95'), p99: worst('p99') },
        nodes: ok.length,
    };
}

function mergeClasses(list, classNames) {
    const o = {};
    classNames.forEach((c) => { o[c] = sum(list.map((x) => x[c])); });
    return o;
}

// Static per-page setup info (same on every machine) -- what is this page, and
// exactly which response headers are being checked on it.
function buildUrlInventory(meta) {
    const ch = meta.cacheHeaders;
    const baseHeaderNames = (strategy) => {
        if (strategy === 'not-applicable' || strategy === 'not-observable') return [];
        return [ch.age, ch.cacheControl, ch.etag, ch.vary];
    };
    return meta.urls.map((u) => {
        const extra = (meta.extraProbeHeaders || []).filter((h) => !h.pages || h.pages.includes(u.id));
        const headers = baseHeaderNames(u.strategy).concat(extra.map((h) => h.header));
        let note = '';
        if (u.strategy === 'not-applicable') note = 'No CDN in front of this URL.';
        else if (u.strategy === 'not-observable') note = 'CDN cache status not visible to the client.';
        else if (!headers.length) note = 'No headers configured to check.';
        return { id: u.id, name: u.name, url: u.url, auth: !!u.auth, provider: u.provider, strategy: u.strategy, headers, note };
    });
}

function mergeAll(runs) {
    const meta0 = runs[0].meta;
    const lim = { err: meta0.maxErrorRatePct, tps: meta0.minTpsAchievementPct };
    const classNames = meta0.statusClasses;
    const failedOf = (c) => c['4xx'] + c['5xx'] + c.err;

    const phases = runs[0].phases.map((_, i) => {
        const e = runs.map((r) => r.phases[i]);
        const reqs = sum(e.map((x) => x.reqs));
        const transactions = sum(e.map((x) => x.transactions));
        const classes = mergeClasses(e.map((x) => x.classes), classNames);
        const failed = failedOf(classes);
        const targetTps = sum(e.map((x) => x.targetTps));
        const actualTps = e[0].durSec > 0 ? transactions / e[0].durSec : 0;
        const errorPct = pct(failed, reqs);
        const tpsAchievementPct = pct(actualTps, targetTps);
        const tpsOk = tpsAchievementPct >= lim.tps;
        const errOk = errorPct <= lim.err;

        const netKeys = Object.keys(NET_LABELS).filter((k) => e.some((x) => k in x.net));
        return {
            name: e[0].name, duration: e[0].duration, targetTps, actualTps, tpsAchievementPct,
            reqs, transactions, classes, failed, passed: Math.max(0, reqs - failed), errorPct,
            dropped: sum(e.map((x) => x.dropped)),
            dur: mergeTrend(e.map((x) => ({ t: x.dur, w: x.reqs }))),
            tpsOk, errOk, status: tpsOk && errOk ? 'PASS' : 'FAIL',          // dropped iterations never fail a run
            dataSent: sum(e.map((x) => x.dataSent)), dataRecv: sum(e.map((x) => x.dataRecv)),
            failedPct: pct(sum(e.map((x) => x.failedRate * x.reqs)), reqs),
            iter: mergeTrend(e.map((x) => ({ t: x.iter, w: x.reqs }))),
            net: netKeys.map((k) => ({
                key: k, label: NET_LABELS[k],
                t: mergeTrend(e.map((x) => ({ t: x.net[k] || null, w: x.reqs }))),
            })).filter((n) => n.t),
            pages: e[0].pages.map((_, j) => {
                const pe = e.map((x) => x.pages[j]);
                const pReqs = sum(pe.map((x) => x.reqs));
                const pClasses = mergeClasses(pe.map((x) => x.classes), classNames);
                const pFailed = failedOf(pClasses);
                const pErr = pct(pFailed, pReqs);
                return {
                    ...pe[0], reqs: pReqs, transactions: sum(pe.map((x) => x.transactions)), classes: pClasses,
                    dur: mergeTrend(pe.map((x) => ({ t: x.dur, w: x.reqs }))),
                    failed: pFailed, passed: Math.max(0, pReqs - pFailed), errorPct: pErr,
                    status: pErr <= lim.err ? 'PASS' : 'FAIL',
                };
            }),
        };
    });

    const reqs = sum(runs.map((r) => r.reqs));
    const transactions = sum(runs.map((r) => r.transactions));
    const classes = mergeClasses(runs.map((r) => r.classes), classNames);
    const failed = failedOf(classes);
    const durationSec = Math.max(...runs.map((r) => r.durationSec));
    const errorPct = pct(failed, reqs);
    const tpsOk = phases.every((p) => p.tpsOk);
    const errOk = errorPct <= lim.err;

    return {
        meta: {
            machineIds: runs.map((r) => r.machineId),
            reportName: meta0.reportName, profile: meta0.profile,
            startTime: runs.map((r) => r.startTime).sort()[0],
            endTime: runs.map((r) => r.endTime).sort().slice(-1)[0],
            durationSec, durationDetail: meta0.durationDetail,
            networkMode: meta0.networkMode,
            cacheSampleRatePct: meta0.cacheSampleRate * 100, probeTps: sum(runs.map((r) => r.meta.probeTps)),
            limits: lim, cacheHeaders: meta0.cacheHeaders, cacheStrategy: meta0.cacheStrategy, directives: meta0.directives,
        },
        overall: {
            reqs, transactions, classes, failed, passed: Math.max(0, reqs - failed), errorPct,
            targetTps: Math.max(...phases.map((p) => p.targetTps)),
            actualTps: durationSec > 0 ? transactions / durationSec : 0,
            dropped: sum(runs.map((r) => r.dropped)),
            dur: mergeTrend(runs.map((r) => ({ t: r.dur, w: r.reqs }))),
            vusMax: sum(runs.map((r) => r.vusMax)),
            tpsOk, errOk, status: tpsOk && errOk ? 'PASS' : 'FAIL',
        },
        phases,
        urlInventory: buildUrlInventory(meta0),
        cache: runs[0].cache.map((_, i) => mergeCache(runs.map((r) => r.cache[i]), meta0)),
        sources: runs.map((r) => ({
            machineId: r.machineId, file: r.file, startTime: r.startTime, endTime: r.endTime,
            durationSec: r.durationSec, transactions: r.transactions, dropped: r.dropped,
        })),
    };
}

function mergeCache(e, meta) {
    const base = { id: e[0].id, name: e[0].name, url: e[0].url, strategy: e[0].strategy };
    const probesAll = sum(e.map((x) => x.probes));

    // Extra headers (config.js EXTRA_PROBE_HEADERS) are independent of cache strategy, so they are
    // merged even for not-applicable / not-observable pages -- a page can have no CDN and still have
    // a custom header worth checking.
    const mergeExtra = () => (e[0].extra || []).map((_, i) => {
        const eh = e.map((x) => x.extra[i]);
        const present = sum(eh.map((x) => x.present));
        return {
            key: eh[0].key, label: eh[0].label, numeric: eh[0].numeric,
            present, pct: pct(present, probesAll),
            stats: eh[0].numeric ? mergeTrend(eh.map((x) => ({ t: x.stats, w: x.present }))) : null,
        };
    });

    if (base.strategy === 'not-applicable') return { ...base, note: 'No CDN in front of this URL -- not applicable.', extra: mergeExtra() };
    if (base.strategy === 'not-observable') return { ...base, note: 'CDN cache status is not visible to the client. Check the CDN logs / monitoring for the test window.', extra: mergeExtra() };

    const S = (k) => sum(e.map((x) => x[k]));
    const hit = S('hit'), miss = S('miss'), probes = S('probes'), ccPresent = S('ccPresent'), agePresent = S('agePresent');
    const age = mergeTrend(e.map((x) => ({ t: x.age, w: x.agePresent })));
    const maxAge = mergeTrend(e.map((x) => ({ t: x.maxAge, w: x.ccPresent })));

    // Cache-Control is rebuilt from the tracked directives: any directive seen on
    // every Cache-Control response is part of the "typical" value.
    const dirs = {};
    meta.directives.forEach((d) => { dirs[d] = sum(e.map((x) => x.dirs[d])); });
    let typical = 'n/a', consistent = true;
    if (ccPresent > 0) {
        const parts = [];
        meta.directives.forEach((d) => {
            if (!dirs[d]) return;
            if (dirs[d] < ccPresent) consistent = false;
            parts.push(d === 'max-age' ? `max-age=${fmt(maxAge && maxAge.avg, 0)}` : d);
        });
        typical = parts.length ? parts.join(', ') : 'present (no tracked directives matched)';
    }

    return {
        ...base, hit, miss, unknown: S('unknown'), hitPct: pct(hit, hit + miss),
        backend: S('backend'), cacheResp: S('cacheResp'),
        age: { present: agePresent > 0, pct: pct(agePresent, probes), stats: age },
        cc: { present: ccPresent > 0, pct: pct(ccPresent, probes), typical, consistent },
        etagPct: pct(S('etag'), probes), varyPct: pct(S('vary'), probes),
        extra: mergeExtra(),
    };
}

// =============================================================================
// 5. HTML
// =============================================================================

const CSS = `*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;margin:0;padding:24px;color:#1a1a1a;background:#f7f8fa;}
.container{max-width:1800px;margin:0 auto;}
h1{font-size:24px;margin:0 0 6px 0;}
h2{font-size:17px;margin-top:30px;margin-bottom:10px;border-bottom:2px solid #e2e4e8;padding-bottom:7px;}
h3{font-size:15px;margin:22px 0 8px 0;}
.subtitle{color:#666;margin-bottom:20px;font-size:13px;}
.alert{padding:12px 16px;border-radius:8px;margin:14px 0 20px 0;font-size:13px;}
.alert.ok{background:#d7f5df;color:#1a7d3a;}
.alert.bad{background:#fbdada;color:#ab1c1c;}
.alert .criteria{display:block;margin-top:6px;font-size:12px;opacity:0.85;}
.summary-grid{display:grid;grid-template-columns:repeat( auto-fit,minmax(170px,1fr) );gap:10px;}
.stat-card{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:12px 14px;}
.stat-card .label{color:#666;font-size:11px;}
.stat-card .value{font-size:20px;font-weight:700;margin-top:3px;}
.stat-pair{border-color:#b9d6f2;background:#f4f9ff;}
.stat-card .sub-note{color:#667;font-size:10px;margin-top:5px;line-height:1.35;}
.badge{display:inline-block;padding:3px 9px;border-radius:10px;font-weight:600;font-size:11px;}
.badge.pass{background:#d7f5df;color:#1a7d3a;}
.badge.fail{background:#fbdada;color:#ab1c1c;}
.auth-tag{display:inline-block;background:#fff3cd;color:#856404;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;margin-left:6px;vertical-align:middle;}
.yes-tag,.no-tag{display:inline-block;font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px;}
.yes-tag{background:#d7f5df;color:#1a7d3a;}
.no-tag{background:#eef0f3;color:#777;}
.header-value-cell{text-align:left;white-space:normal;min-width:220px;}
.header-value-cell .page-url{color:#666;}
.phase{background:#fff;border:1px solid #dfe2e6;border-radius:8px;margin-bottom:10px;overflow:hidden;}
.phase summary{cursor:pointer;list-style:none;padding:13px 16px;background:#fff;}
.phase summary::-webkit-details-marker{display:none;}
.phase summary::before{content:"▶";display:inline-block;font-size:10px;margin-right:9px;color:#666;transition:transform 0.15s ease;}
.phase[open]>summary::before{transform:rotate(90deg);}
.phase-title{display:inline-flex;align-items:center;gap:18px;flex-wrap:wrap;}
.phase-name{font-weight:700;font-size:14px;}
.phase-tps{color:#555;font-size:12px;}
.phase-requests{color:#555;font-size:12px;}
.phase-body{border-top:1px solid #e5e7eb;padding:14px 16px 18px;background:#fafbfc;}
.phase-summary-grid{display:grid;grid-template-columns:repeat( auto-fit,minmax(130px,1fr) );gap:8px;}
.mini-stat{background:#fff;border:1px solid #e3e5e8;border-radius:6px;padding:9px 11px;}
.mini-stat .label{color:#777;font-size:10px;}
.mini-stat .value{font-weight:700;font-size:15px;margin-top:2px;}
.table-wrapper{overflow-x:auto;}
table{border-collapse:collapse;width:100%;min-width:1100px;background:#fff;font-size:12px;}
th,td{border:1px solid #e2e4e8;padding:7px 9px;text-align:right;white-space:nowrap;}
th{background:#f0f1f4;font-weight:600;}
th:first-child,td:first-child{text-align:left;}
.page-name{font-weight:600;}
.page-url{color:#888;font-size:10px;margin-top:2px;font-weight:normal;}
.muted-note{text-align:left;color:#888;font-style:italic;white-space:normal;}
.code-note{font-size:12px;color:#666;}
.headers-checked-note{background:#fbfcfe;border:1px solid #e3e5e8;border-radius:8px;padding:12px 16px;margin:10px 0 16px 0;font-size:12px;color:#444;}
.headers-checked-title{font-weight:700;font-size:12px;color:#333;margin-bottom:6px;}
.headers-checked-note ul{margin:0;padding-left:18px;}
.headers-checked-note li{margin-bottom:6px;line-height:1.5;}
.headers-checked-note code{background:#eef1f5;border-radius:3px;padding:1px 4px;font-size:11px;}
.network-metrics{background:#fff;border:1px solid #e3e5e8;border-radius:8px;margin-top:14px;overflow:hidden;}
.network-metrics summary{cursor:pointer;list-style:none;padding:10px 14px;background:#f7f8fa;font-weight:600;font-size:13px;color:#333;}
.network-metrics summary::-webkit-details-marker{display:none;}
.network-metrics summary::before{content:"▶";display:inline-block;font-size:9px;margin-right:8px;color:#666;transition:transform 0.15s ease;}
.network-metrics[open] summary::before{transform:rotate(90deg);}
.network-body{border-top:1px solid #e5e7eb;padding:12px 14px 14px;}
.sub{color:#8a6d00;font-size:10px;font-weight:normal;margin-top:2px}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:14px}
.chart-card{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:14px 16px}
.chart-card h4{font-size:13px;margin:0 0 10px 0}
.chart-card canvas{max-height:260px}
.sources-details{background:#fff;border:1px solid #e2e4e8;border-radius:8px;margin-top:14px;overflow:hidden}
.sources-details summary{cursor:pointer;padding:10px 14px;background:#fafbfc;font-weight:600;font-size:12px;color:#444}
.sources-body{border-top:1px solid #e5e7eb;padding:10px 14px 14px}`;

// Latency cell. With several machines, the worst single machine shows underneath.
function lat(t, k, withWorst) {
    if (!t) return 'n/a';
    return fmt(t[k]) + (withWorst && t.nodes > 1 ? `<div class="sub">worst ${fmt(t.worst[k])}</div>` : '');
}

const stat = (label, value, sub, cls) => `<div class="stat-card ${cls || ''}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub-note">${sub}</div>` : ''}</div>`;
const mini = (label, value) => `<div class="mini-stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;

function pageTable(phase) {
    const rows = phase.pages.map((p) => `<tr>
<td class="page-name">${esc(p.name)}${p.auth ? ' <span class="auth-tag" title="Basic auth applied">AUTH</span>' : ''}<div class="page-url">${esc(p.url)}</div></td>
<td>${int(p.transactions)}</td><td>${int(p.reqs)}</td>
<td>${lat(p.dur, 'avg')}</td><td>${lat(p.dur, 'p90', 1)}</td><td>${lat(p.dur, 'p95', 1)}</td><td>${lat(p.dur, 'p99', 1)}</td><td>${lat(p.dur, 'max')}</td>
<td>${int(p.passed)}</td><td>${int(p.failed)}</td><td>${fmt(p.errorPct)}%</td>
<td>${int(p.classes['2xx'])}</td><td>${int(p.classes['3xx'])}</td><td>${int(p.classes['4xx'])}</td><td>${int(p.classes['5xx'])}</td>
<td>${badge(p.status)}</td></tr>`).join('');
    const heads = ['Page', 'Transactions', 'Requests', 'Avg (ms)', 'P90 (ms)', 'P95 (ms)', 'P99 (ms)', 'Max (ms)', 'Passed', 'Failed', 'Error %', '2xx', '3xx', '4xx', '5xx', 'Status'];
    return `<div class="table-wrapper"><table class="page-table"><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function networkSection(phase, c) {
    const trendRows = phase.net.map((n) => `<tr><td class="page-name">${esc(n.label)}${n.t.nodes < c.meta.machineIds.length ? ` <span class="auth-tag">${n.t.nodes}/${c.meta.machineIds.length} machines</span>` : ''}</td>
<td>${lat(n.t, 'avg')}</td><td>${lat(n.t, 'min')}</td><td>${lat(n.t, 'p90', 1)}</td><td>${lat(n.t, 'p95', 1)}</td><td>${lat(n.t, 'p99', 1)}</td><td>${lat(n.t, 'max')}</td></tr>`).join('');
    const iterRow = phase.iter ? `<tr><td class="page-name">iteration_duration</td><td>${lat(phase.iter, 'avg')}</td><td>${lat(phase.iter, 'min')}</td><td>${lat(phase.iter, 'p90', 1)}</td><td>${lat(phase.iter, 'p95', 1)}</td><td>${lat(phase.iter, 'p99', 1)}</td><td>${lat(phase.iter, 'max')}</td></tr>` : '';
    const table = (trendRows || iterRow)
        ? `<div class="table-wrapper"><table class="page-table"><thead><tr><th>Metric (ms)</th><th>Avg</th><th>Min</th><th>P90</th><th>P95</th><th>P99</th><th>Max</th></tr></thead><tbody>${trendRows}${iterRow}</tbody></table></div>`
        : `<p class="code-note">Per-phase timing metrics were switched off for this run (NETWORK_METRICS=off).</p>`;
    return `<details class="network-metrics"><summary>Network / Native k6 Metrics</summary><div class="network-body">
<div class="phase-summary-grid">${mini('Data Sent', fmtBytes(phase.dataSent))}${mini('Data Received', fmtBytes(phase.dataRecv))}${mini('HTTP Req Failed', fmt(phase.failedPct) + '%')}</div>
${table}
<p class="code-note">k6's own native per-request timing metrics, scoped to this phase. Full native metrics are in the raw .json files.</p></div></details>`;
}

function phaseSection(phase, i, c) {
    const L = c.meta.limits;
    return `<details class="phase" ${i === 0 ? 'open' : ''}><summary><div class="phase-title">
<span class="phase-name">${esc(phase.name)}</span>
<span class="phase-tps">Target: <b>${int(phase.targetTps)} TPS</b></span>
<span class="phase-tps">Actual: <b>${fmt(phase.actualTps, 1)} TPS</b></span>
<span class="phase-requests">Transactions: <b>${int(phase.transactions)}</b></span>
<span class="phase-requests">Requests: <b>${int(phase.reqs)}</b></span>
<span>${badge(phase.status)}</span></div></summary>
<div class="phase-body"><div class="phase-summary-grid">
${mini('Target TPS', int(phase.targetTps))}${mini('Actual TPS', fmt(phase.actualTps, 1))}
${mini(`TPS Achievement (fail below ${fmt(L.tps, 0)}%)`, fmt(phase.tpsAchievementPct) + '%')}
${mini('Transactions', int(phase.transactions))}${mini('Requests (incl. redirects)', int(phase.reqs))}
${mini('Dropped (does not fail run)', int(phase.dropped))}
${mini(`Error % (fail above ${fmt(L.err, 0)}%)`, fmt(phase.errorPct) + '%')}
${mini('Duration', esc(phase.duration))}${mini('Phase Status', badge(phase.status))}</div>
<h3>Page Performance</h3>
<p class="code-note">"Transactions" = one count per page request. "Requests" includes every raw HTTP hop k6 made, so it is higher on pages that redirect.</p>
${pageTable(phase)}${networkSection(phase, c)}</div></details>`;
}

function urlTable(c) {
    const code = (s) => `<code>${esc(s)}</code>`;
    const rows = c.urlInventory.map((u) => `<tr>
<td class="page-name">${esc(u.name)}</td>
<td class="page-url" style="max-width:320px;word-break:break-all;">${esc(u.url)}</td>
<td>${u.auth ? '<span class="yes-tag">YES</span>' : '<span class="no-tag">NO</span>'}</td>
<td>${esc(u.provider)}<div class="page-url">strategy: ${esc(u.strategy)}</div></td>
<td>${u.headers.length ? u.headers.map(code).join(', ') : `<span class="muted-note">${esc(u.note)}</span>`}</td>
</tr>`).join('');
    return `<div class="table-wrapper"><table><thead><tr><th>Page</th><th>Full URL</th><th>Auth Required</th><th>CDN / Cache Strategy</th><th>Response Headers Checked</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function extraHeadersTable(c) {
    const rows = [];
    c.cache.forEach((x) => {
        (x.extra || []).forEach((eh) => {
            const val = eh.numeric && eh.stats
                ? `avg ${fmt(eh.stats.avg)} &middot; range ${fmt(eh.stats.min)}&ndash;${fmt(eh.stats.max)} &middot; p95 ${fmt(eh.stats.p95)}`
                : (eh.present > 0 ? 'present (not numeric)' : 'n/a');
            rows.push(`<tr><td>${esc(x.name)}</td><td>${esc(eh.label)}</td><td>${fmt(eh.pct)}%</td><td>${val}</td></tr>`);
        });
    });
    if (!rows.length) return '';
    return `<h3>Additional Headers Checked</h3>
<p class="code-note">Headers configured in EXTRA_PROBE_HEADERS (config.js). Same low-rate probe as Age/Cache-Control above.</p>
<div class="table-wrapper"><table><thead><tr><th>Page</th><th>Header</th><th>Present %</th><th>Value</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function cacheTable(c) {
    const rows = c.cache.map((x) => {
        if (x.note) return `<tr><td>${esc(x.name)}</td><td colspan="10" class="muted-note">${esc(x.note)}</td></tr>`;
        const a = x.age.stats;
        const ageCell = x.age.present
            ? `<span class="yes-tag">YES</span><div class="page-url">avg ${fmt(a.avg, 0)}s &middot; range ${fmt(a.min, 0)}&ndash;${fmt(a.max, 0)}s &middot; p90 ${fmt(a.p90, 0)}s &middot; seen on ${fmt(x.age.pct, 0)}% of probe responses</div>`
            : '<span class="no-tag">NO</span>';
        const ccCell = x.cc.present
            ? `<span class="yes-tag">YES</span><div class="page-url">${esc(x.cc.typical)}${x.cc.consistent ? '' : ' <em>(varied across responses)</em>'} &middot; seen on ${fmt(x.cc.pct, 0)}% of probe responses</div>`
            : '<span class="no-tag">NO</span>';
        return `<tr><td>${esc(x.name)}</td><td>${int(x.hit)}</td><td>${int(x.miss)}</td><td>${fmt(x.hitPct)}%</td><td>${int(x.unknown)}</td>
<td class="header-value-cell">${ageCell}</td><td class="header-value-cell">${ccCell}</td>
<td>${fmt(x.etagPct)}%</td><td>${fmt(x.varyPct)}%</td><td>${int(x.backend)}</td><td>${int(x.cacheResp)}</td></tr>`;
    }).join('');
    const heads = ['Page', 'Cache Hit', 'Cache Miss', 'Hit %', 'Unknown', 'Age', 'Cache-Control', 'ETag %', 'Vary %', 'Backend', 'Cache Response'];
    return `<div class="table-wrapper"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function buildHtml(c) {
    const { meta, overall: o } = c;
    const L = meta.limits;
    const multi = meta.machineIds.length > 1;
    const code = (s) => `<code>${esc(s)}</code>`;
    const ch = meta.cacheHeaders;

    const statusRows = Object.entries(o.classes)
        .map(([cls, n]) => `<tr><td>${esc(cls)}</td><td>${int(n)}</td><td>${fmt(pct(n, o.reqs))}%</td></tr>`).join('');

    const sourceRows = c.sources.map((s) => `<tr><td>${esc(s.machineId)}</td><td>${esc(s.file)}</td><td>${esc(s.startTime)}</td><td>${esc(s.endTime)}</td>
<td>${fmt(s.durationSec, 0)}s</td><td>${int(s.transactions)}</td><td>${int(s.dropped)}</td></tr>`).join('');

    const chartData = {
        phases: c.phases.map((p) => p.name),
        target: c.phases.map((p) => p.targetTps),
        actual: c.phases.map((p) => +fmt(p.actualTps, 1)),
        error: c.phases.map((p) => +fmt(p.errorPct)),
        limit: L.err,
        avg: c.phases.map((p) => (p.dur ? +fmt(p.dur.avg) : null)),
        p95: c.phases.map((p) => (p.dur ? +fmt(p.dur.p95) : null)),
        p95worst: c.phases.map((p) => (p.dur ? +fmt(p.dur.worst.p95) : null)),
        multi,
        cachePages: c.cache.filter((x) => !x.note).map((x) => x.name),
        hit: c.cache.filter((x) => !x.note).map((x) => x.hit),
        miss: c.cache.filter((x) => !x.note).map((x) => x.miss),
        unknown: c.cache.filter((x) => !x.note).map((x) => x.unknown),
    };

    const detailNote = meta.durationDetail !== 'phase_url'
        ? ' <span style="color:#888;font-size:12px;">(per-page and/or per-phase latency shows n/a by design -- see DURATION_DETAIL in the script)</span>' : '';

    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>k6 Performance Test Report - ${esc(meta.reportName)}${multi ? '' : ' - ' + esc(meta.machineIds[0])}</title><style>${CSS}</style></head>
<body><div class="container">
<h1>${multi ? 'Combined ' : ''}k6 Performance Test Report</h1>
<div class="subtitle">Report: <b>${esc(meta.reportName)}</b> &middot; Machine${multi ? 's' : ''}: <b>${esc(meta.machineIds.join(', '))}</b> &middot;
Profile: <b>${esc(meta.profile)}</b> &middot; Duration detail: <b>${esc(meta.durationDetail)}</b>${detailNote} &middot;
${esc(meta.startTime)} &rarr; ${esc(meta.endTime)} &middot; Duration: <b>${fmt(meta.durationSec, 0)}s</b></div>

<div class="alert ${o.status === 'PASS' ? 'ok' : 'bad'}">
${o.status === 'PASS' ? 'Overall test completed successfully.' : 'WARNING: one or more phases breached the acceptance criteria below.'}
Actual overall throughput was ${fmt(o.actualTps, 1)} TPS across ${int(o.transactions)} transactions. Dropped iterations: ${int(o.dropped)} (informational only).
<span class="criteria">Acceptance criteria: a phase (and the overall run) FAILS only when its error rate is above ${fmt(L.err, 0)}% or its actual TPS is below ${fmt(L.tps, 0)}% of target.
Dropped iterations are reported but never fail the run.</span></div>

<h2>1. Overall Summary</h2>
<div class="summary-grid">
${stat('Total Transactions', int(o.transactions), 'Logical page requests (1 per runTest() call)', 'stat-pair')}
${stat('Total HTTP Requests', int(o.reqs), o.reqs > o.transactions ? `Includes ${int(o.reqs - o.transactions)} redirect hop(s) beyond the transactions` : 'Matches transaction count -- no redirect hops', 'stat-pair')}
${stat('Passed', int(o.passed))}${stat('Failed', int(o.failed))}
${stat(`Error Rate (fail above ${fmt(L.err, 0)}%)`, fmt(o.errorPct) + '%')}
${stat('Peak Target TPS', int(o.targetTps), multi ? 'Sum of all machines' : '')}
${stat('Overall Actual TPS', fmt(o.actualTps, 1))}
${stat('Dropped Iterations (info only)', int(o.dropped))}
${stat('Avg Latency', fmt(o.dur && o.dur.avg) + ' ms')}
${['p90', 'p95', 'p99'].map((k) => stat(k.toUpperCase(), fmt(o.dur && o.dur[k]) + ' ms', o.dur && o.dur.nodes > 1 ? `worst machine: ${fmt(o.dur.worst[k])} ms` : '')).join('')}
${stat('Max Latency', fmt(o.dur && o.dur.max) + ' ms')}
${stat(multi ? 'Max VUs (all machines)' : 'Max VUs', int(o.vusMax))}
${stat('Overall Status', badge(o.status))}
</div>
<details class="sources-details"><summary>Source runs in this report (${c.sources.length}) -- info only</summary><div class="sources-body"><div class="table-wrapper"><table>
<thead><tr><th>Machine</th><th>File</th><th>Start</th><th>End</th><th>Duration</th><th>Transactions</th><th>Dropped</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
${multi ? '<p class="code-note">Counts, avg, min and max are exact across machines. P90/P95/P99 are count-weighted averages of each machine\'s percentile; "worst" is the highest value seen on any one machine.</p>' : ''}
</div></details>

<h2>2. Pages Under Test</h2>
<p class="code-note">Every page in this run, whether it needs Basic Auth, its CDN/cache strategy, and exactly which response headers are checked on it (beyond hit/miss counting, which runs on every sampled request regardless).</p>
${urlTable(c)}

<h2>3. Phase-wise Breakdown</h2>
<p class="code-note">Each phase shows its TPS and status, then response time and HTTP status per page. Pages tagged <span class="auth-tag">AUTH</span> use HTTP Basic Auth. Expand a phase for detail.</p>
${c.phases.map((p, i) => phaseSection(p, i, c)).join('')}

<h2>4. Visual Overview</h2>
<div class="chart-grid">
<div class="chart-card"><h4>Target vs Actual TPS per phase</h4><canvas id="tpsChart"></canvas></div>
<div class="chart-card"><h4>Error % per phase (fail line at ${fmt(L.err, 0)}%)</h4><canvas id="errorChart"></canvas></div>
<div class="chart-card"><h4>Latency per phase (ms)${multi ? ' -- avg / P95 weighted / P95 worst machine' : ' -- avg / P95'}</h4><canvas id="latencyChart"></canvas></div>
<div class="chart-card"><h4>Cache Hit / Miss / Unknown by page (sampled)</h4><canvas id="cacheChart"></canvas></div>
</div>

<h2>5. Overall HTTP Status Distribution</h2>
<div class="table-wrapper"><table><thead><tr><th>HTTP Class</th><th>Count</th><th>% Distribution</th></tr></thead><tbody>${statusRows}</tbody></table></div>

<h2>6. Cache / Backend Breakdown</h2>
<p class="code-note">Hit / Miss / Unknown come from the configured CDN status headers or, for GCP Cloud CDN (no status header), from the Age header (Age &gt; 0 = served from cache).
They are counted on a random sample of responses (${fmt(meta.cacheSampleRatePct, 1)}% of requests), so raw counts are smaller than transaction totals -- use the Hit % column for the ratio.
Age / Cache-Control / ETag / Vary come from a low-rate <code>header_probe</code> (${fmt(meta.probeTps, 1)} req/s across all pages) because those values are static per page.
Age shows the observed range (it changes per request); Cache-Control shows its reconstructed directives.</p>
<div class="headers-checked-note"><div class="headers-checked-title">Response headers compared for this section</div><ul>
<li><b>Hit/miss status headers</b> (first match wins): ${ch.status.map(code).join(', ')} -- a value containing "hit" or "miss" classifies the response. Used for strategy <code>header</code>.</li>
<li><b>Age</b>: ${code(ch.age)} -- hit/miss signal for strategy <code>gcp-age</code> (Age &gt; 0 = hit); its value range is always recorded.</li>
<li><b>Cache-Control</b>: ${code(ch.cacheControl)} -- directives ${meta.directives.map(code).join(', ')} and numeric <code>max-age</code>.</li>
<li><b>ETag</b>: ${code(ch.etag)} and <b>Vary</b>: ${code(ch.vary)} -- presence only.</li>
<li><b>Custom indicators</b>: ${code(ch.backend)} and ${code(ch.cacheResponse)} -- counted when the value is exactly "true".</li>
<li><b>Provider &rarr; strategy</b>: ${Object.entries(meta.cacheStrategy).map(([p, s]) => `${code(p)} &rarr; ${code(s)}`).join(', ')} (unlisted providers use <code>header</code>).</li>
</ul></div>
${cacheTable(c)}
${extraHeadersTable(c)}

<h2>7. Native k6 Metrics</h2>
<p class="code-note">Per-phase timing breakdowns are under "Network / Native k6 Metrics" inside each phase above. Every native k6 metric is kept in the raw
<code>.json</code> files next to this report. No per-request records are stored.</p>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
const D = ${JSON.stringify(chartData).replace(/</g, '\\u003c')};
if (window.Chart) {
  const mk = (id, cfg) => new Chart(document.getElementById(id), cfg);
  const opt = { responsive: true, maintainAspectRatio: true, scales: { y: { beginAtZero: true } } };
  mk('tpsChart', { type: 'bar', data: { labels: D.phases, datasets: [
    { label: 'Target TPS', data: D.target, backgroundColor: '#b9d6f2' },
    { label: 'Actual TPS', data: D.actual, backgroundColor: '#2f7fd1' } ] }, options: opt });
  mk('errorChart', { type: 'bar', data: { labels: D.phases, datasets: [
    { label: 'Error %', data: D.error, backgroundColor: '#e5726f' },
    { label: 'Fail limit', data: D.phases.map(() => D.limit), type: 'line', borderColor: '#ab1c1c', borderDash: [6, 4], pointRadius: 0 } ] }, options: opt });
  const latSets = [ { label: 'Avg', data: D.avg, backgroundColor: '#9ad3a6' }, { label: D.multi ? 'P95 (weighted)' : 'P95', data: D.p95, backgroundColor: '#f2b84b' } ];
  if (D.multi) latSets.push({ label: 'P95 (worst machine)', data: D.p95worst, backgroundColor: '#e5726f' });
  mk('latencyChart', { type: 'bar', data: { labels: D.phases, datasets: latSets }, options: opt });
  mk('cacheChart', { type: 'bar', data: { labels: D.cachePages, datasets: [
    { label: 'Hit', data: D.hit, backgroundColor: '#5cb874' }, { label: 'Miss', data: D.miss, backgroundColor: '#e5726f' },
    { label: 'Unknown', data: D.unknown, backgroundColor: '#c4c8cf' } ] },
    options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } });
} else {
  document.querySelectorAll('.chart-card').forEach((el) => el.insertAdjacentHTML('beforeend', '<p class="code-note">Charts need internet access to load Chart.js.</p>'));
}
</script>
</body></html>`;
}

// =============================================================================
// 6. MAIN
// =============================================================================

function help() {
    console.log(`Usage:
  node report.js --dir <folder> [--name <REPORT_NAME>] [--out <prefix>] [--each]
  node report.js file1.json file2.json ...

  --dir   folder with the raw <REPORT_NAME>-<machine>.json files from k6-test.js
  --name  only use files of this REPORT_NAME (also names the output)
  --out   output prefix (default <dir>/<name>-report)  ->  .html and .json
  --each  also write one HTML report per machine`);
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || (!args.files.length && !args.dir)) { help(); process.exit(args.help ? 0 : 1); }

    const runs = loadRuns(args);
    const prefix = args.out || path.join(args.dir || '.', `${args.name || runs[0].meta.reportName}-report`);
    fs.mkdirSync(path.dirname(prefix) || '.', { recursive: true });

    const combined = mergeAll(runs);
    fs.writeFileSync(`${prefix}.html`, buildHtml(combined));
    fs.writeFileSync(`${prefix}.json`, JSON.stringify({ kind: 'k6-combined-report', ...combined }, null, 2));
    console.log(`Machines merged: ${combined.meta.machineIds.join(', ')}`);
    console.log(`Report written:  ${prefix}.html  (+ ${prefix}.json)`);

    if (args.each) {
        runs.forEach((r) => {
            const file = `${prefix}-${r.machineId.replace(/[^A-Za-z0-9._-]/g, '_')}.html`;
            fs.writeFileSync(file, buildHtml(mergeAll([r])));
            console.log(`Per-machine:     ${file}`);
        });
    }

    const o = combined.overall;
    console.log(`\nOverall: ${o.status} | ${int(o.transactions)} transactions | ${fmt(o.actualTps, 1)} TPS | error ${fmt(o.errorPct)}% | dropped ${int(o.dropped)}`);
    combined.phases.forEach((p) => console.log(`  ${p.status}  ${p.name}: ${fmt(p.actualTps, 1)}/${int(p.targetTps)} TPS (${fmt(p.tpsAchievementPct, 0)}%), error ${fmt(p.errorPct)}%`));
}

try { main(); } catch (e) { console.error(`\nERROR: ${e.message}`); process.exit(1); }
