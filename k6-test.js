/**
 * k6-test.js -- the load generator. It only does three things:
 *   1. builds the load phases from config.js,
 *   2. fires requests and counts results (with tags, so the report can slice
 *      by phase / page / status),
 *   3. dumps the raw k6 metrics to <name>-<machine>.json when the test ends.
 * It creates NO report. `node report.js` turns the JSON files into HTML.
 *
 * RUN:   k6 run k6-test.js -e RUN_PROFILE=smoke
 * FLAGS: RUN_PROFILE  smoke|load|stress|spike|endurance|endurance15k  [smoke]
 *        K6_MACHINE_ID  unique per generator VM                        [hostname]
 *        REPORT_NAME    same on every VM of one run                    [k6-report]
 *        REPORT_DIR     folder for the JSON file -- CREATE IT FIRST    [.]
 *        BASIC_AUTH_USER / BASIC_AUTH_PASS   for pages with auth: true
 *        DURATION_DETAIL / NETWORK_METRICS   override the profile's memory settings
 */
import http from 'k6/http';
import exec from 'k6/execution';
import encoding from 'k6/encoding';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
import { URLS, PROFILES, SETTINGS, CACHE_STRATEGY, CACHE_HEADERS, EXTRA_PROBE_HEADERS } from './config.js';

// ----------------------------------------------------------------------------
// 1. Run settings
// ----------------------------------------------------------------------------
const PROFILE_NAME = __ENV.RUN_PROFILE || 'smoke';
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) throw new Error(`RUN_PROFILE must be one of ${Object.keys(PROFILES).join('|')}, got "${PROFILE_NAME}"`);

const MACHINE_ID = __ENV.K6_MACHINE_ID || __ENV.HOSTNAME || __ENV.COMPUTERNAME || 'gen1';   // HOSTNAME = Linux/Mac, COMPUTERNAME = Windows
const REPORT_NAME = __ENV.REPORT_NAME || 'k6-report';
const REPORT_DIR = (__ENV.REPORT_DIR || '.').replace(/[\\/]+$/, '');
const FILE_NAME = `${REPORT_NAME}-${MACHINE_ID.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const JSON_FILE = `${REPORT_DIR}/${FILE_NAME}.json`;
const BACKUP_FILE = `${FILE_NAME}.json.bak`;      // safety copy in the current folder (see handleSummary)

const DURATION_DETAIL = __ENV.DURATION_DETAIL || PROFILE.durationDetail; // phase_url | phase | summary
const NETWORK_MODE = __ENV.NETWORK_METRICS || PROFILE.networkMetrics;    // all | core | off
if (!['phase_url', 'phase', 'summary'].includes(DURATION_DETAIL)) throw new Error(`Bad DURATION_DETAIL "${DURATION_DETAIL}"`);
if (!['all', 'core', 'off'].includes(NETWORK_MODE)) throw new Error(`Bad NETWORK_METRICS "${NETWORK_MODE}"`);

const PHASES = PROFILE.phases;
const PROBE = 'header_probe';
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'err'];
const DIRECTIVES = ['no-store', 'no-cache', 'private', 'public', 'must-revalidate', 'immutable', 's-maxage', 'max-age'];
const NET_KEYS = {
    all: ['http_req_blocked', 'http_req_connecting', 'http_req_tls_handshaking', 'http_req_sending', 'http_req_waiting', 'http_req_receiving'],
    core: ['http_req_blocked', 'http_req_waiting'],
    off: [],
}[NETWORK_MODE];

EXTRA_PROBE_HEADERS.forEach((h) => {
    if (!/^[A-Za-z0-9_]+$/.test(h.key)) throw new Error(`EXTRA_PROBE_HEADERS: key "${h.key}" must be letters/numbers/underscore only`);
});
const extraKeys = EXTRA_PROBE_HEADERS.map((h) => h.key);
if (new Set(extraKeys).size !== extraKeys.length) throw new Error('EXTRA_PROBE_HEADERS: keys must be unique');

const MAX_TPS = Math.max(...PHASES.map((p) => p.targetTPS));
const SAMPLE_RATE = Math.min(1, SETTINGS.cacheSamplesPerSec / MAX_TPS);

// 4xx/5xx count as failed requests.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }));

// Metric name with tags, e.g. sub('http_reqs', {scenario:'a', page:'b'}).
// Tags are sorted so k6 and report.js always build the identical string.
function sub(name, tags) {
    return `${name}{${Object.keys(tags).sort().map((k) => `${k}:${tags[k]}`).join(',')}}`;
}

function seconds(d) {
    let s = 0;
    String(d).replace(/(\d+)\s*(h|m|s)/g, (_, n, u) => { s += Number(n) * { h: 3600, m: 60, s: 1 }[u]; });
    if (!s) throw new Error(`Cannot parse duration "${d}"`);
    return s;
}

// ----------------------------------------------------------------------------
// 2. URL table (built once; nothing is computed per request)
// ----------------------------------------------------------------------------
function authHeader(u) {
    if (!u.auth) return null;
    const c = u.auth === true ? { username: __ENV.BASIC_AUTH_USER, password: __ENV.BASIC_AUTH_PASS } : u.auth;
    if (!c.username) throw new Error(`Page "${u.id}" has auth but BASIC_AUTH_USER / BASIC_AUTH_PASS are not set`);
    return 'Basic ' + encoding.b64encode(`${c.username}:${c.password || ''}`);
}

const TABLE = (() => {
    const total = URLS.reduce((s, u) => s + u.weight, 0);
    let cum = 0;
    return URLS.map((u) => {
        cum += u.weight;
        const headers = Object.assign({}, u.headers || {});
        if (SETTINGS.acceptEncoding !== 'none') headers['Accept-Encoding'] = SETTINGS.acceptEncoding;
        if (authHeader(u)) headers.Authorization = authHeader(u);
        const classTags = {};
        STATUS_CLASSES.forEach((c) => { classTags[c] = { page: u.id, class: c }; });
        return {
            ...u,
            cum: cum / total,
            method: u.method || 'GET',
            body: u.body || null,
            strategy: CACHE_STRATEGY[u.provider] || 'header',
            tagPage: { page: u.id },
            classTags,
            params: { tags: { page: u.id }, responseType: 'none', headers },
            probeParams: { tags: { page: '__probe' }, responseType: 'none', headers },
        };
    });
})();

function pickUrl() {
    const r = Math.random();
    for (let i = 0; i < TABLE.length; i++) if (r <= TABLE[i].cum) return TABLE[i];
    return TABLE[TABLE.length - 1];
}

// ----------------------------------------------------------------------------
// 3. Custom metrics (counters only -- no per-request data is kept)
// ----------------------------------------------------------------------------
const C = {};
[
    'status_class_count', 'transaction_count',                              // every request
    'cache_hit_count', 'cache_miss_count', 'cache_unknown_count',           // sampled
    'backend_response_count', 'cache_response_count',                       // sampled
    'probe_count', 'age_present_count', 'cache_control_present_count',      // probe only
    'etag_present_count', 'vary_present_count', 'cache_control_directive_count',
].forEach((n) => { C[n] = new Counter(n); });
const cacheAge = new Trend('cache_age', true);                              // probe only
const cacheMaxAge = new Trend('cache_control_max_age', true);               // probe only
C.extra_header_present_count = new Counter('extra_header_present_count');   // probe only, any extra header
const extraTrend = {};                                                      // one Trend per numeric extra header (created once, at init)
EXTRA_PROBE_HEADERS.filter((h) => h.numeric).forEach((h) => { extraTrend[h.key] = new Trend(`extra_header_${h.key}`, true); });

// ----------------------------------------------------------------------------
// 4. Scenarios: one constant-rate scenario per phase, back to back,
//    plus the low-rate header probe running across the whole test.
// ----------------------------------------------------------------------------
function buildScenarios() {
    const sc = {};
    let start = 0;
    PHASES.forEach((p) => {
        if (!p.preAllocatedVUs || !p.maxVUs) throw new Error(`Phase "${p.name}" needs preAllocatedVUs and maxVUs in config.js`);
        sc[p.name] = {
            executor: 'constant-arrival-rate', exec: 'runTest',
            rate: p.targetTPS, timeUnit: '1s', duration: p.duration,
            preAllocatedVUs: p.preAllocatedVUs, maxVUs: p.maxVUs,
            gracefulStop: SETTINGS.gracefulStop, startTime: `${start}s`,
        };
        start += seconds(p.duration);
    });
    if (SETTINGS.probeTps > 0) {
        sc[PROBE] = {
            executor: 'constant-arrival-rate', exec: 'runProbe',
            rate: SETTINGS.probeTps, timeUnit: '1s', duration: `${start}s`,
            preAllocatedVUs: 2, maxVUs: 10, gracefulStop: '5s', startTime: '0s',
        };
    }
    return sc;
}

// k6 only puts tagged sub-series (per phase / per page) into the end-of-test
// data if a threshold names them. These thresholds always pass (>=0); they
// exist purely to make k6 keep those series for the report.
function buildThresholds() {
    const th = {};
    const keep = (name, expr) => { th[name] = [expr || 'count>=0']; };
    const ids = URLS.map((u) => u.id);
    const perPage = ['http_reqs', 'transaction_count', 'cache_hit_count', 'cache_miss_count', 'cache_unknown_count',
        'backend_response_count', 'cache_response_count', 'probe_count', 'age_present_count',
        'cache_control_present_count', 'etag_present_count', 'vary_present_count'];

    keep(sub('http_reqs', { scenario: PROBE }));           // lets the report subtract probe traffic

    ids.forEach((id) => {
        perPage.forEach((n) => keep(sub(n, { page: id })));
        keep(sub('http_req_failed', { page: id }), 'rate>=0');
        keep(sub('cache_age', { page: id }), 'avg>=0');
        keep(sub('cache_control_max_age', { page: id }), 'avg>=0');
        STATUS_CLASSES.forEach((c) => keep(sub('status_class_count', { page: id, class: c })));
        DIRECTIVES.forEach((d) => keep(sub('cache_control_directive_count', { page: id, directive: d })));
        EXTRA_PROBE_HEADERS.filter((h) => !h.pages || h.pages.includes(id)).forEach((h) => {
            keep(sub('extra_header_present_count', { page: id, header: h.key }));
            if (h.numeric) keep(sub(`extra_header_${h.key}`, { page: id }), 'avg>=0');
        });
    });

    PHASES.forEach((p) => {
        const s = { scenario: p.name };
        ['http_reqs', 'transaction_count', 'iterations', 'dropped_iterations', 'data_sent', 'data_received']
            .forEach((n) => keep(sub(n, s)));
        keep(sub('http_req_failed', s), 'rate>=0');
        if (DURATION_DETAIL !== 'summary') keep(sub('http_req_duration', s), 'p(99)>=0');
        if (NETWORK_MODE === 'all') keep(sub('iteration_duration', s), 'p(99)>=0');
        NET_KEYS.forEach((k) => keep(sub(k, s), 'p(99)>=0'));
        STATUS_CLASSES.forEach((c) => keep(sub('status_class_count', { scenario: p.name, class: c })));

        ids.forEach((id) => {
            keep(sub('http_reqs', { scenario: p.name, page: id }));
            keep(sub('transaction_count', { scenario: p.name, page: id }));
            if (DURATION_DETAIL === 'phase_url') keep(sub('http_req_duration', { scenario: p.name, page: id }), 'p(99)>=0');
            STATUS_CLASSES.forEach((c) => keep(sub('status_class_count', { scenario: p.name, page: id, class: c })));
        });
    });
    return th;
}

export const options = {
    scenarios: buildScenarios(),
    thresholds: buildThresholds(),
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    discardResponseBodies: true,
};

export function setup() {
    console.log(`[k6] profile=${PROFILE_NAME} machine=${MACHINE_ID} durationDetail=${DURATION_DETAIL} ` +
        `network=${NETWORK_MODE} cacheSample=${(SAMPLE_RATE * 100).toFixed(1)}% file=${JSON_FILE}`);
    PHASES.forEach((p) => console.log(`[k6]   ${p.name}: ${p.targetTPS} TPS for ${p.duration}, VUs ${p.preAllocatedVUs}/${p.maxVUs}`));
}

// ----------------------------------------------------------------------------
// 5. The test itself (runs once per arrival -- keep it tiny)
// ----------------------------------------------------------------------------
function statusClass(s) {
    if (s === 0) return 'err';
    if (s < 300) return '2xx';
    if (s < 400) return '3xx';
    if (s < 500) return '4xx';
    return '5xx';
}

export function runTest() {
    const u = pickUrl();
    C.transaction_count.add(1, u.tagPage);                        // 1 per page request (redirect hops not counted)
    const res = http.request(u.method, u.url, u.body, u.params);
    C.status_class_count.add(1, u.classTags[statusClass(res.status)]);
    if (SAMPLE_RATE >= 1 || Math.random() < SAMPLE_RATE) recordCache(res, u);
}

// k6 exposes header names in Go canonical form ("ETag" -> "Etag").
const canon = (n) => n.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
const HK = {
    age: canon(CACHE_HEADERS.age),
    backend: canon(CACHE_HEADERS.backend),
    cacheResp: canon(CACHE_HEADERS.cacheResponse),
    status: CACHE_HEADERS.status.map(canon),
};

// Sampled: hit/miss + backend/cache indicator headers (direct lookups, cheap).
function recordCache(res, u) {
    if (u.strategy === 'not-applicable' || u.strategy === 'not-observable') return;
    const h = res.headers;

    if (u.strategy === 'gcp-age') {
        const age = h[HK.age] !== undefined ? parseFloat(h[HK.age]) : NaN;
        if (isNaN(age)) C.cache_unknown_count.add(1, u.tagPage);
        else if (age > 0) C.cache_hit_count.add(1, u.tagPage);
        else C.cache_miss_count.add(1, u.tagPage);
    } else {
        let done = false;
        for (let i = 0; i < HK.status.length && !done; i++) {
            const v = h[HK.status[i]] === undefined ? '' : String(h[HK.status[i]]).toLowerCase();
            if (v.includes('hit')) { C.cache_hit_count.add(1, u.tagPage); done = true; }
            else if (v.includes('miss')) { C.cache_miss_count.add(1, u.tagPage); done = true; }
        }
        if (!done) C.cache_unknown_count.add(1, u.tagPage);
    }

    if (String(h[HK.backend]).toLowerCase() === 'true') C.backend_response_count.add(1, u.tagPage);
    if (String(h[HK.cacheResp]).toLowerCase() === 'true') C.cache_response_count.add(1, u.tagPage);
}

// ----------------------------------------------------------------------------
// 6. Header probe: low rate, round-robin over pages, full header detail.
//    (Cache-Control / ETag / Vary / Age values are static per page.)
// ----------------------------------------------------------------------------
function headerCI(h, name) {                       // case-insensitive lookup
    const want = name.toLowerCase();
    for (const k in h) if (k.toLowerCase() === want) return h[k];
    return undefined;
}

const warned = {};
function warnIfKeyMissed(h, name, key) {           // safety net: never silently under-count
    if (!warned[name] && headerCI(h, name) !== undefined && h[key] === undefined) {
        warned[name] = true;
        console.warn(`[k6] header "${name}" exists but not under key "${key}" -- sampled cache counts will be low`);
    }
}

// A page is probed if it has a cache strategy to check (Age/Cache-Control/ETag/Vary) OR
// at least one EXTRA_PROBE_HEADERS entry applies to it -- extra headers are independent of
// caching, so e.g. a direct-bucket page (no CDN) can still be probed for a custom header.
const cacheProbeApplies = (strategy) => strategy !== 'not-applicable' && strategy !== 'not-observable';
const extraFor = (id) => EXTRA_PROBE_HEADERS.filter((h) => !h.pages || h.pages.includes(id));
const PROBE_TABLE = TABLE.filter((u) => cacheProbeApplies(u.strategy) || extraFor(u.id).length > 0);

export function runProbe() {
    if (!PROBE_TABLE.length) return;
    const u = PROBE_TABLE[exec.scenario.iterationInTest % PROBE_TABLE.length];
    const h = http.request(u.method, u.url, u.body, u.probeParams).headers;
    const t = u.tagPage;
    C.probe_count.add(1, t);

    if (cacheProbeApplies(u.strategy)) {
        warnIfKeyMissed(h, CACHE_HEADERS.age, HK.age);
        warnIfKeyMissed(h, CACHE_HEADERS.backend, HK.backend);
        warnIfKeyMissed(h, CACHE_HEADERS.cacheResponse, HK.cacheResp);
        CACHE_HEADERS.status.forEach((n, i) => warnIfKeyMissed(h, n, HK.status[i]));

        const age = parseFloat(headerCI(h, CACHE_HEADERS.age));
        if (!isNaN(age)) { C.age_present_count.add(1, t); cacheAge.add(age, t); }
        if (headerCI(h, CACHE_HEADERS.etag)) C.etag_present_count.add(1, t);
        if (headerCI(h, CACHE_HEADERS.vary)) C.vary_present_count.add(1, t);

        const cc = headerCI(h, CACHE_HEADERS.cacheControl);
        if (cc !== undefined) {
            C.cache_control_present_count.add(1, t);
            String(cc).toLowerCase().split(',').map((d) => d.trim()).filter(Boolean).forEach((d) => {
                const [name, val] = d.split('=');
                if (DIRECTIVES.includes(name)) C.cache_control_directive_count.add(1, { page: u.id, directive: name });
                if (name === 'max-age' && !isNaN(parseFloat(val))) cacheMaxAge.add(parseFloat(val), t);
            });
        }
    }

    // Any other headers configured in EXTRA_PROBE_HEADERS (config.js) -- generic, not cache-specific,
    // and checked regardless of this page's cache strategy.
    extraFor(u.id).forEach((eh) => {
        const val = headerCI(h, eh.header);
        if (val === undefined) return;
        C.extra_header_present_count.add(1, { page: u.id, header: eh.key });
        if (eh.numeric) {
            const num = parseFloat(val);
            if (!isNaN(num)) extraTrend[eh.key].add(num, t);
        }
    });
}

// ----------------------------------------------------------------------------
// 7. End of test: save the raw metrics. All calculation happens in report.js.
// ----------------------------------------------------------------------------
export function handleSummary(data) {
    const values = {};                              // keep only each metric's numbers (small file)
    const topLevel = {};                            // console summary: skip the thousands of tagged sub-series
    for (const name in data.metrics) {
        values[name] = data.metrics[name].values;
        if (name.indexOf('{') === -1) topLevel[name] = data.metrics[name];
    }

    const ms = (data.state && data.state.testRunDurationMs) || 0;
    const end = new Date();
    const raw = {
        kind: 'k6-raw-summary',
        meta: {
            machineId: MACHINE_ID,
            reportName: REPORT_NAME,
            profile: PROFILE_NAME,
            startTime: new Date(end.getTime() - ms).toISOString(),
            endTime: end.toISOString(),
            durationSec: ms / 1000,
            phases: PHASES,
            urls: TABLE.map((u) => ({ id: u.id, name: u.name || u.id, url: u.url, provider: u.provider, strategy: u.strategy, auth: !!u.auth })),
            durationDetail: DURATION_DETAIL,
            networkMode: NETWORK_MODE,
            networkKeys: NET_KEYS,
            probe: PROBE,
            probeTps: SETTINGS.probeTps,
            cacheSampleRate: SAMPLE_RATE,
            maxErrorRatePct: SETTINGS.maxErrorRatePct,
            minTpsAchievementPct: SETTINGS.minTpsAchievementPct,
            statusClasses: STATUS_CLASSES,
            directives: DIRECTIVES,
            cacheHeaders: CACHE_HEADERS,
            cacheStrategy: CACHE_STRATEGY,
            extraProbeHeaders: EXTRA_PROBE_HEADERS,
        },
        metrics: values,
    };

    // k6 cannot create folders. If REPORT_DIR does not exist the main file is lost,
    // so a copy (.json.bak) is ALWAYS written to the current folder as well.
    const json = JSON.stringify(raw);
    const files = { [JSON_FILE]: json };
    if (REPORT_DIR !== '.') files[BACKUP_FILE] = json;

    return {
        ...files,
        stdout: textSummary({ ...data, metrics: topLevel }, { indent: ' ', enableColors: true }) +
            `\nRaw metrics file: ${JSON_FILE}   (safety copy: ${BACKUP_FILE})\n` +
            `If k6 printed "could not open" above, the folder ${REPORT_DIR} does not exist -- use the .json.bak copy.\n` +
            `Next: node report.js --dir ${REPORT_DIR} --name ${REPORT_NAME}\n`,
    };
}
