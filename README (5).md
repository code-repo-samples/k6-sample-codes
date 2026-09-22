# header-check.js -- quick header/status validation

One request per URL, no load, no VUs. Prints the status code, every response
header, and whether the headers you're watching for are present. Exits `1`
if anything is missing or unreachable, so it can gate a CI/CD pipeline.

Plain Node.js, **zero dependencies** (uses the built-in `fetch`). Needs
**Node 18 or newer**. No k6 required.

## Run it

```bash
# no arguments -- uses header-check.config.js in this same folder
node header-check.js

# one-off check, no config file needed
node header-check.js https://example.com --expect ETag,Cache-Control

# check several URLs at once, same expected headers on all of them
node header-check.js https://example.com/a https://example.com/b --expect ETag

# only these status codes count as OK (default: anything under 400)
node header-check.js https://example.com/old --expect Location --status 301,302

# machine-readable output (for scripts, or piping into jq)
node header-check.js https://example.com --expect ETag --json
```

## Config file (for a fixed list of URLs -- edit `header-check.config.js`)

```js
module.exports = {
    timeout: 8000,                        // ms, optional
    expectGlobal: ['Cache-Control'],      // checked on every URL below
    urls: [
        { name: 'Homepage', url: 'https://example.com/', expect: ['ETag', 'Vary'] },
        { name: 'API', url: 'https://example.com/health',
          expect: ['X-Request-Id', { header: 'Content-Type', contains: 'application/json' }],
          expectStatus: [200] },
        { name: 'Old page redirects', url: 'https://example.com/old',
          expect: ['Location'], expectStatus: [301, 302], followRedirects: false },
    ],
};
```

| Field | Meaning |
|---|---|
| `name` | Label shown in the output |
| `url` | Full address |
| `method`, `headers` | Optional. `headers` can carry `Authorization`, etc. |
| `expect` | Headers to watch for: a name (`'ETag'`), or `{ header, contains }` to also check the value |
| `expectStatus` | Status codes that count as OK for this URL (default: anything under 400) |
| `followRedirects` | `false` = inspect the redirect response itself (e.g. to check a 301's `Location`) instead of following it |

A plain `header-check.config.json` (same shape, no functions) also works, via `--config`.

## Flags

| Flag | Meaning |
|---|---|
| `--config <path>` | Use a different config file |
| `--expect a,b,c` | Headers required, for URLs given on the command line |
| `--status 200,301` | OK status codes, for URLs given on the command line |
| `--timeout <ms>` | Request timeout (default 8000) |
| `--json` | Print one JSON object instead of text |
| `--no-color` | Plain text, no ANSI colors (CI logs usually want this) |
| `--no-follow` | Don't follow redirects |

## In a CI/CD pipeline

Exit code is `0` only if every URL was reachable, had an OK status, and had
every watched header present.

**GitHub Actions**
```yaml
- name: Check response headers
  run: node header-check.js --no-color
```

**Any shell / other CI**
```bash
node header-check.js --no-color || exit 1
```

## Difference from the k6 load test

This checks each URL **once**. It says nothing about performance, cache
hit-rate under load, or behavior over time -- that's what the full k6 setup
(`k6-test.js` + `config.js` + `report.js`) is for. Use this one for a fast
"did we break a header/redirect/status code" check on every deploy.
