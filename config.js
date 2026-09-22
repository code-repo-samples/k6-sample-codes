/**
 * config.js -- EVERYTHING you normally edit lives in this file.
 * k6-test.js is the engine and should rarely need touching.
 *
 *   1. URLS      pages to hit and how often
 *   2. PROFILES  load shapes (phases) selected with  -e RUN_PROFILE=<name>
 *   3. SETTINGS  pass/fail limits, sampling, headers
 */

// -----------------------------------------------------------------------------
// 1. URLS
// -----------------------------------------------------------------------------
//   id        short unique name (used in metric tags and the report)
//   weight    share of traffic (1/1/1 = one third each)
//   provider  picks how cache hit/miss is detected -- see CACHE_STRATEGY below
//   auth      optional: true (uses BASIC_AUTH_USER / BASIC_AUTH_PASS env vars)
//                       or { username, password }
//   headers   optional extra request headers for this page only
export const URLS = [
    { id: 'homepage',  name: 'Homepage',  url: 'http://localhost:8000/page1', method: 'GET', weight: 1, provider: 'gcp-cdn' },
    { id: 'faq',       name: 'FAQ',       url: 'http://localhost:8000/page2', method: 'GET', weight: 1, provider: 'gcp-cdn' },
    { id: 'contactus', name: 'ContactUs', url: 'http://localhost:8000/page3', method: 'GET', weight: 1, provider: 'gcp-cdn' },
];

// -----------------------------------------------------------------------------
// 2. PROFILES   (pick with:  k6 run k6-test.js -e RUN_PROFILE=endurance)
// -----------------------------------------------------------------------------
// Each phase runs one after another. targetTPS is PER GENERATOR VM:
// 2 VMs x 10000 = 20000 TPS in total.
//
// preAllocatedVUs / maxVUs are REQUIRED. The numbers below are PLACEHOLDERS
// (assume ~100 ms latency):   preAllocatedVUs = ceil(TPS x p95_seconds)
//                             maxVUs          = about 1.3 x preAllocatedVUs
// Replace them with real values after a stress-profile calibration run.
//
// durationDetail (memory vs. detail -- k6 keeps every latency sample in RAM):
//   phase_url = latency per phase AND per page   (fine up to ~1-2 h)
//   phase     = latency per phase only
//   summary   = overall latency only              (use for long soaks)
// networkMetrics: all | core | off   (blocked/connecting/tls/... per phase)
export const PROFILES = {

    // Tiny sanity check (~20 s). Run this first to prove script + target work.
    smoke: {
        durationDetail: 'phase_url', networkMetrics: 'all',
        phases: [
            { name: 'phase_4tps',  targetTPS: 4,  duration: '5s', preAllocatedVUs: 10, maxVUs: 15 },
            { name: 'phase_10tps', targetTPS: 10, duration: '5s', preAllocatedVUs: 10, maxVUs: 15 },
            { name: 'phase_20tps', targetTPS: 20, duration: '5s', preAllocatedVUs: 10, maxVUs: 20 },
            { name: 'phase_50tps', targetTPS: 50, duration: '5s', preAllocatedVUs: 15, maxVUs: 25 },
        ],
    },

    // 1 h at one steady level.
    load: {
        durationDetail: 'phase_url', networkMetrics: 'all',
        phases: [
            { name: 'load_steady', targetTPS: 5000, duration: '1h', preAllocatedVUs: 500, maxVUs: 650 },
        ],
    },

    // 1 h, rising steps to find the breaking point of ONE VM.
    // Watch error % and dropped_iterations: where they start climbing is
    // the per-VM ceiling.
    stress: {
        durationDetail: 'phase_url', networkMetrics: 'core',
        phases: [
            { name: 'step_5000tps',  targetTPS: 5000,  duration: '10m', preAllocatedVUs: 500,  maxVUs: 650 },
            { name: 'step_10000tps', targetTPS: 10000, duration: '10m', preAllocatedVUs: 1000, maxVUs: 1300 },
            { name: 'step_15000tps', targetTPS: 15000, duration: '10m', preAllocatedVUs: 1500, maxVUs: 1950 },
            { name: 'step_20000tps', targetTPS: 20000, duration: '10m', preAllocatedVUs: 2000, maxVUs: 2600 },
            { name: 'step_25000tps', targetTPS: 25000, duration: '10m', preAllocatedVUs: 2500, maxVUs: 3250 },
            { name: 'step_30000tps', targetTPS: 30000, duration: '10m', preAllocatedVUs: 3000, maxVUs: 3900 },
        ],
    },

    // ~2 h, sharp bursts off a baseline.
    spike: {
        durationDetail: 'phase_url', networkMetrics: 'core',
        phases: [
            { name: 'baseline_1',    targetTPS: 2000,  duration: '20m', preAllocatedVUs: 200,  maxVUs: 300 },
            { name: 'spike_1',       targetTPS: 20000, duration: '3m',  preAllocatedVUs: 2000, maxVUs: 3000 },
            { name: 'baseline_2',    targetTPS: 2000,  duration: '20m', preAllocatedVUs: 200,  maxVUs: 300 },
            { name: 'spike_2',       targetTPS: 20000, duration: '3m',  preAllocatedVUs: 2000, maxVUs: 3000 },
            { name: 'baseline_3',    targetTPS: 2000,  duration: '20m', preAllocatedVUs: 200,  maxVUs: 300 },
            { name: 'spike_3',       targetTPS: 20000, duration: '3m',  preAllocatedVUs: 2000, maxVUs: 3000 },
            { name: 'recover_final', targetTPS: 2000,  duration: '20m', preAllocatedVUs: 200,  maxVUs: 300 },
        ],
    },

    // 5 h soak at 10k TPS per VM.
    endurance: {
        durationDetail: 'summary', networkMetrics: 'off',
        phases: [
            { name: 'endurance_10k', targetTPS: 10000, duration: '5h', preAllocatedVUs: 1100, maxVUs: 1500 },
        ],
    },

    // 5 h soak at 15k TPS per VM (needs a big VM -- confirm with a stress run).
    endurance15k: {
        durationDetail: 'summary', networkMetrics: 'off',
        phases: [
            { name: 'endurance_15k', targetTPS: 15000, duration: '5h', preAllocatedVUs: 1650, maxVUs: 2200 },
        ],
    },
};

// -----------------------------------------------------------------------------
// 3. SETTINGS
// -----------------------------------------------------------------------------
export const SETTINGS = {
    // Pass/fail rules used by the report.
    maxErrorRatePct: 10,          // FAIL if error % goes above this
    minTpsAchievementPct: 90,     // FAIL if actual TPS < this % of target

    // 'gzip' sends Accept-Encoding: gzip (CDN serves the compressed variant).
    // Use 'none' to send no header.
    acceptEncoding: 'gzip',

    // How long k6 waits for in-flight requests at the end of each phase.
    gracefulStop: '5s',

    // Cache hit/miss + backend headers are read on a SAMPLE of responses
    // (about this many per second per VM) so the hot path stays cheap.
    // Low-TPS tests are still 100% observed.
    cacheSamplesPerSec: 1000,

    // Static headers (Age, Cache-Control, ETag, Vary) are captured by a
    // tiny background "probe" at this many requests/second. 0 = off.
    probeTps: 2,
};

// -----------------------------------------------------------------------------
// Cache detection (rarely changed)
// -----------------------------------------------------------------------------
// provider (in URLS)  ->  how a response is classified as cache hit / miss
//   header          look at CACHE_HEADERS.status headers for "hit" / "miss"
//   gcp-age         GCP Cloud CDN sends no status header; Age > 0 = hit
//   not-applicable  no CDN in front of this URL
//   not-observable  CDN status can't be seen by the client (check CDN logs)
export const CACHE_STRATEGY = {
    'aws-cloudfront': 'header',
    'cdn-header': 'header',
    'gcp-cdn': 'gcp-age',
    'direct-bucket': 'not-applicable',
};

export const CACHE_HEADERS = {
    status: [
        'X-Cache', 'X-Cache-Status', 'CF-Cache-Status', 'X-Cache-Hit',
        'X-Akamai-Cache-Status', 'Akamai-Cache-Status', 'X-Varnish-Cache',
    ],
    age: 'Age',
    etag: 'ETag',
    cacheControl: 'Cache-Control',
    vary: 'Vary',
    backend: 'response_sent_by_backend',     // custom header, "true" = origin served it
    cacheResponse: 'response_from_cache',    // custom header, "true" = cache served it
};

// -----------------------------------------------------------------------------
// EXTRA HEADERS -- probe ANY other response header, not just cache/Age ones.
// -----------------------------------------------------------------------------
// Checked by the same low-rate background probe as Age/Cache-Control/ETag/Vary
// (see SETTINGS.probeTps), so it costs nothing on the hot path.
//
//   key     short id, letters/numbers/underscore only (used internally)
//   label   name shown in the report
//   header  exact response header name to look for (matched case-insensitively)
//   numeric true  = track the value as a number (avg/min/max/p95), e.g. a rate-limit count
//           false = presence only (% of probe responses that had this header)
//   pages   optional: array of page ids ([config.js] URLS ids) to check this on.
//           Omit to check on every page.
export const EXTRA_PROBE_HEADERS = [
    // Examples -- delete or edit these for your real headers:
    // { key: 'ratelimit_remaining', label: 'X-RateLimit-Remaining', header: 'X-RateLimit-Remaining', numeric: true },
    // { key: 'request_id',          label: 'X-Request-Id',          header: 'X-Request-Id',          numeric: false },
    // { key: 'server',              label: 'Server',                header: 'Server',                numeric: false, pages: ['homepage'] },
];
