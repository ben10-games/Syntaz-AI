import { getAiConfig, getRateLimitConfig, type AiConfig } from "@/lib/config";
import { BodyTooLargeError, clientKey, checkClient, jsonError, readBodyText } from "@/lib/http";
import { generateImage, imageSupport } from "@/lib/images";
import { UpstreamError } from "@/lib/provider";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { prompt } → { image: "data:image/png;base64,…", model } — a picture from the user's own AI, when it can. */
export async function POST(req: Request) {
  const denied = checkClient(req);
  if (denied) return denied;
  if (!req.headers.get("content-type")?.includes("application/json")) return jsonError("Content-Type must be application/json.", 415);
  let config: AiConfig;
  let rate: ReturnType<typeof getRateLimitConfig>;
  try {
    config = getAiConfig();
    rate = getRateLimitConfig();
  } catch (err) {
    console.error("[image] configuration error:", err instanceof Error ? err.message : err);
    return jsonError("The AI service is not configured on the server.", 503);
  }
  // Pictures cost more than messages: a tighter limit (when limits are on).
  if (rate.max > 0) {
    const limited = checkRateLimit(`image:${clientKey(req, rate.trustProxy)}`, Math.max(1, Math.ceil(rate.max / 6)), rate.windowMs);
    if (!limited.ok) return jsonError(`Too many pictures. Please wait ${limited.retryAfterSeconds} seconds.`, 429, { "Retry-After": String(limited.retryAfterSeconds) });
  }
  let prompt = "";
  try {
    const body = JSON.parse(await readBodyText(req, 16 * 1024)) as { prompt?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  } catch (err) {
    return err instanceof BodyTooLargeError ? jsonError("The description is too long.", 413) : jsonError("Request body is not valid JSON.", 400);
  }
  if (!prompt) return jsonError("Say what the picture should show.", 400);
  if (prompt.length > 4000) return jsonError("The description is too long (4000 characters at most).", 400);
  const support = await imageSupport(config);
  if (!support.available) return jsonError(support.reason, 400);
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const timeout = setTimeout(() => abort.abort(), Math.max(config.timeoutMs, 120_000));
  try {
    const image = await generateImage(config, support, prompt, abort.signal);
    return Response.json({ image, model: support.model }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UpstreamError) return jsonError(err.message, err.status);
    if (abort.signal.aborted) return jsonError(`${config.providerName} took too long to make the picture.`, 504);
    console.error("[image]", err);
    return jsonError(`Couldn't reach ${config.providerName}.`, 503);
  } finally {
    clearTimeout(timeout);
  }
}
