// On-device photo check with open-weight CLIP via transformers.js.
// The photo never leaves the phone: the model is downloaded once, cached by the browser,
// and runs locally (WASM, or WebGPU when available).

import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

export const VISION_MODEL = 'Xenova/clip-vit-base-patch32';

env.allowLocalModels = false;

// Step 1: is this really outside, and not a screen? (stops "photograph a tree on your monitor")
// Short labels separated best in testing: outdoor photos scored 0.56–0.86, indoor 0.20–0.29.
const SCENE_OUTDOOR = ['outdoors', 'nature', 'a street'];
const SCENE_INDOOR = ['indoors', 'a room', 'a screen'];
const SCENE_PHRASE = { indoors: 'it was taken indoors', 'a room': 'a room', 'a screen': 'a screen' };

// Step 2: is the quest's target what the photo is of? The best target label must rank in the top 3
// and beat the median decoy by a clear margin in logit space. (Summing synonym scores was a bug:
// with 5 water labels, a beach towel scored 36% "water" by sheer label count.)
const DECOYS = [
  'a building', 'a car', 'a road', 'a wall', 'a person', 'a hand', 'furniture', 'the ground', 'sand',
  'a towel', 'an animal', 'a pavement', 'dirt', 'food', 'a book', 'a window', 'a fence', 'a sign',
];

export const OUTDOOR_MIN = 0.5;
export const MATCH_MIN = 0.5; // margin of 1.0 logit (best target ≈ 2.7× the median decoy)
const MAX_RANK = 3;

let classifierPromise = null;

export function loadVision(onProgress) {
  if (!classifierPromise) {
    classifierPromise = pipeline('zero-shot-image-classification', VISION_MODEL, {
      progress_callback: onProgress,
    });
    classifierPromise.catch(() => { classifierPromise = null; });
  }
  return classifierPromise;
}

const sum = (results, labels) => results.filter((r) => labels.includes(r.label)).reduce((acc, r) => acc + r.score, 0);

export async function verifyPhoto(blob, quest, onProgress) {
  const classify = await loadVision(onProgress);
  const image = await RawImage.fromBlob(blob);

  const scene = await classify(image, [...SCENE_OUTDOOR, ...SCENE_INDOOR]);
  const outdoor = sum(scene, SCENE_OUTDOOR);

  const decoys = DECOYS.filter((d) => !quest.labels.includes(d));
  const target = await classify(image, [...quest.labels, ...decoys]);
  // Softmax keeps logit differences: ln(p_a / p_b) = logit_a − logit_b.
  const logit = Object.fromEntries(target.map((r) => [r.label, Math.log(r.score)]));
  const best = Math.max(...quest.labels.map((l) => logit[l]));
  const decoyLogits = decoys.map((l) => logit[l]).sort((a, b) => a - b);
  const margin = best - decoyLogits[Math.floor(decoyLogits.length / 2)];
  const match = Math.max(0, Math.min(1, margin / 2));
  const rank = target.findIndex((r) => quest.labels.includes(r.label)) + 1;
  const targetOk = match >= MATCH_MIN && rank <= MAX_RANK;

  let reason = '';
  let kind = null;
  if (outdoor < OUTDOOR_MIN) {
    const indoor = scene.find((r) => SCENE_INDOOR.includes(r.label));
    kind = 'indoor';
    reason = `Looks like ${SCENE_PHRASE[indoor.label]}, not the outdoors. Nice try.`;
  } else if (!targetOk) {
    kind = 'target';
    const guess = target.find((r) => !quest.labels.includes(r.label)).label;
    reason = `Couldn't spot ${quest.thing} in that shot. It looked more like ${guess}.`;
  }

  return {
    pass: !reason,
    reason,
    kind,
    outdoor,
    match,
    rank,
    targetOk,
    scene: scene.slice(0, 3),
    top: target.slice(0, 4),
  };
}
