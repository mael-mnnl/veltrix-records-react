// ── TTL constants (ms) ────────────────────────────────────────────────────────
export const TTL = {
  H6:  6  * 3_600_000,
  H12: 12 * 3_600_000,
  H24: 24 * 3_600_000,
  D30: 30 * 86_400_000,
};

// ── Generic keyed cache ───────────────────────────────────────────────────────

/** Returns { value, cachedAt } or null if missing / expired */
export function getCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (ttlMs && Date.now() - entry.cachedAt > ttlMs) return null;
    return entry; // { value, cachedAt }
  } catch { return null; }
}

export function setCached(key, value) {
  localStorage.setItem(key, JSON.stringify({ value, cachedAt: Date.now() }));
}

export function deleteCached(key) {
  localStorage.removeItem(key);
}

// ── Human-readable cache age ──────────────────────────────────────────────────

export function fmtAge(cachedAt) {
  if (!cachedAt) return null;
  const s = Math.floor((Date.now() - cachedAt) / 1000);
  if (s < 60)    return "à l'instant";
  if (s < 3600)  return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)}h`;
  return `il y a ${Math.floor(s / 86400)}j`;
}

// ── Global entity cache  spotify_entity_cache  { [id]: { data, cachedAt } } ──
// Stores any Spotify object (artist, album, track, playlist) by ID.
// Prevents fetching the same entity twice across different pages/contexts.

const ENTITY_KEY = "spotify_entity_cache";
const ENTITY_MAX = 1200; // trim to this count when exceeded

function _readEntityCache() {
  try { return JSON.parse(localStorage.getItem(ENTITY_KEY)) || {}; }
  catch { return {}; }
}

function _writeEntityCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > ENTITY_MAX) {
    // Evict oldest
    keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    for (let i = 0; i < keys.length - ENTITY_MAX; i++) delete cache[keys[i]];
  }
  localStorage.setItem(ENTITY_KEY, JSON.stringify(cache));
}

/** Returns cached entity data or null (ttlMs default 24h) */
export function getEntity(id, ttlMs = TTL.H24) {
  const cache = _readEntityCache();
  const entry = cache[id];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ttlMs) return null;
  return entry.data;
}

/** Store multiple entities at once — map of { id: data } */
export function setEntities(map) {
  const cache = _readEntityCache();
  const now   = Date.now();
  for (const [id, data] of Object.entries(map)) {
    cache[id] = { data, cachedAt: now };
  }
  _writeEntityCache(cache);
}

/**
 * Splits ids into cached vs missing (older than ttlMs).
 * Returns { cached: { id: data }, missing: id[] }
 */
export function partitionEntities(ids, ttlMs = TTL.H24) {
  const cache  = _readEntityCache();
  const now    = Date.now();
  const cached = {};
  const missing = [];
  for (const id of ids) {
    const entry = cache[id];
    if (entry && now - entry.cachedAt < ttlMs) {
      cached[id] = entry.data;
    } else {
      missing.push(id);
    }
  }
  return { cached, missing };
}
