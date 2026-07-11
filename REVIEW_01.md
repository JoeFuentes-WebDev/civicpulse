# REVIEW_01.md

Review of the six-change batch (submit gate, describe-photo route, photo→text pre-fill, textarea state, model env var, stale-file cleanup).

**Verification method:** after each item, `npx tsc --noEmit` and the editor linter were run in `ui/` — both clean throughout. No runtime/browser execution or live model call was performed, so "verified" below means _compiles + lints + code path traced by reading_, not _exercised at runtime_.

---

## Items verified working

| # | Change | File(s) | Status |
|---|--------|---------|--------|
| 1 | Submit gate allows photo-only | `ui/app/page.tsx` | ✅ `handleSubmit` guard → `if ((!text.trim() && !photo) || !location) return;`; button `disabled={submitDisabled}` where `submitDisabled = (!text.trim() && !photo) || isLoading || isDescribing` |
| 2 | `describe-photo` route | `ui/app/api/describe-photo/route.ts` | ✅ POST `{ photoUrl }` → `{ description }`; multimodal `generateText` with the exact required prompt; reuses `CLAUDE_MODEL` |
| 3 | Photo handler pre-fills text | `ui/app/page.tsx` | ✅ `describePhoto(dataUrl)` fired from `reader.onload`; sets `isDescribing`, POSTs data URL, fills text only when empty, `finally` clears `isDescribing`, silent on failure |
| 4 | Textarea placeholder + disabled | `ui/app/page.tsx` | ✅ `placeholder={isDescribing ? 'Analyzing photo…' : 'Describe what you see…'}`, `disabled={isDescribing}` |
| 5 | Model from env | `ui/lib/agent.ts`, `ui/app/api/describe-photo/route.ts`, `ui/.env.local` | ✅ `export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';` used in both places; `ANTHROPIC_MODEL=claude-sonnet-5` added to `.env.local` |
| 6 | Delete stale files | `agent/index.ts`, `ui/app/types.ts` | ✅ Grep confirmed no imports (`app/types`: none; `agent/index`: only a doc mention; the sole `types` import is the valid `../shared/types`). Both deleted; tsc still clean |

Out-of-scope areas were left untouched as instructed: `submit311.ts`/submit logic, `draft_submission` identity fields, SF311 env vars.

---

## Deviations from the instructions

1. **Item 5 code was applied alongside item 2 (slightly out of order).** Item 2 says "use the same Claude client setup as agent.ts" and item 5 says the route must "reuse this same `CLAUDE_MODEL` constant … instead of a second hardcoded string." To avoid writing a throwaway hardcoded model string in the route and then rewriting it, I exported `CLAUDE_MODEL` from `agent.ts` first, then wrote the route importing it. The `.env.local` addition (also item 5) was done after items 3–4. Net effect matches the spec; only the sequencing shifted.

2. **Item 1 — also updated the button's visual style, not just the `disabled` attribute.** The button previously computed its background/cursor from `!text.trim() || isLoading`. If I had changed only `disabled`, a photo-only report would show an *enabled* click target styled as *disabled* (peach `#FFB8A0`, default cursor). I introduced a single `submitDisabled` const and reused it for `disabled`, `background`, and `cursor` so the visual state matches the actual gate. Same boolean the spec prescribed.

3. **Item 3 — used a functional `setText` updater instead of reading `text`.** The spec says "if `text.trim()` is empty, set text to the returned description." I implemented this as `setText(prev => (prev.trim() ? prev : description))` so the empty-check runs against the *latest* state at resolve time (avoids a stale-closure race if state changed while the request was in flight). This required widening the `ReportScreen` `setText` prop type from `(t: string) => void` to `React.Dispatch<React.SetStateAction<string>>`. Behavior is identical to the spec for the normal case and strictly safer for the racy case.

4. **Item 6 — deleted only the two named files.** The rest of the root `agent/` package (`package.json`, `tsconfig.json`, `package-lock.json`, `node_modules/`) was left in place because it wasn't named in scope. See "new issues" — that directory is now an orphaned, empty-of-source package.

---

## New issues / edge cases found while implementing

1. **`describe-photo` route has no `try/catch` around `generateText`.** If the model call throws (bad/invalid image, model error, quota), the route returns an unhandled 500. The *client* handles this gracefully (`if (!res.ok) return;` + `catch`), so the UX is correct (silent, photo-only submit still works), but the server will log an error and return 500 rather than a clean `{ description: '' }`. Low severity; consider wrapping in try/catch to return a 200 with empty description. Left as-is to honor "fail silently" on the client and to avoid scope creep.

2. **In-flight races around photo replacement / removal.** `describePhoto` is not cancellable:
   - Selecting a *second* photo while the first describe is in flight starts a second call; whichever resolves last wins (and only fills text if still empty). `isDescribing` is a single boolean, so the first `finally` can flip it to `false` while the second call is still running.
   - Removing the photo (`setPhoto(null)`) mid-flight does not abort the request; a late response can still pre-fill text (only if text is empty).
   These are benign (text only fills when empty; textarea is disabled during describe) but noted. An `AbortController` keyed to the latest selection would make it deterministic.

3. **Voice is not disabled during describe.** `isDescribing` gates the textarea and submit button, but the 🎤 button remains active. A user could dictate while a photo is being analyzed; the describe result then won't overwrite the dictated text (functional empty-check), so no data loss — but it's an inconsistent lock. Consider also disabling voice while `isDescribing`.

4. **Photo-only submit relies on the orchestrator fallback.** With no text, `runCivicAgent` uses the `agent.ts` fallback prompt ("Analyze the attached photo…") and `resolveReportCoordinates` finds no place mention → falls back to GPS coordinates. Path exists and is consistent; just flagging that photo-only reports are geolocated purely by device GPS (no description-based location).

5. **`claude-sonnet-5` validity is unverified.** The model id is now overridable via `ANTHROPIC_MODEL`, but whether `claude-sonnet-5` resolves at runtime was not exercised (no live call). If it 404s, both the agent and the new route fail together.

6. **Orphaned root `agent/` package.** After deleting `agent/index.ts`, the directory retains `package.json` (whose entry/scripts referenced the now-deleted `index.ts`), `tsconfig.json`, `package-lock.json`, and a full `node_modules/`. It does not affect the `ui/` build (separate root), but it's dead weight and a follow-up `rm -rf agent/` is worth considering.

---

## Ready for review

- [x] All six items implemented
- [x] `tsc --noEmit` clean after each item and at the end
- [x] Linter clean (`ui/`)
- [x] Out-of-scope areas (submit311, draft identity, SF311 env) untouched
- [ ] Runtime/browser behavior not exercised — recommend a manual pass: photo-only submit, photo+typed-text (no overwrite), describe-photo failure (offline), and `ANTHROPIC_MODEL` override
