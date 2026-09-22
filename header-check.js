#!/usr/bin/env node
/**
 * header-check.js -- quick, one-shot check: hit a list of URLs ONCE each,
 * print every response header, and flag whether the headers you care about
 * are present. No load, no VUs, no k6. Exits 1 if anything is missing/failed,
 * so it can gate a CI/CD pipeline.
 *
 * USAGE
 *   node header-check.js                                   uses header-check.config.js
 *   node header-check.js --config path/to/other.config.js
 *   node header-check.js https://a.com https://b.com --expect ETag,Cache-Control
 *   node header-check.js https://a.com --expect ETag --json
 *
 * FLAGS
 *   --config <path>    config file to use (default: ./header-check.config.js next to this script)
 *   --expect a,b,c     header names required on every URL given on the command line
 *   --status 200,301   status codes that count as OK for URLs given on the command line (default: <400)
 *   --timeout <ms>     request timeout, ms (default: 8000, or the config's own "timeout")
 *   --json             print one JSON result object instead of the text report (still sets exit code)
 *   --no-color         plain text, no ANSI colors
 *   --no-follow        do not follow redirects (checks the FIRST response, e.g. to inspect a 301)
 *
 * EXIT CODE
 *   0  every URL: reachable, status OK, every expected header present
 *   1  any URL failed one of those checks (use this in your CI/CD gate)
 *
 * CONFIG FILE  (see header-check.config.js for a commented example)
 *   module.exports = {
 *     timeout: 8000,                 // ms, optional
 *     expectGlobal: ['Cache-Control'],   // checked on every URL below, optional
 *     urls: [
 *       { name: 'Homepage', url: 'https://example.com/', expect: ['ETag', 'Vary'] },
 *       { name: 'API',      url: 'https://example.com/health',
 *         expect: [ 'X-Request-Id', { header: 'Content-Type', contains: 'application/json' } ],
 *         expectStatus: [200] },
 *       { name: 'Old page redirects', url: 'https://example.com/old',
 *         expectStatus: [301, 302], followRedirects: false },
 *     ],
 *   };
 * A plain header-check.config.json (same shape, no functions) also works.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// -----------------------------------------------------------------------------
// 1. ARGS
// -----------------------------------------------------------------------------
function parseArgs(argv) {
    const a = { urls: [], configPath: null, expect: [], status: null, timeout: null, json: false, color: true, follow: true, help: false };
    for (let i = 0; i < argv.length; i++) {
        const x = argv[i];
        if (x === '--config') a.configPath = argv[++i];
        else if (x === '--expect') a.expect = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
        else if (x === '--status') a.status = argv[++i].split(',').map((s) => parseInt(s.trim(), 10));
        else if (x === '--timeout') a.timeout = parseInt(argv[++i], 10);
        else if (x === '--json') a.json = true;
        else if (x === '--no-color') a.color = false;
        else if (x === '--no-follow') a.follow = false;
        else if (x === '--help' || x === '-h') a.help = true;
        else if (!x.startsWith('--')) a.urls.push(x);
    }
    return a;
}

function help() {
    console.log(`Usage:
  node header-check.js                                   (uses ./header-check.config.js)
  node header-check.js --config path/to/other.config.js
  node header-check.js https://a.com https://b.com --expect ETag,Cache-Control
  node header-check.js https://a.com --expect ETag --status 200,301 --json

Flags: --config <path>  --expect a,b,c  --status 200,301  --timeout <ms>  --json  --no-color  --no-follow
Exit code: 0 if everything passed, 1 if anything failed or was unreachable.`);
}

// -----------------------------------------------------------------------------
// 2. LOAD THE LIST OF URLS  (CLI args, or a config file)
// -----------------------------------------------------------------------------
function loadConfig(configPath) {
    if (!fs.existsSync(configPath)) return null;
    if (configPath.endsWith('.json')) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return require(path.resolve(configPath));
}

function buildTargets(args) {
    if (args.urls.length) {
        return args.urls.map((url) => ({
            name: url, url,
            expect: args.expect,
            expectStatus: args.status,
            followRedirects: args.follow,
        }));
    }
    const configPath = args.configPath || path.join(__dirname, 'header-check.config.js');
    const cfg = loadConfig(configPath);
    if (!cfg) {
        throw new Error(`No URLs given and no config file found at ${configPath}.\n` +
            `Either pass URLs directly (node header-check.js https://example.com --expect ETag) ` +
            `or create that config file (see header-check.config.js for an example).`);
    }
    if (!Array.isArray(cfg.urls) || !cfg.urls.length) throw new Error(`${configPath} has no "urls" array (or it is empty).`);
    return cfg.urls.map((u) => ({
        name: u.name || u.url,
        url: u.url,
        method: u.method || 'GET',
        headers: u.headers || {},
        expect: (cfg.expectGlobal || []).concat(u.expect || []),
        expectStatus: u.expectStatus || args.status,
        followRedirects: u.followRedirects !== undefined ? u.followRedirects : args.follow,
        timeout: u.timeout || args.timeout || cfg.timeout,
    }));
}

// -----------------------------------------------------------------------------
// 3. THE CHECK ITSELF -- one request, no repeats, no load
// -----------------------------------------------------------------------------
async function checkOne(target, defaultTimeout) {
    const timeoutMs = target.timeout || defaultTimeout || 8000;
    const result = { name: target.name, url: target.url, ok: false, error: null, status: null, headers: {}, expected: [] };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(target.url, {
            method: target.method || 'GET',
            headers: target.headers || {},
            redirect: target.followRedirects === false ? 'manual' : 'follow',
            signal: controller.signal,
        });
        result.status = res.status;
        res.headers.forEach((v, k) => { result.headers[k] = v; });

        const okStatuses = target.expectStatus && target.expectStatus.length ? target.expectStatus : null;
        const statusOk = okStatuses ? okStatuses.includes(res.status) : res.status < 400;

        const expected = (target.expect || []).map((e) => {
            const spec = typeof e === 'string' ? { header: e } : e;
            const value = findHeader(result.headers, spec.header);
            const present = value !== undefined;
            const contains = spec.contains ? present && value.toLowerCase().includes(String(spec.contains).toLowerCase()) : null;
            return { header: spec.header, present, value, contains: spec.contains || null, containsOk: contains };
        });

        result.expected = expected;
        result.statusOk = statusOk;
        result.expectedOk = expected.every((e) => e.present && (e.contains === null || e.containsOk));
        result.ok = statusOk && result.expectedOk;
    } catch (err) {
        result.error = controller.signal.aborted ? `Timed out after ${timeoutMs} ms` : err.message;
        result.ok = false;
    } finally {
        clearTimeout(timer);
    }
    return result;
}

function findHeader(headers, name) {          // fetch's Headers are already lower-cased when iterated
    return headers[name.toLowerCase()];
}

// -----------------------------------------------------------------------------
// 4. OUTPUT
// -----------------------------------------------------------------------------
function colorFns(enabled) {
    if (!enabled) return { g: (s) => s, r: (s) => s, y: (s) => s, b: (s) => s, dim: (s) => s };
    const wrap = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
    return { g: wrap(32), r: wrap(31), y: wrap(33), b: wrap(1), dim: wrap(2) };
}

function printResult(r, c) {
    console.log(c.b(`\n${r.name}`));
    console.log(`  URL:    ${r.url}`);
    if (r.error) {
        console.log(`  Result: ${c.r('FAIL')} -- ${r.error}`);
        return;
    }
    console.log(`  Status: ${r.status}  ${r.statusOk ? c.g('OK') : c.r('UNEXPECTED')}`);
    if (r.expected.length) {
        console.log('  Watched headers:');
        r.expected.forEach((e) => {
            if (!e.present) { console.log(`    ${e.header.padEnd(28)} ${c.r('MISSING')}`); return; }
            let line = `    ${e.header.padEnd(28)} ${c.g('PRESENT')}  ${e.value}`;
            if (e.contains !== null) line += e.containsOk ? c.g(`  (contains "${e.contains}")`) : c.r(`  (does NOT contain "${e.contains}")`);
            console.log(line);
        });
    }
    const headerNames = Object.keys(r.headers).sort();
    console.log(`  All response headers (${headerNames.length}):`);
    headerNames.forEach((k) => console.log(`    ${k}: ${r.headers[k]}`));
    console.log(`  Result: ${r.ok ? c.g('PASS') : c.r('FAIL')}`);
}

// -----------------------------------------------------------------------------
// 5. MAIN
// -----------------------------------------------------------------------------
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { help(); return; }

    const targets = buildTargets(args);
    const results = [];
    for (const t of targets) results.push(await checkOne(t, args.timeout));   // one at a time -- this is a check, not a load test

    if (args.json) {
        console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length, results }, null, 2));
    } else {
        const c = colorFns(args.color && process.stdout.isTTY);
        results.forEach((r) => printResult(r, c));
        const passed = results.filter((r) => r.ok).length;
        console.log(c.b(`\n${'-'.repeat(50)}\n${passed}/${results.length} passed`));
    }

    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((err) => { console.error(`ERROR: ${err.message}`); process.exitCode = 1; });
