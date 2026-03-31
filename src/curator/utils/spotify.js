import { getValidToken, refreshAccessToken } from "./auth";

const BASE = "https://api.spotify.com/v1";

// ── In-memory playlist cache (5 min) ─────────────────────────────────────────
let _playlistsCache   = null;
let _playlistsCacheAt = 0;
const MEM_CACHE_TTL   = 5 * 60_000;
const LS_PLAYLISTS    = "spotify_playlists_v1";
const LS_PLAYLISTS_TTL = 30 * 60_000; // 30 min on-disk

export function invalidatePlaylistsCache() {
  _playlistsCache = null;
  localStorage.removeItem(LS_PLAYLISTS);
}

// ── Rate-limit state ──────────────────────────────────────────────────────────
const RL_KEY = "spotify_rl_until";

function _getRLUntil() {
  try { return parseInt(localStorage.getItem(RL_KEY) || "0"); } catch { return 0; }
}
function _setRLUntil(untilMs) {
  localStorage.setItem(RL_KEY, String(untilMs));
  window.dispatchEvent(new CustomEvent("spotify-rate-limit", { detail: { until: untilMs } }));
}

export function isRateLimited()      { return _getRLUntil() > Date.now(); }
export function getRateLimitedUntil(){ const t = _getRLUntil(); return t > Date.now() ? t : null; }
export function clearRateLimit()     { localStorage.removeItem(RL_KEY); }

// ── Central fetch with 401-retry, RL check, 429 handling ─────────────────────

async function apiFetch(urlOrPath, options = {}) {
  // Bail immediately if we're still rate-limited
  const rlUntil = _getRLUntil();
  if (rlUntil > Date.now()) {
    const secsLeft = Math.ceil((rlUntil - Date.now()) / 1000);
    throw new Error(`RATE_LIMIT:${secsLeft}`);
  }

  let token = await getValidToken();
  if (!token) throw new Error("Non connecté");

  const url = urlOrPath.startsWith("http") ? urlOrPath : `${BASE}${urlOrPath}`;

  const doFetch = (t) => {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 15000);
    return fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        Authorization:  `Bearer ${t}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    }).finally(() => clearTimeout(tid));
  };

  let res;
  try { res = await doFetch(token); }
  catch (e) {
    if (e.name === "AbortError") throw new Error("Timeout — vérifie ta connexion");
    throw e;
  }

  // 401 → refresh once
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (!fresh) { window.dispatchEvent(new Event("spotify-logout")); throw new Error("Session expirée — reconnecte-toi"); }
    try { res = await doFetch(fresh); }
    catch (e) { if (e.name === "AbortError") throw new Error("Timeout"); throw e; }
    if (res.status === 401) { window.dispatchEvent(new Event("spotify-logout")); throw new Error("Session expirée — reconnecte-toi"); }
  }

  if (res.status === 204 || res.status === 202) return null;

  // 429 → store until + broadcast
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "60");
    const until = Date.now() + (retryAfter + 2) * 1000;
    _setRLUntil(until);
    throw new Error(`RATE_LIMIT:${retryAfter}`);
  }

  if (res.status === 403) {
    let body = {}; try { body = await res.json(); } catch {}
    const spotifyMsg = body?.error?.message ?? body?.error ?? "";
    const spotifyReason = body?.error?.reason ?? "";
    console.error("[spotify] 403:", url, JSON.stringify(body));
    // Write endpoints (playlist creation/modification) blocked by Spotify Dev Mode restrictions
    if (url.includes("/playlists") || url.includes("/tracks")) {
      throw new Error("Création impossible — Spotify a restreint les apps en mode développement. Va sur developer.spotify.com → User Management et ajoute ton compte.");
    }
    // Scope-related 403s on other endpoints: force re-auth
    if (
      spotifyReason === "PREMIUM_REQUIRED" ||
      spotifyMsg.toLowerCase().includes("scope") ||
      spotifyMsg.toLowerCase().includes("permission") ||
      spotifyMsg.toLowerCase().includes("insufficient")
    ) {
      window.dispatchEvent(new CustomEvent("spotify-reauth", { detail: { reason: spotifyMsg || "scope manquant" } }));
    }
    const detail = spotifyMsg ? ` (${spotifyMsg}${spotifyReason ? " — " + spotifyReason : ""})` : "";
    throw new Error(`Erreur 403 : scope manquant ou contenu restreint${detail}`);
  }

  let json;
  try { json = await res.json(); }
  catch { throw new Error(`Réponse Spotify invalide (${res.status})`); }
  if (!res.ok) throw new Error(json?.error?.message || `Erreur Spotify ${res.status}`);
  return json;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True if error is a rate-limit error thrown by apiFetch */
export function isRLError(e) {
  return e?.message?.startsWith("RATE_LIMIT:");
}

/** Extract seconds from RATE_LIMIT:N error */
export function rlSecsFromError(e) {
  return parseInt(e?.message?.split(":")?.[1] || "60");
}

// ── Basic API calls ───────────────────────────────────────────────────────────

export const getMe = () => apiFetch("/me");

export async function getAllPlaylists() {
  // 1. In-memory cache
  if (_playlistsCache && Date.now() - _playlistsCacheAt < MEM_CACHE_TTL) return _playlistsCache;

  // 2. localStorage cache (30 min)
  try {
    const stored = JSON.parse(localStorage.getItem(LS_PLAYLISTS));
    if (stored && Date.now() - stored.cachedAt < LS_PLAYLISTS_TTL) {
      _playlistsCache   = stored.value;
      _playlistsCacheAt = stored.cachedAt;
      return _playlistsCache;
    }
  } catch {}

  // 3. Fetch — minimal fields to reduce payload
  let items = [];
  let url   = `${BASE}/me/playlists?limit=50&fields=items(id,name,description,images,tracks.total,snapshot_id,external_urls,uri),next`;
  let page  = 0;
  while (url && page < 20) {
    const data = await apiFetch(url);
    items = [...items, ...(data.items || []).filter(Boolean).filter(p => p.id)];
    url   = data.next || null;
    page++;
  }

  _playlistsCache   = items;
  _playlistsCacheAt = Date.now();
  localStorage.setItem(LS_PLAYLISTS, JSON.stringify({ value: items, cachedAt: _playlistsCacheAt }));
  return items;
}

export async function getPlaylistTracks(playlistId) {
  let items = [];
  let url   = `${BASE}/playlists/${playlistId}/items?limit=100`;
  let page  = 0;
  while (url && page < 50) {
    const data  = await apiFetch(url);
    const valid = (data.items || [])
      .filter(i => i?.item?.id)
      .map(i => ({ ...i, track: i.item }));
    items = [...items, ...valid];
    url   = data.next || null;
    page++;
  }
  return items;
}

export const getTrackById = (id) => apiFetch(`/tracks/${id}`);

export const searchTracks = (q) =>
  apiFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20`);

export const searchArtist = (name) =>
  apiFetch(`/search?q=${encodeURIComponent(name)}&type=artist&limit=1`);

export const getArtistAlbums = (artistId) =>
  apiFetch(`/artists/${artistId}/albums?include_groups=single,album&limit=10&market=FR`);

export const getArtistRelatedArtists = (artistId) =>
  apiFetch(`/artists/${artistId}/related-artists`);

export const getPlaylistFollowers = (playlistId) =>
  apiFetch(`/playlists/${playlistId}?fields=followers.total`);

export const getAlbumTracks = (albumId) =>
  apiFetch(`/albums/${albumId}/tracks?limit=1&market=FR`);

// ── Batch endpoints ───────────────────────────────────────────────────────────

/** Fetch up to 20 full album objects (includes popularity) */
export function getAlbumsBatch(ids) {
  return apiFetch(`/albums?ids=${ids.slice(0, 20).join(",")}`);
}

/** Fetch up to 50 full track objects */
export function getTracksBatch(ids) {
  return apiFetch(`/tracks?ids=${ids.slice(0, 50).join(",")}`);
}

// ── Playlist mutation ─────────────────────────────────────────────────────────

export const addTrackToPlaylist = (playlistId, trackUri, position) => {
  const body = { uris: [trackUri] };
  if (position !== undefined && position !== null) body.position = position;
  return apiFetch(`/playlists/${playlistId}/items`, { method: "POST", body: JSON.stringify(body) });
};

export const removeTrackFromPlaylist = (playlistId, trackUri) =>
  apiFetch(`/playlists/${playlistId}/items`, {
    method: "DELETE",
    body:   JSON.stringify({ tracks: [{ uri: trackUri }] }),
  });

export async function broadcastAdd(trackUri, playlistIds, position = 0) {
  const results = await Promise.allSettled(
    playlistIds.map(id => addTrackToPlaylist(id, trackUri, position)),
  );
  return {
    ok:     results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
    errors: results.map((r, i) => r.status === "rejected" ? { id: playlistIds[i], msg: r.reason?.message } : null).filter(Boolean),
  };
}

export async function broadcastRemove(trackUri, playlistIds) {
  const results = await Promise.allSettled(
    playlistIds.map(id => removeTrackFromPlaylist(id, trackUri)),
  );
  return {
    ok:     results.filter(r => r.status === "fulfilled").length,
    failed: results.filter(r => r.status === "rejected").length,
  };
}

export const createPlaylist = (userId, name, description) =>
  apiFetch(`/users/${userId}/playlists`, {
    method: "POST",
    body:   JSON.stringify({ name, description, public: true }),
  });

export const addTracksToPlaylist = (playlistId, uris) =>
  apiFetch(`/playlists/${playlistId}/tracks`, {
    method: "POST",
    body:   JSON.stringify({ uris }),
  });

export const getRecommendations = (trackId) =>
  apiFetch(`/recommendations?seed_tracks=${encodeURIComponent(trackId)}&limit=25`);

export const getRecommendationsBySeeds = (trackIds) =>
  apiFetch(`/recommendations?seed_tracks=${encodeURIComponent(trackIds.slice(0, 5).join(","))}&limit=30`);

export const uploadPlaylistCover = (playlistId, base64Jpeg) =>
  apiFetch(`/playlists/${playlistId}/images`, {
    method:  "PUT",
    body:    base64Jpeg,
    headers: { "Content-Type": "image/jpeg" },
  });
