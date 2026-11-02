// Syntaz's AI connector: talks to the user's chosen AI straight from the browser (no server), with the user's own
// key. Used by the Chrome extension, Syntaz Lite, the website chat and the desktop app (the same file; Lite and the
// website chat get a copy inside them, made by scripts/sync-ai.py).
//
// Messages use one neutral shape: { role: "system"|"user"|"assistant"|"tool", content: string | parts,
// toolCalls?: [{ id, name, args }], toolCallId? } with parts [{ type: "text", text } | { type: "image", url: "data:…" }].
// Most providers speak the OpenAI chat format; Anthropic (Claude) uses its Messages API (browser access is allowed
// with the "anthropic-dangerous-direct-browser-access" header; the key is the user's own and stays in this browser).
"use strict";
(function (root) {
  const PROVIDERS = {
    gemini: { name: "Google Gemini", free: true, base: "https://generativelanguage.googleapis.com/v1beta/openai", keyPage: "https://aistudio.google.com/apikey", keyHint: "AIza… or AQ.…", pictures: "gemini", models: ["gemini-3.1-flash-lite", "gemini-3.6-flash"] },
    openai: { name: "OpenAI", base: "https://api.openai.com/v1", keyPage: "https://platform.openai.com/api-keys", keyHint: "sk-…", pictures: "openai" },
    anthropic: { name: "Anthropic (Claude)", base: "https://api.anthropic.com/v1", keyPage: "https://platform.claude.com/settings/keys", keyHint: "sk-ant-…", pictures: null, models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
    xai: { name: "xAI (Grok)", base: "https://api.x.ai/v1", keyPage: "https://console.x.ai/", keyHint: "xai-…", pictures: "openai" },
    groq: { name: "Groq", base: "https://api.groq.com/openai/v1", keyPage: "https://console.groq.com/keys", keyHint: "gsk_…", pictures: null, prefer: ["openai/gpt-oss-120b"] },
    huggingface: { name: "Hugging Face", base: "https://router.huggingface.co/v1", keyPage: "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained", keyHint: "hf_…", pictures: "huggingface", prefer: ["openai/gpt-oss-120b"] },
    custom: { name: "My own AI server (LM Studio, Ollama, …)", base: "http://127.0.0.1:1234/v1", keyPage: "", keyHint: "(usually none)", pictures: null, custom: true },
  };
  const NOT_CHAT = /embed|whisper|tts|dall-e|moderation|rerank|transcribe|image|imagine|imagen|audio|realtime|search|vision-preview|computer-use|guard|playai|orpheus|distil|veo|lyria|aqa|learnlm|gemma-3n/i;
  // Claude models that accept server-side refusal fallbacks ("default" picks the fallback by refusal category).
  const CLAUDE_FALLBACK = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
  const HF_IMAGE_MODEL = "stabilityai/stable-diffusion-3-medium-diffusers";
  const GEMINI_PICTURE_MODELS = ["gemini-3.1-flash-image", "gemini-2.5-flash-image"];

  class AiError extends Error {
    constructor(message, { status = 0, key = false, retryAfter = 0 } = {}) {
      super(message);
      this.status = status;
      this.key = key;
      this.retryAfter = retryAfter;
    }
  }

  const providerOf = (cfg) => PROVIDERS[cfg.provider] || PROVIDERS.gemini;
  const baseOf = (cfg) => String(cfg.base || providerOf(cfg).base).replace(/\/+$/, "");
  const isOpenAiCom = (cfg) => /\/\/api\.openai\.com\//.test(baseOf(cfg) + "/");

  function headers(cfg, json = true) {
    const h = json ? { "Content-Type": "application/json" } : {};
    if (cfg.provider === "anthropic") {
      return { ...h, "x-api-key": cfg.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    }
    if (cfg.key) h.Authorization = `Bearer ${cfg.key}`;
    return h;
  }

  /** A provider's error as plain words the user can act on. */
  function explain(cfg, status, body) {
    const name = providerOf(cfg).name;
    let detail = "";
    try {
      const j = JSON.parse(body);
      detail = (j.error && (j.error.message || j.error)) || j.message || "";
      if (Array.isArray(j) && j[0] && j[0].error) detail = j[0].error.message;
    } catch {
      detail = String(body || "").slice(0, 200);
    }
    detail = String(detail);
    if (status === 0) return new AiError(cfg.provider === "custom" ? `Can't reach your AI server at ${baseOf(cfg)}. Is it running (LM Studio → Developer → Start Server)?` : `Can't reach ${name}. Check your internet connection.`);
    if (status === 401 || status === 403 || (status === 400 && /api.?key|invalid.*(key|token|credentials)|incorrect api key/i.test(detail))) return new AiError(`${name} says your key doesn't work. Paste the whole key again in Settings (⚙).`, { status, key: true });
    if (status === 402 || /insufficient_quota|credit balance|exceeded your current quota|billing|spending limit|payment required/i.test(detail)) {
      if (/free_tier|FreeTier|limit: 0/.test(detail)) return new AiError(`${name}'s free tier doesn't include this. Turn on billing for your key, or choose another model or AI.`, { status });
      return new AiError(`Your ${name} account has no credit left. Add credit or a payment method in your ${name} account, then try again.`, { status });
    }
    if (status === 429 && /per ?day|PerDay|daily/i.test(detail)) return new AiError(`Today's free limit for this model is used up. Choose another model (⚙) or try again tomorrow.`, { status });
    if (status === 429) {
      const wait = Number((/"retryDelay"\s*:\s*"(\d+)/.exec(body) || [])[1] || 0);
      return new AiError(`${name} says: too many requests right now. Wait a moment and try again.`, { status, retryAfter: wait });
    }
    if (status === 404) return new AiError(`${name} doesn't know this model. Choose another one in Settings (⚙).`, { status });
    if (status === 413 || /context|too long|maximum.*tokens/i.test(detail)) return new AiError(`The conversation is too long for this model. Start a new chat.`, { status });
    if (status >= 500) return new AiError(`${name} is having problems right now (HTTP ${status}). Try again in a moment.`, { status });
    return new AiError(`${name}: ${detail || `HTTP ${status}`}`.slice(0, 300), { status });
  }

  async function request(cfg, path, { method = "POST", body, signal, raw = false } = {}) {
    let res;
    try {
      res = await fetch(`${baseOf(cfg)}${path}`, { method, headers: headers(cfg, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      throw explain(cfg, 0, "");
    }
    if (raw) return res;
    const text = await res.text();
    if (!res.ok) throw explain(cfg, res.status, text);
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError(`${providerOf(cfg).name} sent an answer Syntaz couldn't read.`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Models and keys
  // ---------------------------------------------------------------------------------------------------------------
  const released = (m) => (typeof m.created === "number" ? m.created : Date.parse(m.created_at || "") / 1000 || 0);
  const version = (id) => Number((/(\d+(?:\.\d+)?)/.exec(id) || [])[1] || 0);

  /** Chat models this key may use, best first. */
  async function listModels(cfg, signal) {
    const p = providerOf(cfg);
    const data = await request(cfg, cfg.provider === "anthropic" ? "/models?limit=100" : "/models", { method: "GET", signal });
    let ids = (data.data || [])
      .filter((m) => m && typeof m.id === "string" && !m.deprecated_at)
      .sort((a, b) => released(b) - released(a) || version(b.id) - version(a.id))
      .map((m) => m.id.replace(/^models\//, ""))
      .filter((id) => !NOT_CHAT.test(id) && !(cfg.provider === "gemini" && !/^gemini-/.test(id)) && !(cfg.provider === "openai" && !/^(gpt-|o\d|chatgpt-)/.test(id)));
    const first = (p.models || p.prefer || []).filter((m) => ids.includes(m));
    ids = [...first, ...ids.filter((m) => !first.includes(m))];
    return ids;
  }

  /** Checks a key by listing its models and asking the first one a tiny question. */
  async function checkKey(cfg, signal) {
    const models = await listModels(cfg, signal);
    if (!models.length) throw new AiError(`${providerOf(cfg).name} offers no chat models for this key.`);
    const model = models.includes(cfg.model) ? cfg.model : models[0];
    await chat({ ...cfg, model }, { messages: [{ role: "user", content: "Reply with: OK" }], maxTokens: 1024, signal });
    return { models: models.slice(0, 30), model };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Chat (streamed), with tools (for Syntaz's browser actions)
  // ---------------------------------------------------------------------------------------------------------------
  const asText = (content) => (typeof content === "string" ? content : (content || []).filter((p) => p.type === "text").map((p) => p.text).join("\n"));

  function toOpenAi(messages) {
    return messages.map((m) => {
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: asText(m.content) || " " };
      if (m.role === "assistant") {
        return { role: "assistant", content: asText(m.content) || (m.toolCalls && m.toolCalls.length ? null : " "), ...(m.toolCalls && m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } })) } : {}) };
      }
      if (typeof m.content === "string") return { role: m.role, content: m.content };
      return { role: m.role, content: m.content.map((p) => (p.type === "image" ? { type: "image_url", image_url: { url: p.url } } : { type: "text", text: p.text })) };
    });
  }

  function toAnthropic(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => asText(m.content)).join("\n\n");
    const out = [];
    const push = (role, blocks) => {
      const last = out[out.length - 1];
      if (last && last.role === role) last.content.push(...blocks);
      else out.push({ role, content: blocks });
    };
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        const parts = typeof m.content === "string" ? [{ type: "text", text: m.content || " " }] : m.content.map(imageOrText);
        push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: parts }]);
      } else if (m.role === "assistant") {
        const blocks = [];
        const t = asText(m.content);
        if (t) blocks.push({ type: "text", text: t });
        for (const c of m.toolCalls || []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || {} });
        push("assistant", blocks.length ? blocks : [{ type: "text", text: " " }]);
      } else {
        push("user", typeof m.content === "string" ? [{ type: "text", text: m.content || " " }] : m.content.map(imageOrText));
      }
    }
    return { system, messages: out };
  }
  function imageOrText(p) {
    if (p.type !== "image") return { type: "text", text: p.text || " " };
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(p.url);
    return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : { type: "image", source: { type: "url", url: p.url } };
  }

  // Settings some models reject (OpenAI's reasoning models: temperature; max_tokens is max_completion_tokens there).
  const rejected = new Map();
  const UNSUPPORTED = /unsupported|not supported|does not support|isn't supported|only the default|unrecognized|unknown (?:parameter|field)|not allowed/i;

  async function* sse(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop();
      for (const ev of events) {
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        try {
          yield JSON.parse(data);
        } catch {
          /* a broken line: skip */
        }
      }
    }
  }

  /**
   * One answer from the model. Streams text to onText; returns { text, toolCalls, stop }.
   * tools: [{ name, description, parameters (JSON Schema) }].
   */
  async function chat(cfg, { messages, tools = null, onText = null, signal, maxTokens = 4096 }) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return cfg.provider === "anthropic" ? await chatAnthropic(cfg, { messages, tools, onText, signal, maxTokens }) : await chatOpenAi(cfg, { messages, tools, onText, signal, maxTokens });
      } catch (err) {
        // Free tiers allow a few requests a minute: wait as long as the provider asks (up to a minute), once.
        if (attempt === 0 && err instanceof AiError && err.status === 429 && err.retryAfter > 0 && err.retryAfter <= 60) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, err.retryAfter * 1000 + 500);
            if (signal) signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason || new DOMException("Aborted", "AbortError"))), { once: true });
          });
          continue;
        }
        throw err;
      }
    }
  }

  async function chatOpenAi(cfg, { messages, tools, onText, signal, maxTokens }) {
    const key = `${baseOf(cfg)}|${cfg.model}`;
    for (let attempt = 0; ; attempt++) {
      const skip = rejected.get(key) || new Set();
      const body = { model: cfg.model, messages: toOpenAi(messages), stream: true };
      if (!skip.has("max_tokens")) body[isOpenAiCom(cfg) ? "max_completion_tokens" : "max_tokens"] = maxTokens;
      if (tools && tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (cfg.provider === "gemini" && /lite/.test(cfg.model) && !skip.has("reasoning_effort")) body.reasoning_effort = "none"; // faster answers
      const res = await request(cfg, "/chat/completions", { body, signal, raw: true });
      if (!res.ok) {
        const text = await res.text();
        const bad = ["max_tokens", "max_completion_tokens", "reasoning_effort"].find((p) => body[p] !== undefined && text.includes(p) && UNSUPPORTED.test(text));
        if (res.status === 400 && bad && attempt < 3) {
          rejected.set(key, new Set([...skip, bad === "max_completion_tokens" ? "max_tokens" : bad]));
          continue;
        }
        if (res.status === 400 && tools && /tool|function/i.test(text) && UNSUPPORTED.test(text)) throw new AiError(`This model can't do actions on web pages. Choose another model in Settings (⚙).`, { status: 400 });
        throw explain(cfg, res.status, text);
      }
      let text = "";
      const calls = [];
      let stop = null;
      for await (const chunk of sse(res)) {
        if (chunk.error) throw explain(cfg, 500, JSON.stringify(chunk));
        const choice = chunk.choices && chunk.choices[0];
        if (!choice) continue;
        const d = choice.delta || {};
        if (d.content) {
          text += d.content;
          if (onText) onText(d.content, text);
        }
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? calls.length;
          calls[i] = calls[i] || { id: "", name: "", argsText: "" };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function && tc.function.name) calls[i].name += tc.function.name;
          if (tc.function && tc.function.arguments) calls[i].argsText += tc.function.arguments;
        }
        if (choice.finish_reason) stop = choice.finish_reason;
      }
      const toolCalls = calls.filter(Boolean).map((c, i) => {
        let args = {};
        let argsError = "";
        try {
          args = c.argsText ? JSON.parse(c.argsText) : {};
        } catch {
          argsError = "The arguments were not valid JSON.";
        }
        return { id: c.id || `call_${Date.now()}_${i}`, name: c.name, args, argsError };
      });
      return { text, toolCalls, stop };
    }
  }

  async function chatAnthropic(cfg, { messages, tools, onText, signal, maxTokens }) {
    const { system, messages: msgs } = toAnthropic(messages);
    const body = { model: cfg.model, max_tokens: Math.max(maxTokens, 2048), messages: msgs, stream: true };
    if (system) body.system = system;
    if (tools && tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const h = headers(cfg);
    if (CLAUDE_FALLBACK.has(cfg.model)) {
      body.fallbacks = "default";
      h["anthropic-beta"] = "server-side-fallback-2026-07-01";
    }
    let res;
    try {
      res = await fetch(`${baseOf(cfg)}/messages`, { method: "POST", headers: h, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      throw explain(cfg, 0, "");
    }
    if (!res.ok) throw explain(cfg, res.status, await res.text());
    let text = "";
    let stop = null;
    const blocks = [];
    for await (const e of sse(res)) {
      if (e.type === "error") throw explain(cfg, 500, JSON.stringify(e));
      if (e.type === "content_block_start") blocks[e.index] = e.content_block.type === "tool_use" ? { id: e.content_block.id, name: e.content_block.name, json: "" } : null;
      else if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
        text += e.delta.text;
        if (onText) onText(e.delta.text, text);
      } else if (e.type === "content_block_delta" && e.delta.type === "input_json_delta" && blocks[e.index]) blocks[e.index].json += e.delta.partial_json;
      else if (e.type === "message_delta") stop = e.delta.stop_reason || stop;
    }
    if (!text && stop === "refusal") {
      text = "(Claude declined this request.)";
      if (onText) onText(text, text);
    }
    const toolCalls = blocks.filter(Boolean).map((b) => {
      let args = {};
      let argsError = "";
      try {
        args = b.json ? JSON.parse(b.json) : {};
      } catch {
        argsError = "The arguments were not valid JSON.";
      }
      return { id: b.id, name: b.name, args, argsError };
    });
    return { text, toolCalls, stop };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Pictures
  // ---------------------------------------------------------------------------------------------------------------
  /** Whether this AI can make pictures, and why not. */
  function pictureSupport(cfg) {
    const p = providerOf(cfg);
    if (p.pictures) return { available: true };
    return { available: false, reason: cfg.provider === "custom" ? "Your own AI server can't make pictures." : `${p.name} can't make pictures.` };
  }

  /** Makes one picture; returns a data: URL. */
  async function makePicture(cfg, prompt, signal) {
    const kind = providerOf(cfg).pictures;
    if (!kind) throw new AiError(`${pictureSupport(cfg).reason} To make pictures, choose OpenAI, Google Gemini (with billing on), xAI (Grok) or Hugging Face in Settings (⚙).`);
    if (kind === "gemini") {
      // Gemini's own API (its newer image models only work there). Its free tier allows no pictures at all.
      let problem = new AiError("Google Gemini didn't return a picture. Try describing it differently.");
      for (const model of GEMINI_PICTURE_MODELS) {
        let res;
        try {
          res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
            signal,
          });
        } catch (err) {
          if (signal && signal.aborted) throw err;
          throw explain(cfg, 0, "");
        }
        const body = await res.text();
        if (res.status === 404) continue;
        if (res.status === 429 && /free_tier|FreeTier|limit: 0/.test(body)) throw new AiError("Google Gemini only makes pictures on a paid plan: the free tier allows none. Turn on billing for your key in Google AI Studio (aistudio.google.com → Billing), or choose OpenAI, xAI or Hugging Face.");
        if (!res.ok) throw explain(cfg, res.status, body);
        const part = ((JSON.parse(body).candidates || [])[0]?.content?.parts || []).find((x) => x.inlineData && x.inlineData.data);
        if (part) return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
        break;
      }
      throw problem;
    }
    if (kind === "huggingface") {
      let res;
      try {
        res = await fetch(`${new URL(baseOf(cfg)).origin}/hf-inference/models/${HF_IMAGE_MODEL}`, { method: "POST", headers: { ...headers(cfg), Accept: "image/png" }, body: JSON.stringify({ inputs: prompt }), signal });
      } catch (err) {
        if (signal && signal.aborted) throw err;
        throw explain(cfg, 0, "");
      }
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("image/")) throw explain(cfg, res.ok ? 502 : res.status, await res.text());
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
    }
    // OpenAI-style image API (OpenAI, xAI): the newest image model the key lists.
    const data = await request(cfg, "/models", { method: "GET", signal });
    const ids = (data.data || []).filter((m) => typeof m.id === "string").sort((a, b) => released(b) - released(a) || version(b.id) - version(a.id)).map((m) => m.id);
    const model = ids.find((id) => /^gpt-image/.test(id)) || ids.find((id) => /image/.test(id) && !/vision/.test(id)) || ids.find((id) => /^dall-e-3/.test(id));
    if (!model) throw new AiError(`${providerOf(cfg).name} doesn't offer a picture model with this key.`);
    const body = { model, prompt, n: 1, size: "1024x1024", ...(/^gpt-image/.test(model) ? {} : { response_format: "b64_json" }) };
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await request(cfg, "/images/generations", { body, signal, raw: true });
      const text = await res.text();
      if (res.status === 400) {
        const bad = ["size", "response_format", "n"].find((p) => body[p] !== undefined && text.includes(p) && UNSUPPORTED.test(text));
        if (bad) {
          delete body[bad];
          continue;
        }
      }
      if (!res.ok) throw explain(cfg, res.status, text);
      const first = (JSON.parse(text).data || [])[0] || {};
      if (first.b64_json) return `data:${first.mime_type || "image/png"};base64,${first.b64_json}`;
      if (first.url) {
        const img = await fetch(first.url, { signal });
        const blob = await img.blob();
        return await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.readAsDataURL(blob);
        });
      }
      break;
    }
    throw new AiError(`${providerOf(cfg).name} didn't return a picture.`);
  }

  root.SyntazAI = { PROVIDERS, AiError, listModels, checkKey, chat, makePicture, pictureSupport, providerOf, baseOf };
})(typeof self !== "undefined" ? self : globalThis);
