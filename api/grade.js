// TutorMind — serverless grading endpoint (Vercel Node function)
// Reads handwritten answer photos with Gemini vision, grades against the question
// and reference, returns a structured result. Key is read from GEMINI_API_KEY.

const MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.8-flash"];

// --- per-IP burst guard (added by security hardening) ---
const __rlBuckets = (globalThis.__rlBuckets = globalThis.__rlBuckets || new Map());
function __rateLimited(req, res, limit = 20, windowMs = 600000) {
  const ip = ((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const hits = (__rlBuckets.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { res.status(429).json({ error: "Too many requests from this network. Please wait a minute and try again." }); return true; }
  hits.push(now); __rlBuckets.set(ip, hits); return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (__rateLimited(req, res)) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const subject = (body.subject || "General").toString().slice(0, 40);
  const refMode = body.refMode === "pdf" ? "pdf" : "name";
  const refText = (body.refText || "").toString().slice(0, 400);
  const answerImages = Array.isArray(body.answerImages) ? body.answerImages : [];
  const questionImages = Array.isArray(body.questionImages) ? body.questionImages : [];
  const refPdf = body.refPdf && body.refPdf.data ? body.refPdf : null;
  if (!answerImages.length) return res.status(400).json({ error: "No answer sheet images provided." });

  const refLine = refMode === "pdf" && refPdf
    ? "A reference PDF is attached — grade strictly against its content."
    : (refText
        ? `Reference: "${refText}". Use web search and your knowledge to recall this material and grade against it.`
        : "No reference was given — grade against the question paper and your own knowledge, and say so if unsure.");

  const prompt =
`You are an experienced, fair examiner for ${subject}. You are given photographs of a student's HANDWRITTEN answer sheet` +
(questionImages.length ? ", the QUESTION paper," : "") +
(refMode === "pdf" && refPdf ? " and a REFERENCE PDF." : ".") + `

Steps:
1. TRANSCRIBE what the student actually wrote, as faithfully as you can. If handwriting is unclear, make your best guess and keep going.
2. ${refLine}
3. For each question/answer, award marks out of a sensible maximum, give specific feedback, and name the TYPE of mistake (e.g. "factual error", "incomplete", "misread the question", "calculation error", "no mistake").
4. Give an overall score, a max, a letter grade (A–E), and a one-line summary.
5. List 1–4 skills touched with a mastery level 0–100 based on this performance.

Return ONLY a JSON object (no markdown fences) with this exact shape:
{
 "transcription": "what the student wrote, plain text",
 "overall": {"grade":"A-E", "score": number, "max": number, "summary": "one line"},
 "items": [{"question":"short label","yourAnswer":"their answer, brief","marks":number,"max":number,"feedback":"specific","mistakeType":"short"}],
 "skills": [{"name":"skill","level":0-100}]
}
Be encouraging but honest. For essays/literature, mark by rubric and note that it's guidance.`;

  // Build multimodal parts
  const parts = [{ text: prompt }];
  function pushImg(dataUrl, label) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return;
    if (label) parts.push({ text: label });
    parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  questionImages.forEach((d, i) => pushImg(d, `Question paper page ${i + 1}:`));
  if (refMode === "pdf" && refPdf) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(refPdf.data || "");
    if (m) { parts.push({ text: "Reference document:" }); parts.push({ inline_data: { mime_type: "application/pdf", data: m[2] } }); }
  }
  answerImages.forEach((d, i) => pushImg(d, `Student answer page ${i + 1}:`));

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  // Add web search only in book-name mode (no PDF) to ground against named material.
  if (refMode === "name" && refText) payload.tools = [{ google_search: {} }];

  try {
    let data = null, lastErr = null, quotaHit = false;
    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (r.ok) { data = j; break; }
      lastErr = (j && j.error && j.error.message) ? j.error.message : ("HTTP " + r.status);
      if (r.status === 429) { quotaHit = true; continue; }
      if (r.status === 404 || r.status === 403) continue;
      return res.status(502).json({ error: lastErr });
    }
    if (!data) {
      return res.status(429).json({ error: quotaHit
        ? "The free Gemini tier is rate-limited right now (grading uses a lot per request). Wait a minute and try again, or unlock Pro. Last message: " + (lastErr || "quota")
        : ("No usable model for this key. Last message: " + (lastErr || "unknown")) });
    }

    const cand = data.candidates && data.candidates[0];
    const partsOut = (cand && cand.content && cand.content.parts) || [];
    let text = partsOut.map(p => p.text || "").join("").trim();
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { parsed = JSON.parse(mm[0]); } catch (e2) {} } }
    if (!parsed) return res.status(200).json({ transcription: text.slice(0, 1200), overall: { grade: "—", summary: "Couldn't structure the grade — try a clearer photo." }, items: [], skills: [] });

    return res.status(200).json({
      transcription: parsed.transcription || "",
      overall: parsed.overall || {},
      items: Array.isArray(parsed.items) ? parsed.items.slice(0, 20) : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 6) : []
    });
  } catch (err) {
    return res.status(502).json({ error: "Could not reach the grader: " + (err && err.message ? err.message : "unknown") });
  }
}
