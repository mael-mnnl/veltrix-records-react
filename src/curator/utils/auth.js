export const CLIENT_ID    = "82921638d58f49368a3a3ff7af89da59";
export const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI || "https://veltrix-records.com/curator/callback";
export const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
  "user-read-email",
  "ugc-image-upload",
].join(" ");

const REQUIRED_SCOPES = ["playlist-modify-public", "playlist-modify-private"];

export function hasRequiredScopes() {
  const granted = (localStorage.getItem("spotify_scopes") || "").split(" ");
  return REQUIRED_SCOPES.every(s => granted.includes(s));
}

// ── JWT decode (best-effort — Spotify tokens may or may not be JWTs) ────────

function tryDecodeJWT(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// ── PKCE ────────────────────────────────────────────────────────────────────

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE() {
  const verifier  = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge };
}

// ── Auth flow ───────────────────────────────────────────────────────────────

export async function redirectToSpotify() {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem("code_verifier", verifier);

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             CLIENT_ID,
    scope:                 SCOPES,
    redirect_uri:          REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge:        challenge,
    show_dialog:           "true",
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

export async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem("code_verifier");
  if (!verifier) throw new Error("Code verifier manquant — retente la connexion");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Auth Spotify échouée : ${err.error_description || err.error || res.status}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("Réponse Spotify invalide (access_token manquant)");

  console.log("[auth] Scopes accordés par Spotify:", data.scope);
  const decoded = tryDecodeJWT(data.access_token);
  if (decoded) console.log("[auth] Token JWT décodé:", decoded);

  localStorage.setItem("spotify_token",   data.access_token);
  localStorage.setItem("spotify_refresh",  data.refresh_token);
  localStorage.setItem("spotify_expires",  String(Date.now() + data.expires_in * 1000));
  localStorage.setItem("spotify_scopes",   data.scope ?? "");
  return data.access_token;
}

export async function refreshAccessToken() {
  const refresh = localStorage.getItem("spotify_refresh");
  if (!refresh) return null;

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refresh,
      client_id:     CLIENT_ID,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;

  localStorage.setItem("spotify_token",  data.access_token);
  localStorage.setItem("spotify_expires", String(Date.now() + data.expires_in * 1000));
  if (data.refresh_token) localStorage.setItem("spotify_refresh", data.refresh_token);
  // Always persist the granted scopes so hasRequiredScopes() stays accurate
  if (data.scope) localStorage.setItem("spotify_scopes", data.scope);
  return data.access_token;
}

export async function getValidToken() {
  const stored = localStorage.getItem("spotify_token");
  if (!stored || stored === "undefined" || stored === "null") return refreshAccessToken();

  const expires = parseInt(localStorage.getItem("spotify_expires") || "0");
  if (Date.now() < expires - 60000) return stored;
  return refreshAccessToken();
}

export function logout() {
  localStorage.removeItem("spotify_token");
  localStorage.removeItem("spotify_refresh");
  localStorage.removeItem("spotify_expires");
  localStorage.removeItem("spotify_scopes");
  sessionStorage.removeItem("code_verifier");
}
