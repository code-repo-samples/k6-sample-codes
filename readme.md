can you create me a read me file along with an architeture what we are tryint o achieve

                         REAL USER
                            │
                            ▼
                    ┌───────────────┐
                    │ Web Browser   │
                    │ Chrome/Edge   │
                    └───────┬───────┘
                            │
                     Check Browser Cache
                            │
                 ┌──────────┴──────────┐
                 │                     │
          BROWSER CACHE HIT      BROWSER CACHE MISS
                 │                     │
                 │                     ▼
                 │              DNS / Network
                 │                     │
                 │                     ▼
                 │              ┌────────────┐
                 │              │    CDN     │
                 │              └─────┬──────┘
                 │                    │
                 │            ┌───────┴───────┐
                 │            │               │
                 │        CDN CACHE HIT   CDN CACHE MISS
                 │            │               │
                 │            │               ▼
                 │            │        ┌────────────┐
                 │            │        │ GCP Origin │
                 │            │        │ Application│
                 │            │        └─────┬──────┘
                 │            │              │
                 │            └──────┬───────┘
                 │                   │
                 │             HTTP Response
                 │                   │
                 └───────────┬───────┘
                             ▼
                    Browser receives
                       HTML/assets
                             │
                             ▼
                    ┌────────────────┐
                    │ Browser stores │
                    │ cacheable      │
                    │ resources     │
                    └───────┬────────┘
                            │
                            ▼
                    JavaScript / DOM
                    / rendering / API
                            │
                            ▼
                       USER SEES PAGE

Absolutely. **Browser cache should be shown separately from CDN cache**, because they are two different cache layers.

## 1. Real-world browser + CDN flow

```text
                         REAL USER
                            │
                            ▼
                    ┌───────────────┐
                    │ Web Browser   │
                    │ Chrome/Edge   │
                    └───────┬───────┘
                            │
                     Check Browser Cache
                            │
                 ┌──────────┴──────────┐
                 │                     │
          BROWSER CACHE HIT      BROWSER CACHE MISS
                 │                     │
                 │                     ▼
                 │              DNS / Network
                 │                     │
                 │                     ▼
                 │              ┌────────────┐
                 │              │    CDN     │
                 │              └─────┬──────┘
                 │                    │
                 │            ┌───────┴───────┐
                 │            │               │
                 │        CDN CACHE HIT   CDN CACHE MISS
                 │            │               │
                 │            │               ▼
                 │            │        ┌────────────┐
                 │            │        │ GCP Origin │
                 │            │        │ Application│
                 │            │        └─────┬──────┘
                 │            │              │
                 │            └──────┬───────┘
                 │                   │
                 │             HTTP Response
                 │                   │
                 └───────────┬───────┘
                             ▼
                    Browser receives
                       HTML/assets
                             │
                             ▼
                    ┌────────────────┐
                    │ Browser stores │
                    │ cacheable      │
                    │ resources     │
                    └───────┬────────┘
                            │
                            ▼
                    JavaScript / DOM
                    / rendering / API
                            │
                            ▼
                       USER SEES PAGE
```

### The key difference

There are **two independent cache decisions**:

```text
Browser
   │
   ├── Browser cache HIT
   │       └── No CDN request for that resource
   │
   └── Browser cache MISS
           │
           ▼
          CDN
           │
           ├── CDN HIT
           │
           └── CDN MISS
                   │
                   ▼
                 Origin
```

---

# 2. New vs returning user with browser cache

This is where it gets particularly important.

### New user

```text
             NEW USER
                 │
                 ▼
          New browser session
                 │
                 ▼
       Browser cache initially
          empty / cold
                 │
                 ▼
           CDN request
                 │
          ┌──────┴──────┐
          │             │
       CDN HIT       CDN MISS
          │             │
          │             ▼
          │          Origin
          │             │
          └──────┬──────┘
                 ▼
           Browser receives
            HTML + assets
                 │
                 ▼
          Browser cache
              WARMED
```

The first visit therefore potentially exercises:

```text
Browser → CDN → Origin
```

for cache-missing resources.

---

### Returning user

```text
          RETURNING USER
                 │
                 ▼
       Existing browser profile
                 │
          Existing browser cache
                 │
          ┌──────┴──────┐
          │             │
      CACHE HIT     CACHE MISS
          │             │
          │             ▼
          │            CDN
          │             │
          │      ┌──────┴──────┐
          │      │             │
          │   CDN HIT      CDN MISS
          │      │             │
          │      │             ▼
          │      │          Origin
          │      │
          └──────┴─────────────┐
                               ▼
                         Browser renders
```

So a returning user may generate **far fewer network requests** than a new user.

---

# 3. Where your k6 test fits

This is the important distinction.

Your current **k6 protocol test does NOT simulate a real browser cache**.

Its model is:

```text
                  k6
                   │
                   │ HTTP
                   ▼
                  CDN
                   │
          ┌────────┴────────┐
          │                 │
       CDN HIT           CDN MISS
          │                 │
          │                 ▼
          │               Origin
          │                 │
          └────────┬────────┘
                   ▼
                k6 HTTP
                response
```

Your k6 test has:

```text
80% Returning
20% New
```

but that currently means primarily:

**cookie/session state**, not browser cache state.

That's an important distinction.

---

# 4. The complete architecture I recommend

```text
                         PERFORMANCE TESTING
                                │
                 ┌──────────────┴───────────────┐
                 │                              │
                 ▼                              ▼
          PROTOCOL LOAD TEST              BROWSER TEST
                 │                              │
                 ▼                              ▼
                k6                         Chrome/Edge
                 │                              │
                 │                         Browser Cache
                 │                         ┌────┴────┐
                 │                         │         │
                 │                       HIT       MISS
                 │                         │         │
                 │                         │         ▼
                 │                         │        CDN
                 │                         │         │
                 │                         │    ┌────┴────┐
                 │                         │    │         │
                 │                         │  HIT       MISS
                 │                         │    │         │
                 │                         │    │         ▼
                 │                         │    │      Origin
                 │                         │    │         │
                 │                         └────┴────┬────┘
                 │                                  │
                 ▼                                  ▼
                CDN                              Browser
                 │                                  │
          ┌──────┴──────┐                           │
          │             │                           ▼
       CDN HIT       CDN MISS                    Render
          │             │                           │
          │             ▼                           ▼
          │           Origin                      User
          │
          ▼
       k6 metrics
```

---

# 5. What each test should represent

| Layerk6 protocolBrowser test |           |           |
| ---------------------------- | --------- | --------- |
| HTTP traffic                 | ✅         | ✅         |
| CDN cache                    | ✅         | ✅         |
| Origin load                  | ✅         | ✅         |
| Cookies/session              | ✅         | ✅         |
| New user                     | ✅         | ✅         |
| Returning user               | ✅         | ✅         |
| **Browser cache**            | ❌         | **✅**     |
| JavaScript execution         | ❌         | ✅         |
| DOM rendering                | ❌         | ✅         |
| CSS/layout                   | ❌         | ✅         |
| Real API behavior            | Partially | ✅         |
| LCP/FCP/CLS/INP              | ❌         | ✅         |
| User experience              | ❌         | ✅         |
| 10K TPS stress               | **✅**     | Usually ❌ |

---

# 6. Your final testing model

I would document your framework like this:

```text
                         SAMPLE WEBSITE
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
                 ▼                             ▼
        ┌──────────────────┐          ┌──────────────────┐
        │  K6 PROTOCOL     │          │ BROWSER TEST     │
        │  LOAD TEST       │          │ REAL USER TEST   │
        └────────┬─────────┘          └────────┬─────────┘
                 │                             │
          80% Returning                   Returning User
          20% New                         + Browser Cache
                 │                        + Browser Cookies
                 │                             │
                 │                             ▼
                 │                     Browser Cache Check
                 │                       /            \
                 │                     HIT             MISS
                 │                      │                │
                 │                      │                ▼
                 │                      │               CDN
                 │                      │             /     \
                 │                      │           HIT     MISS
                 │                      │            │        │
                 │                      │            │        ▼
                 │                      │            │      Origin
                 │                      │            │        │
                 │                      └────────────┴────────┘
                 │                                   │
                 ▼                                   ▼
                CDN                              Browser
                 │                                   │
             /       \                               ▼
           HIT       MISS                         JS/DOM
            │          │                            │
            │          ▼                            ▼
            │        Origin                       Render
            │                                       │
            ▼                                       ▼
        HTTP Metrics                            User Experience
        TPS / TTFB /                         LCP / FCP / CLS
        DNS / errors                         INP / errors
        latency
```

### The main takeaway

Your **k6 test should answer infrastructure capacity**:

> "Can CDN + GCP + application handle 1 → 10,000 page TPS?"

Your **browser test should answer real-user performance**:

> "What does a new and returning user actually experience when browser cache + CDN cache + JavaScript + rendering are involved?"

And importantly, **don't add cache-busting headers to the k6 test**. That would artificially change the CDN behavior and stop you from measuring the natural production caching model.





                 WEBSITE PERFORMANCE FRAMEWORK
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
 ┌──────────────┐      ┌──────────────┐      ┌─────────────────┐
 │ k6 Protocol  │      │ k6 Browser   │      │ Playwright      │
 │              │      │              │      │ + Lighthouse    │
 │ SCALE        │      │ REAL BROWSER │      │ DIAGNOSIS       │
 │              │      │              │      │                 │
 │ 1 → 10K TPS  │      │ Journeys     │      │ Web Vitals      │
 │ CDN/Origin   │      │ Cache        │      │ Waterfall       │
 │ HTTP Metrics │      │ Cookies      │      │ JS/DOM          │
 │ Errors       │      │ JS/DOM       │      │ Accessibility   │
 └──────┬───────┘      └──────┬───────┘      │ SEO             │
        │                     │              └────────┬────────┘
        └─────────────────────┼───────────────────────┘
                              ▼
                    ┌──────────────────┐
                    │ CORRELATED       │
                    │ PERFORMANCE      │
                    │ REPORT           │
                    └──────────────────┘

  ### VM
  set -euo pipefail

export PROJECT_ID="$(gcloud config get-value project)"
export ZONE="us-central1-a"
export VM_NAME="k6-load-generator"
export MACHINE_TYPE="c3-standard-8"

echo "PROJECT_ID=$PROJECT_ID"
echo "ZONE=$ZONE"
echo "VM_NAME=$VM_NAME"
echo "MACHINE_TYPE=$MACHINE_TYPE"

# Enable Compute Engine API
gcloud services enable compute.googleapis.com

# Create VM
gcloud compute instances create "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family="ubuntu-2204-lts" \
  --image-project="ubuntu-os-cloud" \
  --boot-disk-size="50GB" \
  --boot-disk-type="pd-balanced" \
  --network-tier="PREMIUM" \
  --scopes="https://www.googleapis.com/auth/cloud-platform"

# Verify VM
gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" \
  --format="table(name,status,machineType.basename())"


gcloud compute ssh "$VM_NAME" --zone="$ZONE"


set -euo pipefail

# Update package metadata
sudo apt-get update

# Install utilities
sudo apt-get install -y \
  curl \
  wget \
  git \
  unzip \
  jq \
  htop \
  ca-certificates \
  gnupg

# Add official k6 repository key
curl -fsSL https://dl.k6.io/key.gpg | \
  sudo gpg --dearmor --yes \
  -o /usr/share/keyrings/k6-archive-keyring.gpg

# Add official k6 repository
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
  sudo tee /etc/apt/sources.list.d/k6.list > /dev/null

# Install k6
sudo apt-get update
sudo apt-get install -y k6

# Validate installation
echo "===== k6 version ====="
k6 version

echo "===== k6 location ====="
which k6

cat > ~/smoke.js <<'EOF'
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 1,
  iterations: 5,
  discardResponseBodies: true,
};

export default function () {
  const res = http.get(
    'https://httpbin.org'
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
EOF


echo "===== CPU ====="
nproc

echo "===== MEMORY ====="
free -h

echo "===== DISK ====="
df -h

echo "===== NETWORK ====="
ip -br addr
