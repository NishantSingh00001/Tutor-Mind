# TutorMind

**Photograph your handwritten work in any subject. Get it marked, with mistakes explained and mastery tracked.**

TutorMind reads a student's handwritten answers with a vision AI, marks each answer against the question and a reference, explains the *type* of mistake, and keeps a record of mastery per subject. Subjects: Maths, English (Lit + Grammar), History, Geography, Hindi, and Other.

---

## How it works

1. **Transcribe first** — the AI writes out what it read from your photo, shown back to you as *"what I read"* so a misread never silently becomes a wrong mark.
2. **Mark against the reference** — using the question paper plus either a **book name + live web search** (free) or an **uploaded reference PDF** (Pro).
3. **Explain** — per-answer feedback and the mistake type.
4. **Track mastery** — saved on the device, shown on the Progress page.

Grading runs in a serverless function (`/api/grade`) that calls **Google Gemini** (multimodal — it reads images and PDFs). The key stays server-side.

---

## Free vs Pro

| | Free | Pro (unlock code) |
|---|---|---|
| Subjects | all | all |
| Answer pages | 1 per paper | multiple |
| Reference | book name + web search | + upload your own PDF |
| Gradings / day | 3 | unlimited |

Pro is the heavy, token-hungry path (PDF grounding, multi-page), which is why it's gated. Default unlock code: **`TUTORMIND-PRO-2026`** (change `PRO_CODE` in `practice.html`).

---

## Pages

```
tutormind/
├── index.html      # Home
├── practice.html   # The grader (subject, question, reference, answer photos)
├── progress.html   # Mastery per subject (stored on device)
├── how.html        # Method + honest limits
├── style.css       # Shared Graph Paper styling
├── api/
│   └── grade.js    # Serverless → Gemini vision grading
└── README.md
```

---

## Deploying to Vercel (free)

1. Push this folder to a GitHub repo.
2. Vercel: **Add New → Project → Import** → Framework **Other**, build settings empty.
3. Get a free Gemini key at **[Google AI Studio](https://aistudio.google.com/app/apikey)**.
4. Vercel → **Settings → Environment Variables** → add `GEMINI_API_KEY` = your key (Production + Preview).
5. Deploy. Vercel auto-detects `api/grade.js`.

The grader only runs on the deployed site (where the key + function exist). In a local/static preview, use **"See a sample result"**. Image downscaling, uploads, and the UI work everywhere.

---

## Honest limits

- **Handwriting reading is imperfect**, especially messy writing and **Hindi / Devanagari** — always check the transcription.
- **It does not download textbooks** — that would be copyright infringement, and no legitimate free API does it. Free grading uses the book *name* + web search; upload a chapter you're allowed to use for exact grounding (Pro).
- **Whole textbooks are too large** for the free tier (hard request-size + token limits). Use a chapter or a few pages. The client caps uploads at ~4.2 MB to stay within Vercel's request limit.
- **Essay/literature marks are subjective** — treat as structured feedback, not an official grade.
- Free Gemini is rate-limited; grading uses a lot per request, so you may hit limits — wait a minute, or use Pro.

---

## Configuration

- **Models:** `MODELS` in `api/grade.js` (Flash-Lite → Flash → newest). The first your key can use without quota wins.
- **Limits / code:** `CONFIG` at the top of `practice.html`.

---

*A study aid, not a substitute for your teacher. Your mastery record stays on your device.*
