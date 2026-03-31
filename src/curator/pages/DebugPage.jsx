import { useState } from "react";
import { getMe, getAllPlaylists } from "../utils/spotify";

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
  const token        = localStorage.getItem("spotify_token");
  const expires      = parseInt(localStorage.getItem("spotify_expires") || "0");
  const storedScopes = localStorage.getItem("spotify_scopes") || "(vide)";
  const decoded      = tryDecodeJWT(token);
  const jwtScopes    = decoded?.scope ?? decoded?.scp ?? null;
  const expDate      = expires ? new Date(expires).toLocaleString() : "—";
  const minLeft      = expires ? Math.round((expires - Date.now()) / 60000) : 0;

  const REQUIRED = ["playlist-modify-public", "playlist-modify-private"];
  const grantedList = storedScopes.split(" ");
  const missing = REQUIRED.filter(s => !grantedList.includes(s));

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Token & Scopes</h2>
      <Row label="Expiration" value={`${expDate} (dans ${minLeft} min)`} />
      <Row label="spotify_scopes (localStorage)" value={storedScopes} />
      {missing.length > 0
        ? <div style={{ color: "#ff6b6b", fontSize: 13, marginTop: 6 }}>
            ✗ Scopes manquants : {missing.join(", ")}
          </div>
        : <div style={{ color: "#1DB954", fontSize: 13, marginTop: 6 }}>
            ✓ Tous les scopes requis sont présents
          </div>
      }
      {jwtScopes && <Row label="Scopes (JWT payload)" value={jwtScopes} />}
      {decoded && (
        <details style={{ marginTop: 10 }}>
          <summary style={styles.muted}>Payload JWT complet</summary>
          <pre style={styles.pre}>{JSON.stringify(decoded, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={styles.label}>{label} : </span>
      <span style={{ ...styles.value, wordBreak: "break-all" }}>{String(value)}</span>
    </div>
  );
}

export default function DebugPage() {
  const [results,     setResults]     = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [postResult,  setPostResult]  = useState(null);
  const [postLoading, setPostLoading] = useState(false);

  async function runTests() {
    setLoading(true);
    setResults(null);
    const out = {};

    try { out.me = await getMe(); }
    catch (e) { out.me = { error: e.message }; }

    try {
      const playlists = await getAllPlaylists();
      out.playlists = { count: playlists.length, first: playlists[0] ?? null };
    } catch (e) {
      out.playlists = { error: e.message };
    }

    setResults(out);
    setLoading(false);
  }

  async function testCreatePlaylist() {
    setPostLoading(true);
    setPostResult(null);
    const token = localStorage.getItem("spotify_token");

    // 1. Get userId
    let userId = null;
    try {
      const meRes  = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meBody = await meRes.json();
      userId = meBody?.id ?? null;
    } catch (e) {
      setPostResult({ step: "GET /me", error: e.message });
      setPostLoading(false);
      return;
    }

    // 2. Raw POST — capture exact Spotify response
    const postRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "__debug_test__", description: "", public: false }),
    });

    const rawText = await postRes.text();
    let parsedBody = null;
    try { parsedBody = JSON.parse(rawText); } catch {}

    const result = {
      userId,
      status:    postRes.status,
      ok:        postRes.ok,
      rawText,
      parsed:    parsedBody,
    };

    // 3. If created, immediately delete it to clean up
    if (postRes.ok && parsedBody?.id) {
      try {
        await fetch(`https://api.spotify.com/v1/playlists/${parsedBody.id}/followers`, {
          method:  "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        result.cleanup = "Playlist test supprimée ✓";
      } catch { result.cleanup = "Suppression échouée (à supprimer manuellement)"; }
    }

    setPostResult(result);
    setPostLoading(false);
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Debug — CuratorOS</h1>

      <TokenInfo />

      {/* ── POST playlist test ── */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Test création playlist (POST brut)</h2>
        <p style={{ ...styles.muted, marginBottom: 12 }}>
          Appelle directement l'API Spotify sans passer par apiFetch — affiche le body exact de la réponse.
        </p>
        <button onClick={testCreatePlaylist} disabled={postLoading} style={styles.btn}>
          {postLoading ? "Test en cours…" : "Tester POST /playlists"}
        </button>

        {postResult && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: postResult.ok ? "#1DB954" : "#ff6b6b", fontWeight: 700, marginBottom: 8 }}>
              {postResult.ok ? "✓ Succès" : `✗ Erreur HTTP ${postResult.status}`}
            </div>
            <Row label="User ID" value={postResult.userId ?? "—"} />
            <Row label="Status" value={postResult.status} />
            {postResult.cleanup && <Row label="Nettoyage" value={postResult.cleanup} />}
            <div style={{ marginTop: 8, ...styles.label }}>Body brut Spotify :</div>
            <pre style={styles.pre}>{postResult.rawText}</pre>
            {postResult.error && <div style={{ color: "#ff6b6b" }}>{postResult.error}</div>}
          </div>
        )}
      </div>

      {/* ── GET tests ── */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Tests GET</h2>
        <button onClick={runTests} disabled={loading} style={styles.btn}>
          {loading ? "Chargement…" : "Tester GET /me + /me/playlists"}
        </button>

        {results && (
          <div style={{ marginTop: 16 }}>
            <TestResult label="GET /me"          data={results.me} />
            <TestResult label="GET /me/playlists" data={results.playlists} />
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
  value:     { fontSize: 13 },
  muted:     { color: "#7777aa", fontSize: 12, cursor: "pointer", margin: 0 },
  pre:       { background: "#08080f", border: "1px solid #1e1e33", borderRadius: 8, padding: "10px 14px", fontSize: 12, overflowX: "auto", color: "#ccd", margin: 0, whiteSpace: "pre-wrap" },
  btn:       { padding: "10px 22px", background: "#1DB954", border: "none", borderRadius: 8, color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" },
};
