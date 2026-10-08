// Optional: a small open-weight LLM running in the browser (WebLLM + WebGPU)
// rewrites each quest so it reads like a friend nudging you outside.
// It only gets facts we already have (type, place name, distance, season) and is told not to
// invent places, so a weak or swapped model can only make the text worse, never the quest wrong.

import { seasonOf } from './scenery.js';

const WEBLLM_URL ='https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.78/+esm';

// Any model from WebLLM's prebuilt list works here — swap freely.
export const LLM_MODELS = [
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'gemma-2-2b-it-q4f16_1-MLC',
];

export const llmSupported = () => 'gpu' in navigator;

const SYSTEM = [
  'You write tiny outdoor quests that get people off their phones.',
  'Use ONLY the facts given. Never invent place names, distances or directions.',
  'Mention the distance and direction. Be warm and a little playful. No hashtags, no emoji.',
  'Reply with JSON only: {"title": "<max 6 words>", "text": "<max 30 words>"}',
].join(' ');

let enginePromise = null;
let loadedModel = null;

export function loadLLM(model, onProgress) {
  if (!enginePromise || loadedModel !== model) {
    loadedModel = model;
    enginePromise = import(WEBLLM_URL).then((webllm) =>
      webllm.CreateMLCEngine(model, { initProgressCallback: (p) => onProgress?.(p) }),
    );
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

export function questContext(pos, date = new Date()) {
  const season = seasonOf(pos?.lat ?? 45, date);
  const h = date.getHours();
  const timeOfDay = h < 11 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return { season, timeOfDay };
}

function parseReply(raw) {
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return JSON');
  const { title, text } = JSON.parse(match[0]);
  if (typeof title !== 'string' || typeof text !== 'string' || !title.trim() || !text.trim()) {
    throw new Error('LLM JSON missing fields');
  }
  return { title: title.trim().slice(0, 60), text: text.trim().slice(0, 240) };
}

export async function flavorQuest(quest, ctx, model, onProgress) {
  const engine = await loadLLM(model, onProgress);
  const facts = {
    target: quest.thing,
    place_name: quest.placeName || null,
    distance: quest.dist != null ? `${Math.round(quest.dist)} meters` : 'nearby, anywhere outside',
    direction: quest.dir || null,
    season: ctx.season,
    time_of_day: ctx.timeOfDay,
    task: `photograph ${quest.thing}`,
  };
  const reply = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(facts) },
    ],
    temperature: 0.8,
    max_tokens: 120,
  });
  return parseReply(reply.choices[0].message.content);
}
