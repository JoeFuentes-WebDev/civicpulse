# PROJECT_CONTEXT.md

_Last refreshed by reading the full codebase. Reflects the current `ui/` Next.js app architecture and extension points. Includes Milestone 01 (Photo Input) and Milestone 02 (Voice Input), both complete._

---

## What this app does

**CivicPulse** is an AI-assisted civic issue reporter for California cities (San Francisco is the only live target today). A resident describes a problem in plain language ("broken glass on 9th and Mission") — by **typing, dictating (voice), and/or attaching a photo** — and an LLM agent then:

1. Resolves the location (GPS reverse-geocode, but prefers a place named in the text).
2. Classifies the issue into an official SF Open311 service type.
3. Checks prior report history at that location.
4. Drafts a complete 311 submission payload.

A **review gate** decides whether to auto-submit or hand off to a human:

- **High confidence + low severity** → auto-submit to 311 (mock or live).
- **Otherwise** → a Review screen where the user can edit + re-run, then approve.

In the current POC, real SF 311 submission is **disabled** (`SF_OPEN311_LIVE=false`) because SF discontinued third-party Open311 POST access in July 2025. Submits return mock IDs (`MOCK-SAN_FRANCISCO-<timestamp>`); the rest of the pipeline (agent, geocode, classify, draft, gate) runs end-to-end for real.

---

## Architecture

Single Next.js 16 app (App Router, React 19) under `ui/`. Server logic lives in API routes + `lib/` modules; the LLM agent uses the Vercel AI SDK with Anthropic Claude. Run state is persisted in Upstash Redis.

```
ui/
├── app/
│   ├── page.tsx                      # Product UI: Report / Review / Confirmed screens (client)
│   ├── layout.tsx                    # Root layout (Geist fonts) — still has default CNA metadata
│   ├── globals.css
│   ├── debug/page.tsx                # Dev inspector: run summary, steps, raw JSON, 311 status, approve/rerun
│   ├── components/
│   │   └── AgentProgressBar.tsx      # Time-based fake progress bar (client)
│   └── api/
│       ├── store.ts                  # Upstash Redis get/set for AgentRun (1h TTL)
│       ├── run/route.ts              # POST: create run, call finishAgentRun, persist
│       ├── run/[id]/route.ts         # GET: poll run; PATCH: edit text + re-run agent
│       ├── submit/route.ts           # POST: user-approved 311 submit (Review path)
│       └── test/311-status/route.ts  # GET: env + read/write access probe (dev helper)
├── lib/
│   ├── finishAgentRun.ts             # Orchestrator: resolve → agent → gate → submit
│   ├── agent.ts                      # Vercel AI SDK agent + 5 tools (THE pipeline)
│   ├── reviewGate.ts                 # Auto-submit thresholds (0.80 conf, ≤3 severity)
│   ├── submit311.ts                  # Mock vs live submit dispatch + run-context helpers
│   ├── runRouting.ts                 # isAutoSubmitted() predicate for UI routing
│   ├── resolveReportLocation.ts      # Description-place-beats-GPS coordinate resolution
│   ├── extractPlaceFromDescription.ts# Regex place extraction + geocode query variants (no LLM)
│   ├── geocode.ts                    # Nominatim forward/reverse geocode
│   ├── formatAddress.ts              # Nominatim JSON → short street-level address line
│   ├── getLocationHistory.ts         # POC stub: random 0–3 prior reports
│   ├── sf311Config.ts                # SF Open311 creds, URLs, live-flag, auth headers
│   ├── sf311Services.ts             # SF service catalog fetch/cache + classification normalize
│   ├── sf311Submit.ts                # Live Open311 POST (form-encoded) + attribute building
│   └── sf311Access.ts                # Read/write access probes + 403 fix messaging
├── config/cities.ts                  # 5 CA cities; only SF wired for submit
├── shared/types.ts                   # CivicReport, AgentRun, AgentStep, DraftSubmissionPayload
├── scripts/test-311-access.mjs       # `npm run test:311` standalone access probe
└── .env.local                        # Secrets + SF_OPEN311_LIVE flag

agent/                                # STALE legacy package — superseded by ui/lib/agent.ts (see Technical Debt)
```

**Path alias:** `@shared/*` → `ui/shared/*` (tsconfig).

**Tech stack:** Next.js `16.2.6`, React `19.2.4`, TypeScript (strict), Tailwind v4 (debug page only), `ai` v6, `@ai-sdk/anthropic` v3, `@upstash/redis`, `zod` v4, `react-markdown`. Model: `claude-sonnet-5`. Geocoding: OpenStreetMap Nominatim (no key).

---

## Data Flow

### Primary path (`page.tsx`)

1. **GPS** acquired on mount via `navigator.geolocation` (falls back to SF center `37.7749,-122.4194`).
2. User composes a description by **typing, dictating, or both**, and may **attach a photo** → **`POST /api/run`** with `CivicReport { text, lat, lng, timestamp, photoUrl? }`.
   - **Voice (Milestone 02):** the 🎤 button uses the browser **Web Speech API** (`SpeechRecognition` / `webkitSpeechRecognition`) to stream a transcript directly into the existing `text` field (editable before submit). Entirely client-side — no audio is uploaded or stored.
   - **Photo (Milestone 01):** the 📷 button opens a file picker (`accept="image/*" capture="environment"`); the image is read to a base64 **data URL**, validated (image type, ≤ 4MB), previewed, and carried in `photoUrl`.
3. Route creates an `AgentRun` (`status: 'running'`), persists it, then **awaits `finishAgentRun`** and persists the result. Returns `{ id }` immediately after completion.
4. Client **polls `GET /api/run/[id]`** every 1s until `status` is `complete` or `error`.
5. Routing via `isAutoSubmitted(run)`:
   - auto/mock submitted → **Confirmed** screen.
   - complete but needs review → **Review** screen.
   - error → back to **Report** with a submit-error banner.
6. **Review** screen: edit description → **`PATCH /api/run/[id]`** (re-runs agent on same run id) or approve → **`POST /api/submit`**.

> Note: although the client polls, `POST /api/run` actually runs the agent synchronously before responding (the run is already `complete` by the time polling starts). Polling is effectively a one-shot fetch today.

### Run state

Persisted in Upstash Redis as `run:<uuid>` with a 1-hour TTL (`app/api/store.ts`). No DB, no auth, single shared store.

---

## AI Pipeline

Trace: **UI → API → Agent → Open311**

### 1. UI → API

`page.tsx` / `debug/page.tsx` build a `CivicReport` and `POST /api/run`.

### 2. API → Orchestrator (`finishAgentRun.ts`)

`finishAgentRun(run, { text, lat, lng })`:

1. **`resolveReportCoordinates`** (`resolveReportLocation.ts`):
   - Reverse-geocodes GPS to get the city.
   - `extractPlaceFromDescription` regex-scans the text for a street/intersection/landmark.
   - If a place is found, `forwardGeocode` it (slash-format intersection variants tried first). On success, **the described location overrides GPS**. On failure → `source: 'description_not_found'`, `geocodeFailed: true` (forces review, no silent GPS fallback).
2. **`runCivicAgent`** (`agent.ts`) runs the LLM tool loop (below).
3. Tool results → `AgentStep[]`.
4. **`evaluateReviewGate`** (`reviewGate.ts`) parses `classify_report` + `draft_submission` outputs.
5. `needsReview = gate.needsReview || geocodeFailed`.
6. If **no review needed** → `submitTo311`. Mock-in-live-mode mismatch throws; live 403 becomes a `write_access_denied` error step. Sets `submission: 'auto' | 'mock'`.

### 3. The agent (`agent.ts` → `runCivicAgent`)

Vercel AI SDK `generateText` with `stopWhen: stepCountIs(5)` and a system prompt enforcing tool order. `runCivicAgent` accepts `{ text?, lat, lng, photoUrl? }`. Five tools:

| Tool | Purpose | Notes |
|------|---------|-------|
| `resolve_location` | GPS → address via `reverseGeocode` | Always first |
| `classify_report` | LLM (`generateText` + `Output.object`) → `{ category, service_code, severity 1–5, confidence 0–1, reasoning, location_mention, is_different_location }` against the live SF service catalog | Built per-run via `buildClassifyReport(photoUrl?)`; output normalized to a valid `service_code` via `normalizeSf311Classification` |
| `geocode_address` | Forward-geocode a `location_mention` when `is_different_location` | |
| `check_location_history` | Prior-report lookup | **Stub** → `getLocationHistory` (random 0–3) |
| `draft_submission` | Assemble `DraftSubmissionPayload` | Hard-codes reporter identity: `CivicPulse User / report@civicpulse.app` |

**Multimodal (Claude Vision) when a photo is present:** if `photoUrl` is set, both the orchestrator `generateText` call **and** the `classify_report` internal classifier call switch from a `prompt` string to a multimodal `messages` array (text + `{ type: 'image', image: photoUrl }`). The classifier is instructed to use the photo for category/severity and to trust the image over the text when they disagree. When no photo is present, both calls use the original `prompt` string **verbatim** — the text-only path is unchanged.

> The agent does **not** submit. Submission is owned by `finishAgentRun` / `submit311`. (The legacy root `agent/` package still has a `submit_to_311` tool — that copy is dead.)

### 4. Review gate (`reviewGate.ts`)

`AUTO_SUBMIT_MIN_CONFIDENCE = 0.8`, `AUTO_SUBMIT_MAX_SEVERITY = 3`. Review is required (safe default) when classification or draft is missing/invalid, confidence `< 0.80`, or severity `> 3`.

### 5. Submit (`submit311.ts` → `sf311Submit.ts`)

- `useLive = isSf311LiveSubmitEnabled() && isSf311Configured() && city === 'san_francisco'`.
- **Mock** (default): returns `MOCK-SAN_FRANCISCO-<timestamp>`.
- **Live**: `postSf311ServiceRequest` form-encodes the payload, fetches the service definition to fill required attributes, POSTs to `SF_OPEN311_SUBMIT_URL` with `X-App-Token` + Basic `base64(id:secret)` + `api_key` in body. 403 → friendly `write_access_denied` message.

### Open311 auth & catalog

- Creds: `SF_OPEN311_APP_TOKEN` (API Key ID) + `SF_OPEN311_SECRET_TOKEN` (API Key Secret).
- **Reads work (200); writes 403** — SF sunset (see Open Questions).
- POC catalog = **7 partner service codes** (`SF311_POC_SERVICES`), used as fallback if the live `services.json` fetch fails.

---

## Existing Extension Points

### Photo input — IMPLEMENTED (Milestone 01)

- **UI:** `app/page.tsx` `ReportScreen` — the 📷 button opens a hidden `<input type="file" accept="image/*" capture="environment">`, reads the file to a base64 data URL, previews it with a remove (×) control, and validates type + 4MB cap (`MAX_PHOTO_BYTES`).
- **Transport:** carried in the existing `CivicReport.photoUrl` field (no shape change); threaded `POST /api/run` → `finishAgentRun` → `runCivicAgent`, and `PATCH /api/run/[id]` re-passes `run.input.photoUrl` so edit-and-rerun keeps the image.
- **AI:** drives the multimodal classifier (see AI Pipeline §3).
- **Still open for V2:** object storage instead of base64-in-Redis; sending Open311 `media_url` in `sf311Submit.ts`; optional EXIF GPS.

### Voice input — IMPLEMENTED (Milestone 02)

- **UI-only, additive:** `app/page.tsx` `ReportScreen` — the 🎤 button toggles the browser **Web Speech API** (`getSpeechRecognitionCtor()` resolves `SpeechRecognition` / `webkitSpeechRecognition`). Live transcript (`continuous` + `interimResults`, `lang='en-US'`) is appended into the existing `text` field and remains fully editable. Disabled with a tooltip when unsupported; mic-denial shows an inline message; recognition is cleaned up on unmount.
- **No backend:** no audio upload/storage, no new routes — voice becomes text in the browser and then uses the existing flow. `CivicReport.voiceUrl` remains declared but **unused** (intentional; no audio is persisted).

### Remaining input ideas

- Open311 `media_url` attachment, EXIF-based location, and server-side transcription (Whisper) are all still future work — none are wired today.

### Location history (known stub)

- `lib/getLocationHistory.ts` returns a **random** `priorReportCount` 0–3 with consistent derived fields. Header comment: _"POC stub — Replace with Open311/DataSF in V2."_
- Wired into the `check_location_history` agent tool (`agent.ts:109`).
- Replace with a real Open311 read (reads return 200) or DataSF query keyed on lat/lng.

### Multi-city support

- `config/cities.ts` defines **5 CA cities** (SF, Oakland, San Jose, Sacramento, Long Beach) with per-city Open311 base URLs and `apiKeyEnvVar` names.
- Only **San Francisco** is wired for submit (`submit311.ts` hard-checks `config.id === 'san_francisco'`; SF-specific modules in `lib/sf311*`). Oakland uses SeeClickFix, etc. — env vars (`OAKLAND_311_API_KEY`, …) are named but unset.
- Extension: generalize the `sf311*` modules behind a per-city adapter keyed off `CityConfig`.

### Live 311 submit (gated, ready)

- Full live POST path exists (`sf311Submit.ts`), gated behind `SF_OPEN311_LIVE=true`. Flip the flag when a working integration is available.

### Service catalog

- `SF311_POC_SERVICES` (7 types) is both the prompt catalog and the offline fallback. `getSf311Services` caches the live catalog for 1h. Expanding past 7 types only needs the live fetch to return more (or editing the constant).

### Diagnostics / dev surfaces

- `GET /api/test/311-status` — env presence + live read/write probes + fix message.
- `npm run test:311` (`scripts/test-311-access.mjs`) — standalone probe; exits 0 in POC if reads work.
- `/debug` page — full run inspector (summary, steps, raw JSON toggle, 311-status button, approve + edit/rerun, mock labels).

---

## Technical Debt

1. **Stale legacy `agent/` package (root).** `agent/index.ts` is the original POC: keyword-based `classify_report`, hard-coded `submit_to_311` with `api_key: 'yourapikey'` pointing at a dev endpoint, `check_location_history` returning fixed counts, and an `0.90` confidence threshold in its prompt. It is **fully superseded** by `ui/lib/agent.ts` and appears unused (own `node_modules`, separate `package.json`). Candidate for deletion to avoid confusion.
2. **Polling is misleading.** `POST /api/run` runs the agent synchronously (can take many seconds; `maxDuration = 60`), so the client's 1s poll loop and the time-based `AgentProgressBar` (35s CSS animation, 7s message rotation) are cosmetic, not driven by real step events. `agent.ts` accepts an `onStep` callback that `finishAgentRun` never passes — real streaming/progress is unwired.
3. **Hard-coded reporter identity.** `draft_submission` always uses `CivicPulse User / report@civicpulse.app`. No real user identity/contact capture (`CivicReport.userId` and `voiceUrl` are unused).
4. **Base64 photo persists in Redis.** `photoUrl` (a data URL, ≤ 4MB by client guard) is stored inside the `AgentRun` so edit-and-rerun can reuse it. This roughly doubles in transit and counts against Upstash request/size limits — fine for the POC, but object storage (URL-only `photoUrl`) is the V2 fix. The image is also sent to Claude twice per run (orchestrator + classifier), adding token cost/latency.
5. **No tests.** No unit/integration tests anywhere; only the manual `test:311` probe.
6. **Secrets in `.env.local`.** Real Anthropic key, Upstash token, and SF tokens are present. Confirm gitignored before any commit/push.
7. **Default app chrome.** `layout.tsx` still has `title: "Create Next App"`; `ui/README.md` is the unmodified create-next-app template.
8. **Tailwind only on `/debug`.** The product screens (`page.tsx`) use inline styles; the debug page uses Tailwind utility classes. Two styling conventions.
9. **`normalizeMentionForGeocode` deprecated** (kept for callers); `sf311SubmitAuthHeaders` deprecated alias of `sf311AuthHeaders`.
10. **Single shared Redis store, no auth.** Any client can read any run by id; 1h TTL only.

---

## Open Questions

1. **SF Open311 write access is blocked.** SF discontinued third-party Open311 POST (July 12, 2025). `POST /requests.json` returns **403 "Invalid or missing api_key"** for every key/auth format; reads (GET) still return 200. Not fixable by rotating credentials. Sunset-notice contact: **carson.chin@sfgov.org** / 311 / **415-701-2311**. → Is there a replacement programmatic submit path, or should this stay mock-only?
2. **Async vs sync agent run.** Should `POST /api/run` return immediately and run the agent in the background (true polling + streamed `onStep` progress), or keep the synchronous model? Current setup risks the 60s `maxDuration` ceiling on slow runs.
3. **User identity.** Do reports need real reporter name/email/phone (and consent), or is the anonymous CivicPulse identity acceptable?
4. **Storage for media.** Photos are base64-in-Redis today. Where should they live (Vercel Blob, S3), with what retention/privacy, and should Open311 `media_url` be populated?
5. **Voice UX.** Transcript currently **appends** to existing text (`lang='en-US'`). Should it replace instead? Offer language selection? For unsupported browsers (e.g. Firefox), is a disabled button acceptable or should it be hidden?
6. **Photo-only / photo-vs-text trust.** Should a photo with no text be submittable? The classifier is told to trust the photo over conflicting text — is that the desired precedence?
7. **Confidence threshold.** Currently `0.80` (lowered from `0.90` during the POC). Is `0.80` the intended production value?
8. **Beyond SF.** Are the other 4 configured cities in scope, and who owns their Open311/SeeClickFix credentials?

---

## Recommended Order of Implementation

- [x] **Photo input (Milestone 01 — done):** file picker + preview in `ReportScreen`; `photoUrl` (base64 data URL) threaded through `CivicReport` → `finishAgentRun` → `runCivicAgent`; multimodal `classify_report`.
- [x] **Voice input (Milestone 02 — done):** 🎤 button drives the browser Web Speech API; transcript fills the existing `text` field; no backend.

Remaining, roughly in priority order:

1. **Repo hygiene (fast):** delete/quarantine the stale root `agent/` package; fix `layout.tsx` metadata; confirm `.env.local` is gitignored; replace the template `README`.
2. **Media to object storage:** move `photoUrl` off base64-in-Redis to Vercel Blob/S3 (URL-only); optionally populate Open311 `media_url` in `sf311Submit.ts`. Removes the Redis size risk + double token cost.
3. **Real progress / async run:** thread `onStep` from `finishAgentRun` into `runCivicAgent`, persist steps incrementally, and make the client poll meaningful (replaces the fake progress bar).
4. **Real location history:** replace `getLocationHistory` with an Open311 read (reads work) or DataSF query.
5. **Tests:** unit-test `reviewGate`, `extractPlaceFromDescription`/`geocodeQueryVariants`, and `resolveReportLocation`; integration-test the `/api/run` happy path with mock submit.
6. **Live submit / multi-city (blocked / later):** flip `SF_OPEN311_LIVE` once SF provides a path; generalize `sf311*` into a per-city adapter for the other 4 cities.

---

PROJECT_CONTEXT.md refreshed. Reflects Photo (M01) + Voice (M02) input. Ready for milestone review.
