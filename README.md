# CivicPulse

A civic reporting agent for San Francisco. Residents describe what they see in plain language. The agent handles everything else.

**Live demo:** [civicpulse-sandy.vercel.app](https://civicpulse-sandy.vercel.app)

-----

## What it does

Most civic reporting apps are glorified forms. You pick a category from a dropdown, fill in fields, attach a photo, submit. The friction is high enough that most people don’t bother.

CivicPulse works differently. You describe what you see — “there’s a fallen tree blocking the bike lane on Valencia” — and the agent classifies it, resolves your location, drafts the 311 report, and submits it. One sentence in. Done.

The agent makes decisions. You review them before anything gets filed.

-----

## How it works

```
User input (text / voice / photo)
  → resolve_location()          GPS coords → address, neighborhood, district
  → geocode_address()           If described location differs from GPS, use that instead
  → classify_report()           LLM classifies issue type, severity, confidence
  → check_location_history()    Prior reports at this location (Supabase in V2)
  → draft_submission()          Assembles full Open311 POST body
  → human review                User sees the draft and approves
  → submit_to_311()             POSTs to SF Open311 API
```

Six tools. The model decides the sequence. You didn’t write the decision logic — you wrote the capabilities.

-----

## Key design decisions

**Why human review before submission, not after**

A submitted 311 report triggers a city workflow that’s hard to reverse. The cost of a wrong submission is higher than the cost of one extra tap. The agent auto-submits only when confidence ≥ 90% and severity ≤ 3. High-severity or ambiguous reports pause for review.

**Why LLM classification instead of keyword matching**

Keyword matching breaks on natural language. “There’s a big hole in the road” doesn’t match “pothole”. “Needles on the playground” might be drug use or just debris. The LLM correctly classifies anything — dead animals, fallen trees, drug use — without a hardcoded category list. It also extracts location mentions and detects when the described location differs from GPS.

**Why location discrepancy detection**

If a user is reporting something they saw earlier — “abandoned truck on Chestnut and Laguna” — their GPS coordinates don’t match the described location. The agent geocodes the mentioned location and uses that instead. No manual map pin required.

**Why synchronous execution over polling**

The agent takes 35-40 seconds to run six tool calls. Initially built with background execution and polling. Vercel serverless functions terminate after the response is sent, so background callbacks never completed. Synchronous execution with `maxDuration = 60` is the right pattern here. The polling UI still works — it just resolves on the first call.

-----

## Stack

|Layer          |Technology                                 |
|---------------|-------------------------------------------|
|AI model       |Anthropic Claude (claude-sonnet-4-20250514)|
|Agent framework|Vercel AI SDK v6                           |
|Frontend       |Next.js 16 + React + TypeScript            |
|State store    |Upstash Redis (1hr TTL)                    |
|Geocoding      |Nominatim / OpenStreetMap                  |
|311 API        |SF Open311 (GeoReport v2)                  |
|Deploy         |Vercel                                     |

-----

## Project structure

```
civicpulse/
  ui/
    app/
      page.tsx              Production UI (3 screens)
      debug/page.tsx        Validating UI (internal, shows agent steps)
      api/
        store.ts            Upstash Redis: getRun / setRun
        run/route.ts        POST: runs agent synchronously
        run/[id]/route.ts   GET: poll for run state
        submit/route.ts     POST: approve and submit to 311
    lib/
      agent.ts              All 6 tools + runCivicAgent()
    shared/
      types.ts              CivicReport, AgentStep, AgentRun
    config/
      cities.ts             CA city configs (SF, Oakland, San Jose, Sacramento, Long Beach)
```

-----

## Running locally

```bash
# Clone
git clone https://github.com/JoeFuentes-WebDev/civicpulse
cd civicpulse/ui

# Install
npm install

# Environment variables
cp .env.local.example .env.local
# Add: ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

# Run
npm run dev
```

Open `localhost:3000` for the production UI.
Open `localhost:3000/debug` for the validating UI (shows agent steps in real time).

-----

## What’s mocked

- `check_location_history()` — always returns no prior reports. Real implementation queries Supabase in V2.
- `submit_to_311()` — generates a fake service request ID. Real SF 311 API key pending.

-----

## Roadmap

**V2**

- Voice input (Web Speech API)
- Photo input + vision analysis
- PWA manifest (Add to Home Screen)
- Supabase for report persistence and real location history
- Escalation engine: cron job monitors open reports, escalates to city officials if unresolved

**V3**

- Multi-city onboarding (city brings their own Anthropic API key)
- SF Mayor’s Office of Civic Innovation pilot

-----

## What I learned building this

Agentic engineering is a fundamentally different mental model from traditional frontend development. You stop writing decision logic and start writing capabilities. The model decides which tools to call and in what order based on their descriptions and the data dependencies between them.

The hardest part isn’t the AI. It’s designing the right tool boundaries, writing descriptions precise enough for the model to make correct decisions, and deciding where humans stay in the loop.

The UI challenge is different too. You’re not designing for known states — you’re designing for outcomes. The user doesn’t need to understand what the agent did. They need to trust that it did it correctly and feel in control at the moments that matter.

-----

Built by [Joe Fuentes](https://linkedin.com/in/joefuentes) · Staff Frontend Engineer · SF Bay Area