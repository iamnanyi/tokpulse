/* Own heuristic, deliberately not a model tokenizer. Runs only in the renderer. */
export function estimateTokens(text) {
  let units = 0;
  for (const char of text) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) units += 1.3;
    else if (/\p{Extended_Pictographic}/u.test(char)) units += 2;
    else if (/[\x00-\x7f]/.test(char)) units += 0.25;
    else units += 0.7;
  }
  return units;
}

export class SpeedWindow {
  constructor({ windowMs = 3000, idleMs = 1400 } = {}) {
    this.windowMs = windowMs;
    this.idleMs = idleMs;
    this.reset();
  }
  reset(now = 0) { this.samples = []; this.started = now; this.last = -Infinity; }
  add(text, now) {
    if (!text) return;
    if (now - this.last > this.idleMs) this.reset(now);
    this.samples.push({ time: now, tokens: estimateTokens(text) });
    this.last = now;
  }
  speed(now) {
    if (now - this.last >= this.idleMs) return null;
    this.samples = this.samples.filter(s => now - s.time < this.windowMs);
    const elapsed = Math.min(this.windowMs, now - this.started);
    if (elapsed < 500 || !this.samples.length) return null;
    return this.samples.reduce((sum, s) => sum + s.tokens, 0) / (elapsed / 1000);
  }
}

/* Replacements, contractions and formatting changes are baselined, never charged. */
export function appendedText(before, after) {
  return after.startsWith(before) ? after.slice(before.length) : '';
}

export class AppendTracker {
  constructor() { this.values = new Map(); }
  reset() { this.values.clear(); }
  baseline(entries) { for (const { key, text } of entries) this.values.set(key, text); }
  update(entries, active) {
    let delta = '';
    for (const { key, text } of entries) {
      const previous = this.values.get(key);
      // A newly mounted message may be history or the first chunk: baseline it.
      if (active && previous !== undefined) delta += appendedText(previous, text);
      this.values.set(key, text);
    }
    if (this.values.size > 1000) {
      const keep = new Set(entries.map(e => e.key));
      for (const key of this.values.keys()) if (!keep.has(key)) this.values.delete(key);
    }
    return delta;
  }
}
