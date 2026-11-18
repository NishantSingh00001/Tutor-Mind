# Security review — 20-point pen-test checklist (2026-11-19)

TutorMind is a static frontend (`practice.html`, `progress.html`, `how.html`,
`index.html`) plus one Vercel serverless function (`api/grade.js`) that sends
photographed handwritten answers (and optionally a reference PDF) to Gemini
vision for grading. No accounts, no database — mastery history lives in the
visitor's own `localStorage`. Reviewed `api/grade.js` and the
`practice.html` client logic in full.

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | HTTP/2 Rapid Reset | N/A | Vercel serverless function; no self-managed HTTP server. |
| 2 | bcrypt 72-byte limit | N/A | No passwords/accounts. |
| 3 | SAML signature bypass | N/A | No SAML. |
| 4 | nOAuth | N/A | No OAuth. |
| 5 | GraphQL alias batching | N/A | No GraphQL. |
| 6 | TOTP replay | N/A | No TOTP/2FA. |
| 7 | ReDoS | No | The only regexes (`api/grade.js`: code-fence stripping, `/^data:([^;]+);base64,(.*)$/` for data-URL parsing, a bounded `/\{[\s\S]*\}/`; `practice.html`'s `esc()`: `/[&<>]/g`) are small fixed patterns with no nested quantifiers. |
| 8 | JWT algorithm confusion | N/A | No JWTs. |
| 9 | HTTP request smuggling | N/A | Vercel's edge terminates HTTP. |
| 10 | Web cache poisoning | N/A | `/api/grade` sets no cache headers; every response is a fresh, per-submission grading result. |
| 11 | Spoofed X-Forwarded-For | N/A | No IP-based logic anywhere in this app. |
| 12 | Postgres views bypassing RLS | N/A | No database. |
| 13 | `Math.random()` for security tokens | N/A | No tokens/ids generated — no auth, no session. |
| 14 | Timing attacks on secret comparison | N/A (see finding below) | The "Pro" unlock code is compared with a plain `===` after normalization, but since the comparison runs entirely in the visitor's own browser against a value already present in their own downloaded JS, a timing side-channel is moot — the code is already fully readable client-side (see finding 1). |
| 15 | Padding oracle | N/A | No encryption. |
| 16 | Server-side prototype pollution | No | `api/grade.js` reads named fields off the parsed body with explicit type/array checks (`Array.isArray(body.answerImages)`, etc.) — no bulk merge of untrusted input. |
| 17 | Server-side template injection | N/A | No server-side templating; responses are JSON. Client-side, every dynamic value inserted via `innerHTML` in `practice.html` (transcription, feedback, mistake type, grade) is passed through `esc()`, which escapes `&`/`<`/`>` — confirmed for every AI-returned field rendered. |
| 18 | XXE | N/A | No XML parsing (the "reference PDF" path sends the PDF's raw bytes to Gemini as `inline_data`; nothing here parses XML or any PDF-internal markup itself). |
| 19 | Cross-site WebSocket hijacking | N/A | No WebSocket endpoint. |
| 20 | Unicode username normalization | N/A | No usernames/login. |

## Findings outside the 20-point list

1. **The "Pro" paid-feature gate is unchecked server-side, and the unlock
   code is shipped in cleartext — matching your own standing "vibe-code"
   rule #4.** In `practice.html`: `CONFIG.PRO_CODE` is the literal string
   `"TUTORMIND-PRO-2026"`, visible to anyone who views the page source, and
   `isPro()` just reads `localStorage.getItem("tm_pro")` — any visitor can
   set that to `"1"` in their browser console and skip the code entirely.
   More importantly, **`api/grade.js` doesn't read or enforce any of it**:
   it never checks `body.pro`, never caps `answerImages.length` /
   `questionImages.length`, and never checks payload size — the per-request
   image-count limit, the "3 gradings/day" counter, and the reference-PDF
   gate are all pure client-side UI state with zero server-side backing.
   README is upfront that the code is a soft, documented default ("change
   `PRO_CODE` in practice.html"), so this isn't a hidden secret being
   leaked — but as currently built it provides **no actual cost control**
   on the token-hungry Gemini calls it exists to gate, which matters because
   there's also no other rate limiting on the endpoint (finding 2).
   Suggested fix (not applied — pending your approval): enforce the image
   count, PDF-grounding eligibility and a per-IP daily grading count
   server-side in `api/grade.js`, independent of whatever the client sends.
2. **No server-side upload size cap (vibe-code rule #3).** `practice.html`
   enforces `MAX_PAYLOAD_MB: 4.2` client-side before submitting, but
   `api/grade.js` itself never checks the size of `answerImages`,
   `questionImages` or `refPdf.data` before building the Gemini request —
   a caller that talks to `/api/grade` directly (bypassing the page
   entirely) can send an arbitrarily large payload. Suggested fix (not
   applied — pending your approval): re-check total payload size in
   `api/grade.js` itself, not only in the client.
3. **No server-side rate limiting + permissive CORS**, same pattern as
   `praxis`, `autoredteam` and `verifyai` elsewhere in this portfolio:
   `Access-Control-Allow-Origin: *` with no per-IP limiting on an endpoint
   that calls Gemini vision (a relatively expensive call per the README's
   own "grading uses a lot per request" note).

## Summary

All 20 checklist items are not applicable or already handled (XSS escaping
for AI output is consistently applied via `esc()`). Three related findings
outside the list, all variants of the same gap: the client-side "Pro" gate,
upload-size cap, and daily-grading limit have no server-side enforcement in
`api/grade.js`, and the endpoint itself has no rate limiting or CORS
restriction — so none of the cost controls this app is designed around
actually bind at the server. No fix has been applied here — per your
standing instructions, this is reported for approval before any change is
made.
