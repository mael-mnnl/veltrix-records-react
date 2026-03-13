import { useState } from "react";
import { getMe, getAllPlaylists, getPlaylistTracks } from "../utils/spotify";

function tryDecodeJWT(token) {
  try {
    const part = token?.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function TokenInfo() {
  const token   = localStorage.getItem("spotify_token");
  const expires = parseInt(localStorage.getItem("spotify_expires") || "0");
  const decoded = tryDecodeJWT(token);
  const scopes  = decoded?.scope ?? decoded?.scp ?? null;
  const expDate = expires ? new Date(expires).toLocaleString() : "—";
  const msLeft  = expires ? expires - Date.now() : 0;
  const minLeft = Math.round(msLeft / 60000);

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Token stocké</h2>
      <Row label="Expiration" value={`${expDate} (dans ${minLeft} min)`} />
      <Row label="Scopes (JWT)" value={scopes ?? "(token opaque — scopes non lisibles dans le payload)"} />
      {decoded && (
        <details style={{ marginTop: 10 }}>
          <summary style={styles.muted}>Payload complet</summary>
          <pre style={styles.pre}>{JSON.stringify(decoded, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={styles.label}>{label}: </span>
      <span style={styles.value}>{String(value)}</span>
    </div>
  );
}

export default function DebugPage() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runTests() {
    setLoading(true);
    setResults(null);
    const out = {};

    try {
      out.me = await getMe();
    } catch (e) {
      out.me = { error: e.message };
    }

    try {
      const playlists = await getAllPlaylists();
      out.playlists = { count: playlists.length, first: playlists[0] ?? null };

      if (playlists[0]?.id) {
        const pid   = playlists[0].id;
        const token = localStorage.getItem("spotify_token");
        // Fetch brut pour capturer le body exact de Spotify (contourne apiFetch)
        const rawRes = await fetch(`https://api.spotify.com/v1/playlists/${pid}/items?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const rawBody = await rawRes.json().catch(() => ({}));
        out.tracks = {
          playlistId:  pid,
          status:      rawRes.status,
          ok:          rawRes.ok,
          spotifyBody: rawBody,
        };
      } else {
        out.tracks = { error: "Aucune playlist disponible pour le test" };
      }
    } catch (e) {
      out.playlists = { error: e.message };
      out.tracks    = { error: "Test annulé (playlists inaccessibles)" };
    }

    setResults(out);
    setLoading(false);
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Debug — CuratorOS</h1>

      <TokenInfo />

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Test API Spotify</h2>
        <button onClick={runTests} disabled={loading} style={styles.btn}>
          {loading ? "Chargement…" : "Tester l'API"}
        </button>

        {results && (
          <div style={{ marginTop: 16 }}>
            <TestResult label="GET /me" data={results.me} />
            <TestResult label="GET /me/playlists" data={results.playlists} />
            <TestResult label={`GET /playlists/${results.tracks?.playlistId ?? "…"}/tracks`} data={results.tracks} />
          </div>
        )}
      </div>
    </div>
  );
}

function TestResult({ label, data }) {
  const isError = data?.error;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ ...styles.label, color: isError ? "#ff6b6b" : "#1DB954", marginBottom: 4 }}>
        {isError ? "✗" : "✓"} {label}
      </div>
      <pre style={styles.pre}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

const styles = {
  page:      { padding: "32px 24px", maxWidth: 720, margin: "0 auto", fontFamily: "var(--sans, sans-serif)", color: "#eeeef8" },
  title:     { fontSize: 22, fontWeight: 700, marginBottom: 24, color: "#fff" },
  card:      { background: "#12121e", border: "1px solid #2a2a44", borderRadius: 12, padding: "20px 24px", marginBottom: 20 },
  cardTitle: { fontSize: 15, fontWeight: 700, marginBottom: 14, color: "#ccc" },
  label:     { color: "#7777aa", fontSize: 13, fontWeight: 600 },
  value:     { fontSize: 13, wordBreak: "break-all" },
  muted:     { color: "#7777aa", fontSize: 12, cursor: "pointer" },
  pre:       { background: "#08080f", border: "1px solid #1e1e33", borderRadius: 8, padding: "10px 14px", fontSize: 12, overflowX: "auto", color: "#ccd", margin: 0 },
  btn:       { padding: "10px 22px", background: "#1DB954", border: "none", borderRadius: 8, color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" },
};
