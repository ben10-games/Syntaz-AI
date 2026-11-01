import "server-only";
import type { AiConfig } from "./config";
import { describeUpstreamError, fetchWithRetry, providerHeaders, UpstreamError } from "./provider";

/**
 * Making pictures with the AI the user already set up, when it can:
 * - OpenAI and xAI: POST {AI_BASE_URL}/images/generations (the OpenAI image API);
 * - Google Gemini: its own generateContent with image output (newer image models only work that way);
 *   Gemini's free tier makes no pictures, which is said plainly;
 * - Hugging Face: its text-to-image endpoint (POST router.huggingface.co/hf-inference/models/<model>, raw image back;
 *   AI_IMAGE_API=huggingface, written by setup);
 * - Anthropic, Groq and LM Studio can't make pictures.
 * The model is AI_IMAGE_MODEL (setup writes it), otherwise the newest image model this key can use.
 */

export type ImageSupport = { available: true; model: string; kind: "openai" | "huggingface" | "gemini" } | { available: false; reason: string };

const HF_ROUTER = "router.huggingface.co";
const HF_IMAGE_DEFAULT = "stabilityai/stable-diffusion-3-medium-diffusers"; // served by HF Inference (see the HF docs)
// Image models in a provider's model list, best first.
const IMAGE_MODEL = /(^|[/-])(gpt-image|dall-e|imagen|image)(-|$|\d)/i;
const PREFER = [/^gpt-image/i, /^gemini-[\d.]+-flash-image$/i, /^gemini-.*flash.*image/i, /image/i, /imagen/i, /^dall-e-3/i];
const CACHE_MS = 5 * 60_000;
// "gemini-3.1-flash-image" → 3.1 (newer first when a provider lists no dates).
const version = (id: string) => Number(/(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
let discovered: { key: string; at: number; model: string | null } | null = null;

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

async function discoverImageModel(config: AiConfig): Promise<string | null> {
  const key = `${config.baseUrl}|${config.apiKey ? config.apiKey.slice(-6) : ""}`;
  if (discovered && discovered.key === key && Date.now() - discovered.at < CACHE_MS) return discovered.model;
  let model: string | null = null;
  try {
    const res = await fetch(`${config.baseUrl}/models`, { headers: providerHeaders(config), signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as { data?: { id?: unknown; created?: unknown }[] };
      const ids = (body.data ?? [])
        .filter((m) => typeof m.id === "string")
        .sort((a, b) => Number(b.created ?? 0) - Number(a.created ?? 0) || version(String(b.id)) - version(String(a.id)))
        .map((m) => String(m.id).replace(/^models\//, ""))
        .filter((id) => IMAGE_MODEL.test(id) && !/vision|understand|edit-only/i.test(id));
      for (const p of PREFER) {
        model = ids.find((id) => p.test(id)) ?? null;
        if (model) break;
      }
    }
  } catch {
    /* can't list models: no pictures */
  }
  discovered = { key, at: Date.now(), model };
  return model;
}

/** Whether (and with which model) the configured AI can make pictures. */
export async function imageSupport(config: AiConfig): Promise<ImageSupport> {
  const h = host(config.baseUrl);
  const name = config.providerName;
  if (config.kind === "anthropic") return { available: false, reason: `${name} (Claude) can't make pictures.` };
  if (config.kind === "lmstudio") return { available: false, reason: "LM Studio can't make pictures." };
  if (h === "api.groq.com") return { available: false, reason: "Groq can't make pictures." };
  if (config.imageApi === "huggingface" || (h === HF_ROUTER && config.imageApi !== "openai")) return { available: true, kind: "huggingface", model: config.imageModel ?? HF_IMAGE_DEFAULT };
  const model = config.imageModel ?? (await discoverImageModel(config));
  if (model && h === "generativelanguage.googleapis.com") return { available: true, kind: "gemini", model };
  return model ? { available: true, kind: "openai", model } : { available: false, reason: `${name} doesn't offer a picture model with this key.` };
}

// Optional settings some image APIs reject; dropped one at a time when the provider says so.
const OPTIONAL = ["size", "response_format", "n"] as const;
const UNSUPPORTED = /unsupported|not supported|does not support|unknown (?:parameter|field)|unrecognized|not allowed|invalid.*(size|response_format)/i;

/** Makes one picture. Returns it as a data: URL (PNG/JPEG/WebP). */
/** Gemini's free tier allows no pictures at all ("limit: 0"): an answer the user can act on. */
function geminiProblem(config: AiConfig, status: number, body: string): UpstreamError {
  if (status === 429 && /free_tier|FreeTier|limit: 0/i.test(body)) {
    return new UpstreamError("Google Gemini only makes pictures on a paid plan: the free tier allows none. Turn on billing for your key in Google AI Studio (aistudio.google.com → Billing), or choose OpenAI, xAI or Hugging Face with Change AI.", 402);
  }
  return describeUpstreamError(config, status, body);
}

export async function generateImage(config: AiConfig, support: Extract<ImageSupport, { available: true }>, prompt: string, signal: AbortSignal): Promise<string> {
  if (support.kind === "gemini") {
    // https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent, asking for an image back.
    const res = await fetchWithRetry(`${new URL(config.baseUrl).origin}/v1beta/models/${encodeURIComponent(support.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey ?? "" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
      signal,
    });
    const text = await res.text();
    if (!res.ok) throw geminiProblem(config, res.status, text);
    let data: { candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] }; finishReason?: string }[] };
    try {
      data = JSON.parse(text);
    } catch {
      throw new UpstreamError("Google Gemini returned an invalid picture.", 502);
    }
    const part = data.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
    if (part?.inlineData?.data) return `data:${part.inlineData.mimeType ?? "image/png"};base64,${part.inlineData.data}`;
    const why = data.candidates?.[0]?.finishReason;
    throw new UpstreamError(why && why !== "STOP" ? `Google Gemini didn't make this picture (${why.toLowerCase().replace(/_/g, " ")}). Try describing it differently.` : "Google Gemini didn't return a picture. Try again.", 502);
  }
  if (support.kind === "huggingface") {
    // The router's HF Inference endpoint, on the same server as the chat API (router.huggingface.co).
    const res = await fetchWithRetry(`${new URL(config.baseUrl).origin}/hf-inference/models/${support.model.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "image/png", ...providerHeaders(config) },
      body: JSON.stringify({ inputs: prompt }),
      signal,
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) throw describeUpstreamError(config, res.ok ? 502 : res.status, await res.text().catch(() => ""));
    return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  }
  const body: Record<string, unknown> = { model: support.model, prompt, n: 1, size: "1024x1024" };
  // GPT Image always answers in base64 and rejects response_format; the others are asked for base64.
  if (!/^gpt-image/i.test(support.model)) body.response_format = "b64_json";
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithRetry(`${config.baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders(config) },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    if (res.status === 400 && attempt < OPTIONAL.length) {
      const bad = OPTIONAL.find((p) => body[p] !== undefined && text.includes(p) && UNSUPPORTED.test(text));
      if (bad) {
        delete body[bad];
        continue;
      }
    }
    if (!res.ok) throw describeUpstreamError(config, res.status, text);
    let data: { data?: { b64_json?: string; url?: string; mime_type?: string }[] };
    try {
      data = JSON.parse(text);
    } catch {
      throw new UpstreamError(`${config.providerName} returned an invalid picture.`, 502);
    }
    const first = data.data?.[0];
    if (first?.b64_json) return `data:${first.mime_type ?? "image/png"};base64,${first.b64_json}`;
    if (first?.url && /^https:\/\//.test(first.url)) {
      // A link to the picture: fetched here so the browser gets the image itself.
      const img = await fetch(first.url, { signal });
      const type = img.headers.get("content-type") ?? "image/png";
      if (img.ok && type.startsWith("image/")) return `data:${type.split(";")[0]};base64,${Buffer.from(await img.arrayBuffer()).toString("base64")}`;
    }
    throw new UpstreamError(`${config.providerName} didn't return a picture.`, 502);
  }
}
