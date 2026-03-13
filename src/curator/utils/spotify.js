import { getValidToken, refreshAccessToken } from "./auth";

const BASE = "https://api.spotify.com/v1";

// ── Cache playlists (5 min) ──────────────────────────────────────────────────
let _playlistsCache = null;
let _playlistsCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;
export function invalidatePlaylistsCache() { _playlistsCache = null; }

// ── Central fetch with auto-retry on 401 ────────────────────────────────────

async function apiFetch(urlOrPath, options = {}) {
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

  // 401 → refresh token + retry once
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (!fresh) {
      window.dispatchEvent(new Event("spotify-logout"));
      throw new Error("Session expirée — reconnecte-toi");
    }
    try { res = await doFetch(fresh); }
    catch (e) {
      if (e.name === "AbortError") throw new Error("Timeout — vérifie ta connexion");
      throw e;
    }
    if (res.status === 401) {
      window.dispatchEvent(new Event("spotify-logout"));
      throw new Error("Session expirée — reconnecte-toi");
    }
  }

  if (res.status === 204) return null;

  // 429 → rate limit (corps peut être du texte brut, pas du JSON)
  if (res.status === 429) {
    const retry = res.headers.get("Retry-After");
    throw new Error(`Trop de requêtes Spotify${retry ? ` — réessaie dans ${retry}s` : ""}`);
  }

  // 403 → pas de logout, juste une erreur sur cette ressource
  if (res.status === 403) {
    let body = {};
    try { body = await res.json(); } catch {}
    console.error("[spotify] 403 Forbidden:", url, body);
    throw new Error("Erreur 403 : scope manquant ou contenu restreint par Spotify");
  }

  let json;
  try { json = await res.json(); }
  catch { throw new Error(`Réponse Spotify invalide (${res.status})`); }
  if (res.status === 400) console.error("[spotify] 400:", url, json);
  if (!res.ok) throw new Error(json?.error?.message || `Erreur Spotify ${res.status}`);
  return json;
}

// ── API functions ────────────────────────────────────────────────────────────

export const getMe = () => apiFetch("/me");

export async function getAllPlaylists() {
  if (_playlistsCache && Date.now() - _playlistsCacheAt < CACHE_TTL) return _playlistsCache;
  let items = [];
  let url   = `${BASE}/me/playlists?limit=50`;
  let page  = 0;
  while (url && page < 20) {
    const data = await apiFetch(url);
    items = [...items, ...(data.items || []).filter(Boolean).filter(p => p.id)];
    url   = data.next || null;
    page++;
  }
  _playlistsCache  = items;
  _playlistsCacheAt = Date.now();
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
      .map(i => ({ ...i, track: i.item })); // normalise: item → track pour compat
    items = [...items, ...valid];
    url   = data.next || null;
    page++;
  }
  return items;
}

export const getTrackById = (id) => apiFetch(`/tracks/${id}`);

export const searchTracks = (q) =>
  apiFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=20`);

export const addTrackToPlaylist = (playlistId, trackUri, position) => {
  const body = { uris: [trackUri] };
  if (position !== undefined && position !== null) body.position = position;
  return apiFetch(`/playlists/${playlistId}/items`, {
    method: "POST",
    body:   JSON.stringify(body),
  });
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
    errors: results
      .map((r, i) => r.status === "rejected" ? { id: playlistIds[i], msg: r.reason?.message } : null)
      .filter(Boolean),
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
