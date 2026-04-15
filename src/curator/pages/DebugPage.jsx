import { useState } from "react";
import { getMe, getAllPlaylists } from "../utils/spotify";
import { logout, redirectToSpotify } from "../utils/auth";

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
    const storedScopes = localStorage.getItem("spotify_scopes") || "(vide)";

    // 1. Get userId
    let userId = null;
    try {
      const meRes  = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const meBody = await meRes.json();
      userId = meBody?.id ?? null;
    } catch (e) {
      setPostResult({ storedScopes, step: "GET /me", error: e.message });
      setPostLoading(false);
      return;
    }

    const raw = async (method, path, body) => {
      const res  = await fetch(`https://api.spotify.com/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch {}
      return { status: res.status, ok: res.ok, text, parsed };
    };

    // 2. Test POST private playlist
    const priv = await raw("POST", `/users/${userId}/playlists`, { name: "__debug_private__", description: "", public: false });

    // 3. Test POST public playlist
    const pub  = await raw("POST", `/users/${userId}/playlists`, { name: "__debug_public__",  description: "", public: true  });

    // 4. Test add track to first owned playlist (different write endpoint)
    let addTrack = null;
    try {
      const plRes  = await fetch(`https://api.spotify.com/v1/me/playlists?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
      const plData = await plRes.json();
      const plId   = plData?.items?.[0]?.id;
      if (plId) {
        // Try adding a known track URI (non-destructive: track may already be there)
        addTrack = await raw("POST", `/playlists/${plId}/tracks`, { uris: ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"], position: 0 });
        // Immediately remove it to clean up
        if (addTrack.ok) {
          await raw("DELETE", `/playlists/${plId}/tracks`, { tracks: [{ uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC" }] });
          addTrack.cleanup = "Track test retiré ✓";
        }
      }
    } catch {}

    // Clean up any created playlists
    for (const r of [priv, pub]) {
      if (r.ok && r.parsed?.id) {
        try { await raw("DELETE", `/playlists/${r.parsed.id}/followers`, null); r.cleanup = "Supprimée ✓"; }
        catch {}
      }
    }

    setPostResult({ storedScopes, userId, priv, pub, addTrack });
    setPostLoading(false);
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Debug — VTXHub</h1>

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
            <Row label="Scopes stockés (localStorage)" value={postResult.storedScopes} />
            <Row label="User ID" value={postResult.userId ?? "—"} />

            {[
              { key: "priv",     label: "POST private playlist (needs playlist-modify-private)" },
              { key: "pub",      label: "POST public playlist  (needs playlist-modify-public)" },
              { key: "addTrack", label: "POST add track to playlist (needs modify-*)" },
            ].map(({ key, label }) => {
              const r = postResult[key];
              if (!r) return null;
              return (
                <div key={key} style={{ margin: "10px 0" }}>
                  <div style={{ color: r.ok ? "#1DB954" : "#ff6b6b", fontWeight: 700 }}>
                    {r.ok ? "✓" : `✗ ${r.status}`} {label}
                  </div>
                  {r.cleanup && <div style={{ color: "#aaa", fontSize: 12 }}>{r.cleanup}</div>}
                  <pre style={styles.pre}>{r.text}</pre>
                </div>
              );
            })}

            {postResult.error && <div style={{ color: "#ff6b6b" }}>{postResult.error}</div>}

            {(postResult.priv && !postResult.priv.ok) && (
              <div style={{ marginTop: 14, padding: "12px 14px", background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.3)", borderRadius: 8, fontSize: 13 }}>
                <strong style={{ color: "#ff6b6b" }}>Toutes les opérations write échouent.</strong>
                <div style={{ color: "#aaa", marginTop: 6 }}>
                  Si les scopes ci-dessus contiennent <code>playlist-modify-public</code> et <code>playlist-modify-private</code> mais le 403 persiste,
                  le problème vient du <strong>Spotify Developer Dashboard</strong> — pas du code.
                  Va sur <strong>developer.spotify.com</strong>, ouvre ton app (<code>82921638d58f49368a3a3ff7af89da59</code>),
                  accepte les CGU si demandé et vérifie que l'app n'est pas restreinte.
                </div>
                <button onClick={() => { logout(); redirectToSpotify(); }} style={{ ...styles.btn, marginTop: 12, background: "#ff6b6b", width: "100%" }}>
                  🔄 Reconnecter quand même
                </button>
              </div>
            )}
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
