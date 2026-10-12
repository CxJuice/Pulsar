// Memory only: callers hash the full request, credentials and account/file scope.
class TranslationResultCache {
  constructor({ ttl = 300_000, limit = 128, maximumBytes = 4 * 1024 * 1024, now = Date.now } = {}) {
    this.ttl = ttl; this.limit = limit; this.maximumBytes = maximumBytes; this.now = now;
    this.entries = new Map(); this.bytes = 0; this.generation = 0;
    this.encoder = new TextEncoder();
  }
  clear() { this.generation++; this.entries.clear(); this.bytes = 0; }
  remove(key) {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.bytes -= entry.bytes; }
  }
  read(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (this.now() - entry.at >= this.ttl) { this.remove(key); return; }
    this.entries.delete(key); this.entries.set(key, entry);
    return { ...entry.value };
  }
  write(key, value, generation = this.generation) {
    if (generation !== this.generation || typeof value?.text !== 'string' || !value.text.trim()) return;
    const stored = { text: value.text, provider: value.provider };
    const bytes = this.encoder.encode(key + JSON.stringify(stored)).byteLength;
    this.remove(key);
    if (bytes > this.maximumBytes) return;
    this.entries.set(key, { at: this.now(), value: stored, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.limit || this.bytes > this.maximumBytes) this.remove(this.entries.keys().next().value);
  }
}
function providerCachedInputTokens(data) {
  const usage = data?.usage;
  const candidates = [usage?.prompt_cache_hit_tokens, usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens, usage?.cache_read_input_tokens];
  return candidates.find(value => Number.isSafeInteger(value) && value >= 0);
}
module.exports = { TranslationResultCache, providerCachedInputTokens };
