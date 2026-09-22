# k6 Load Test + HTML Report -- Simple Guide

Two steps, always:

```
STEP 1   k6 run ...        ->  runs the load, saves a small  .json  file
STEP 2   node report.js .. ->  reads the .json file(s), makes the  .html  report
```

k6 never makes the HTML itself. That is what keeps the k6 script small.

---

## 1. Files

| File | What it is | When you edit it |
|---|---|---|
| `config.js` | **The only file you normally edit**: URLs, load phases, TPS, VUs, pass/fail limits | to change what/how much to test |
| `k6-test.js` | The load generator (the "engine") | almost never |
| `report.js` | Builds the HTML report from the `.json` files (1 machine or many) | to change report layout |
| `run.sh` | Optional shortcut for Linux/Mac/WSL/Git-Bash (step 1 + 2 in one go) | never |

Keep `k6-test.js` and `config.js` **in the same folder** and run commands from that folder.

## 2. Install

| | k6 (on every load-generator machine) | Node.js (only where you build the report) |
|---|---|---|
| **Windows** | `winget install k6 --source winget` (or `choco install k6`, or the installer from k6.io) | installer from nodejs.org (any current LTS) |
| **Linux / Mac** | see the k6 install docs for your OS (apt, brew, ...) | your package manager or nodejs.org |

Check: `k6 version` and `node -v`.

---

## 3. Quick start (2 minutes)

Edit the `url:` lines in `config.js` to your real pages first. Then:

**Linux / Mac / Git-Bash**
```bash
mkdir -p results
k6 run k6-test.js -e RUN_PROFILE=smoke -e REPORT_NAME=first-test -e REPORT_DIR=results
node report.js --dir results --name first-test
```

**Windows PowerShell**
```powershell
mkdir results -Force
k6 run k6-test.js -e RUN_PROFILE=smoke -e REPORT_NAME=first-test -e REPORT_DIR=results
node report.js --dir results --name first-test
```

**Windows cmd**
```bat
if not exist results mkdir results
k6 run k6-test.js -e RUN_PROFILE=smoke -e REPORT_NAME=first-test -e REPORT_DIR=results
node report.js --dir results --name first-test
```

Open the report: `results/first-test-report.html` (double-click it, or `start results\first-test-report.html` on Windows, `open ...` on Mac, `xdg-open ...` on Linux).

> The `k6 run ...` line is **identical on every OS** -- put it on one line and it just works.
> Only the "create folder" command differs.
>
> **Create the results folder BEFORE the test.** k6 cannot create folders. If it is missing, the main
> file is lost -- but a safety copy `<name>-<machine>.json.bak` is always saved in the current folder;
> build the report from it with `node report.js first-test-gen1.json.bak`.

---

## 4. Normal k6 commands for each test type

Run from the script folder. Same on every OS. (`results` folder must exist.)

```
k6 run k6-test.js -e RUN_PROFILE=smoke     -e REPORT_NAME=smoke-1   -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=load      -e REPORT_NAME=load-1    -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=stress    -e REPORT_NAME=stress-1  -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=spike     -e REPORT_NAME=spike-1   -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=endurance -e REPORT_NAME=soak-1    -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=endurance15k -e REPORT_NAME=soak15-1 -e REPORT_DIR=results
```

| Profile | Shape | Length |
|---|---|---|
| `smoke` | 4 -> 10 -> 20 -> 50 TPS. Only checks that everything works | ~20 s |
| `load` | one steady level (5,000 TPS) | 1 h |
| `stress` | steps 5k, 10k, 15k, 20k, 25k, 30k TPS -- find the breaking point of ONE machine | 1 h |
| `spike` | 2k TPS baseline with 3 bursts of 20k TPS | ~2 h |
| `endurance` | steady 10,000 TPS | 5 h |
| `endurance15k` | steady 15,000 TPS | 5 h |

Then build the report:
```
node report.js --dir results --name <the REPORT_NAME you used>
```

Prefer environment variables to `-e`? Same thing:

| Shell | Example |
|---|---|
| bash | `export RUN_PROFILE=load` then `k6 run k6-test.js` |
| PowerShell | `$env:RUN_PROFILE="load"` then `k6 run k6-test.js` |
| cmd | `set RUN_PROFILE=load` then `k6 run k6-test.js` |

Quotes are needed if a value has special characters (`&`, spaces...), e.g. a password: `-e "BASIC_AUTH_PASS=my pass&1"`.

---

## 5. Several machines at the same time (e.g. 2 x 10k = 20k TPS)

**Rules -- these 4 things matter:**

1. **Same `config.js`** on every machine.
2. **Same** `RUN_PROFILE` and **same** `REPORT_NAME` on every machine.
3. **Different** `K6_MACHINE_ID` on every machine (`gen1`, `gen2`, ...). Set it explicitly -- two machines with the same id cannot be merged.
4. Each machine's TPS is its **own** share: 2 machines on `endurance` = 2 x 10,000 = 20,000 TPS total.

### Step A -- start the test on every machine (at about the same time)

Machine 1:
```
k6 run k6-test.js -e RUN_PROFILE=endurance -e K6_MACHINE_ID=gen1 -e REPORT_NAME=soak-run -e REPORT_DIR=results
```
Machine 2 (only the id changes):
```
k6 run k6-test.js -e RUN_PROFILE=endurance -e K6_MACHINE_ID=gen2 -e REPORT_NAME=soak-run -e REPORT_DIR=results
```
(Machine 3 -> `gen3`, and so on.)

A few seconds of difference between machines does not matter in a 5-hour test.

Long test, so **keep the session alive**:

| OS | How |
|---|---|
| Linux | `tmux new -s k6` (detach `Ctrl-b d`, back with `tmux attach -t k6`), or `nohup k6 run ... > k6.log 2>&1 &` |
| Windows | keep the terminal window open; stop the PC from sleeping, e.g. `powercfg /change standby-timeout-ac 0` |

### Step B -- wait until all machines finish, then collect the files

Each machine now has `results/soak-run-<its id>.json`. Copy them all into **one** folder on any machine that has Node.js:

```
results/soak-run-gen1.json
results/soak-run-gen2.json
```

Copy any way you like: `scp`, `gcloud compute scp`, a shared bucket/drive, or download and upload by hand.

### Step C -- build ONE combined report (once, anywhere with Node.js)

```
node report.js --dir results --name soak-run
```
Optional: `--each` also writes one report per machine.
```
node report.js --dir results --name soak-run --each
```
Output: `results/soak-run-report.html` (+ `.json`).

If you did stress/calibration first, use a different `REPORT_NAME` for each run (e.g. `calib`, `soak-run`) so files of different runs never mix.

### Optional shortcut (Linux / Mac / WSL / Git-Bash only)

```bash
./run.sh endurance gen1 soak-run                 # k6, then report for this one machine
SKIP_REPORT=1 ./run.sh endurance gen2 soak-run   # multi-machine: run k6 only, build report later
```
Arguments: `./run.sh <profile> [machine-id] [report-name]`. Extra arguments go to k6.

---

## 6. Recommended order for the 5-hour test

1. **Smoke** on one machine -- proves script + target + report work.
2. **Stress** on one machine (`RUN_PROFILE=stress`). Open the report, look at each step: where **Error %** or **Dropped iterations** starts climbing is that machine's ceiling. That tells you how many machines you need.
3. **Set the VUs** in `config.js` from the stress results (section 8), copy `config.js` to all machines.
4. **Endurance** on all machines (section 5).

---

## 7. Every parameter

### 7a. Flags for `k6 run` (`-e NAME=value`, or an environment variable)

| Name | What it does | Default |
|---|---|---|
| `RUN_PROFILE` | Which load pattern: `smoke` `load` `stress` `spike` `endurance` `endurance15k` (names from `config.js`) | `smoke` |
| `K6_MACHINE_ID` | Name of this machine. **Must be unique** per machine | computer name, else `gen1` |
| `REPORT_NAME` | Name of the run. **Same** on all machines of one run. Names the files | `k6-report` |
| `REPORT_DIR` | Folder for the `.json` file. **Must already exist** | `.` (current folder) |
| `BASIC_AUTH_USER`, `BASIC_AUTH_PASS` | Login for pages that have `auth: true` in `config.js` | none |
| `DURATION_DETAIL` | Memory vs detail for latency (see section 9): `phase_url` `phase` `summary` | from the profile |
| `NETWORK_METRICS` | Per-phase timing breakdown: `all` `core` `off` | from the profile |

Output file: `<REPORT_DIR>/<REPORT_NAME>-<K6_MACHINE_ID>.json`

Examples:
```
k6 run k6-test.js -e RUN_PROFILE=load -e K6_MACHINE_ID=gen1 -e REPORT_NAME=load-1 -e REPORT_DIR=results
k6 run k6-test.js -e RUN_PROFILE=load -e REPORT_NAME=load-2 -e REPORT_DIR=results -e BASIC_AUTH_USER=tester -e BASIC_AUTH_PASS=secret
k6 run k6-test.js -e RUN_PROFILE=load -e REPORT_NAME=load-3 -e REPORT_DIR=results -e DURATION_DETAIL=phase
```

### 7b. `node report.js`

| Option | What it does |
|---|---|
| `--dir <folder>` | Use every raw `.json` file in the folder (reports and other json files are skipped automatically) |
| `--name <name>` | Only use files whose `REPORT_NAME` is this. Also names the output |
| `--out <prefix>` | Output path without extension (default `<dir>/<name>-report`) |
| `--each` | Also write one HTML per machine |
| `file1.json file2.json` | Or list the files yourself instead of `--dir` (a `.json.bak` file works too) |

### 7c. Settings inside `config.js`

**`URLS` -- one line per page**

| Field | Meaning |
|---|---|
| `id` | Short unique name, no spaces (used inside metrics) |
| `name` | Nice name shown in the report |
| `url` | Full address |
| `method` | `GET` (default), or `POST` etc. with a `body:` |
| `weight` | Share of traffic. 1/1/1 = a third each; 2/1/1 = half on the first page |
| `provider` | How to detect cache hit/miss: `gcp-cdn`, `aws-cloudfront`, `cdn-header`, `direct-bucket` (see below) |
| `auth` | Optional. `true` = use `BASIC_AUTH_USER/PASS`, or `{ username: 'u', password: 'p' }` |
| `headers` | Optional extra request headers for this page only |

**A phase (inside a profile's `phases: [ ... ]`)**

| Field | Meaning |
|---|---|
| `name` | Unique name, no spaces (shown in the report) |
| `targetTPS` | Requests per second **for one machine** |
| `duration` | `30s`, `10m`, `5h`, `1h30m` |
| `preAllocatedVUs` | Virtual users created before the phase starts (**required**) |
| `maxVUs` | Upper limit k6 may grow to (**required**) |

Phases run one after another. To make a new test, copy a profile, rename it, edit the phases -- then run it with `-e RUN_PROFILE=<newname>`.

**Profile settings** (next to `phases`): `durationDetail` and `networkMetrics` -- same as the flags above.

**`SETTINGS`**

| Setting | Meaning | Default |
|---|---|---|
| `maxErrorRatePct` | Report says FAIL if error % is **above** this | 10 |
| `minTpsAchievementPct` | FAIL if actual TPS is **below** this % of target | 90 |
| `acceptEncoding` | `'gzip'` sends `Accept-Encoding: gzip` (CDN sends compressed version). `'none'` = send nothing | `'gzip'` |
| `gracefulStop` | Time k6 waits for in-flight requests at the end of each phase | `'5s'` |
| `cacheSamplesPerSec` | Cache headers are read on about this many responses per second (keeps CPU low) | 1000 |
| `probeTps` | Requests per second of the background header check (Age, Cache-Control, ETag, Vary). `0` = off | 2 |

**`CACHE_STRATEGY` (provider -> how hit/miss is decided)**

| Strategy | Meaning |
|---|---|
| `header` | Look for `hit`/`miss` in cache headers (`X-Cache`, `CF-Cache-Status`, ...) |
| `gcp-age` | GCP Cloud CDN has no status header: `Age` > 0 = hit |
| `not-applicable` | No CDN in front of this page |
| `not-observable` | Client cannot see it; check CDN logs instead |

`CACHE_HEADERS` lists the header names that are checked. Change it only if your CDN uses other names.

**`EXTRA_PROBE_HEADERS` -- checking any OTHER response header** (not just cache/Age)

Add one entry per header you want tracked. Checked by the same low-rate background probe, so it costs nothing on the main load:

```js
export const EXTRA_PROBE_HEADERS = [
    { key: 'ratelimit_remaining', label: 'X-RateLimit-Remaining', header: 'X-RateLimit-Remaining', numeric: true },
    { key: 'request_id',          label: 'X-Request-Id',          header: 'X-Request-Id',          numeric: false },
    { key: 'server',              label: 'Server',                header: 'Server',                numeric: false, pages: ['homepage'] },
];
```

| Field | Meaning |
|---|---|
| `key` | Short id, letters/numbers/underscore only |
| `label` | Name shown in the report |
| `header` | Exact response header name (matched case-insensitively) |
| `numeric` | `true` = track the value as a number (avg/min/max/p95). `false` = just % present |
| `pages` | Optional: only check on these page ids. Leave out to check on every page |

These work on **any** page, including ones with `provider: 'direct-bucket'` (no CDN) -- the header does not need to be cache-related. Results appear in the report under section 6, "Additional Headers Checked", and every checked page also lists them in section 2, "Pages Under Test".

---

## 8. Choosing preAllocatedVUs / maxVUs

VUs needed = TPS x latency in seconds.

```
preAllocatedVUs = ceil(targetTPS x p95_seconds)
maxVUs          = about 1.3 x preAllocatedVUs
```
Example: 10,000 TPS and p95 = 80 ms -> 10,000 x 0.08 = **800** pre-allocated, **1,040** max.

The numbers in `config.js` are placeholders that assume ~100 ms. Replace them with real ones after the stress run.
Too low -> k6 has to create VUs during the test (TPS dips, dropped iterations). Too high -> wasted RAM only.

---

## 9. Reading the report

| Section | What it shows |
|---|---|
| Top banner | PASS/FAIL. FAIL only if **error % > limit** or **actual TPS < 90 % of target** in some phase |
| 1. Overall Summary | Totals, error rate, TPS, latency, VUs. "Source runs" lists each machine |
| 2. Pages Under Test | Every page: full URL, whether it needs auth, its CDN/cache strategy, and exactly which response headers are checked on it |
| 3. Phase-wise Breakdown | One box per phase: TPS, then a table per page (latency, pass/fail, 2xx/3xx/4xx/5xx). Inside: Network/Native k6 timing table |
| 4. Visual Overview | Charts (need internet to load Chart.js) |
| 5. Overall HTTP Status | Count and % per status class (`err` = no response: timeout, connection refused) |
| 6. Cache / Backend | Hit/Miss/Hit %, Age, Cache-Control, ETag, Vary, backend/cache indicator counts, plus "Additional Headers Checked" for anything in `EXTRA_PROBE_HEADERS` |
| 7. Native k6 Metrics | Pointer to the raw `.json` |

Words:
- **Transactions** = page requests sent. **Requests** = every HTTP call incl. redirect hops (so Requests >= Transactions).
- **Dropped iterations** = k6 could not start a request on time (VUs/CPU exhausted). Shown, but never turns the run FAIL. If it is above 0, don't trust the latency numbers.
- **Several machines:** counts, average, min and max are exact. **P90/P95/P99 are approximate**: the report shows the weighted value and, under it, `worst` = highest seen on any one machine.
- Cache Hit/Miss are counted on a **sample** of responses: use the **Hit %** column, not the raw counts.

**Memory on long tests:** k6 keeps every latency sample in RAM. So `endurance` profiles use `durationDetail: 'summary'` = only **overall** latency is measured; per-page and per-phase latency show `n/a` (by design). Counters, errors, status codes and cache stay fully detailed. Use `phase_url` (per-page latency) only for runs up to about 1-2 h, or after you have checked RAM on your machine.

---

## 10. Problems and messages

| You see | Meaning / fix |
|---|---|
| `RUN_PROFILE must be one of ...` | Typo in the profile name. Use one of the names listed |
| `Phase "x" needs preAllocatedVUs and maxVUs in config.js` | Add both numbers to that phase |
| `Page "x" has auth but BASIC_AUTH_USER / BASIC_AUTH_PASS are not set` | Pass `-e BASIC_AUTH_USER=... -e BASIC_AUTH_PASS=...` |
| `could not open 'folder/....json'` | The `REPORT_DIR` folder did not exist. Use the safety copy: `node report.js <name>-<machine>.json.bak` |
| `Machine id "x" appears twice` | Two files have the same `K6_MACHINE_ID`. Rerun with unique ids, or pick the run with `--name` |
| `... ran different phases/pages than ...` | Machines used different profile/`config.js`. Only merge machines that ran the same |
| `No k6 raw summary files found` | Wrong `--dir` or `--name`. Files look like `<REPORT_NAME>-<machine>.json` |
| `Request Failed ... connection refused` (warnings) | The target URL is not reachable from this machine |
| Dropped iterations > 0 / actual TPS below target | VUs too low, or the machine is at its limit (check its CPU). Raise VUs or add machines |
| Latency shows `n/a` | Expected with `DURATION_DETAIL=summary` (endurance) |
| Charts empty, "need internet" | Open the HTML on a computer with internet access |
| Log: `header "X" exists but not under key "Y"` | A header name in `CACHE_HEADERS` has an unexpected letter-case; tell the script owner |

---

## 11. Good to know

- The Windows commands above were not run by me -- I tested the same k6 and Node commands on Linux. Both tools work the same on Windows; only shell syntax (creating folders, setting variables) differs.
- The end-of-test console summary imports `k6-summary` from `jslib.k6.io`, so the load machine needs internet (or remove that import and the `textSummary` lines if it has none).
- At 10-15k TPS use a Linux VM (Linux tip, not tested here: raise the open-files limit first, `ulimit -n 250000`), and confirm one machine's real ceiling with the stress profile before the 5-hour run.
- Nothing here has been run at 10-15k TPS or for 5 hours -- do the stress run first.
