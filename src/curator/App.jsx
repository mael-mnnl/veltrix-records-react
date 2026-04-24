import { useState, useEffect, useRef, Component } from "react";
import './curator.css';
import { exchangeCodeForToken, getValidToken, logout, hasRequiredScopes, redirectToSpotify } from "./utils/auth";
import { getMe } from "./utils/spotify";
import GatePage from "./pages/GatePage";
import Login from "./pages/Login";
import Main from "./pages/Main";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12, fontFamily:"'Inter',sans-serif", color:"#d0d0d0", background:"#080808" }}>
        <div style={{ fontSize:28, color:"#555", letterSpacing:"2px" }}>⚠</div>
        <div style={{ fontWeight:700, letterSpacing:"-0.5px" }}>Une erreur est survenue</div>
        <div style={{ fontSize:12, color:"#555", maxWidth:400, textAlign:"center", lineHeight:1.6 }}>{this.state.error.message}</div>
        <button onClick={() => window.location.reload()} style={{ marginTop:12, padding:"12px 28px", background:"#fff", border:"none", color:"#000", fontWeight:700, cursor:"pointer", fontSize:11, letterSpacing:"2px", textTransform:"uppercase" }}>
          Recharger
        </button>
      </div>
    );
    return this.props.children;
  }
}

async function checkGateToken() {
  const token = localStorage.getItem("vtx_gate_token");
  if (!token) return false;
  try {
    const res  = await fetch("/api/curator-verify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ token }),
    });
    const data = await res.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

export default function App() {
  const [gateOk, setGateOk]         = useState(null); // null=vérification, false=bloqué, true=ok
  const [token, setToken]           = useState(null);
  const [user, setUser]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [scopeWarning, setScopeWarning] = useState(false);
  const initDone = useRef(false);

  // ── Gate check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    checkGateToken().then(ok => setGateOk(ok));
  }, []);

  // ── Auth init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get("code");

      if (code) {
        window.history.replaceState({}, "", "/curator");
        try {
          const t = await exchangeCodeForToken(code);
          // Verify scopes returned by Spotify contain the required ones
          const grantedScopes = (localStorage.getItem("spotify_scopes") || "").split(" ");
          const required = ["playlist-modify-public", "playlist-modify-private"];
          if (!required.every(s => grantedScopes.includes(s))) {
            setScopeWarning(true);
          }
          setToken(t);
          // getMe may fail transiently right after exchange — not a reason to logout
          try { setUser(await getMe()); } catch {}
        } catch (e) {
          console.error("OAuth callback failed:", e.message);
        }
        initDone.current = true;
        setLoading(false);
        return;
      }

      const t = await getValidToken();
      if (t) {
        if (!hasRequiredScopes()) {
          // Token exists but was granted without the required scopes — force re-auth
          logout();
          redirectToSpotify();
          return;
        }
        setToken(t);
        try { setUser(await getMe()); } catch {}
      }
      initDone.current = true;
      setLoading(false);
    }
    init();
  }, []);

  // ── Auto-logout on 401 (only after init is done) ──────────────────────────
  useEffect(() => {
    const onLogout = () => {
      if (!initDone.current) return;
      logout();
      setToken(null);
      setUser(null);
    };
    window.addEventListener("spotify-logout", onLogout);
    return () => window.removeEventListener("spotify-logout", onLogout);
  }, []);

  // ── Force re-auth on 403 scope errors (max once per session) ─────────────
  const reauthFired = useRef(false);
  useEffect(() => {
    const onReauth = (e) => {
      if (!initDone.current || reauthFired.current) return;
      reauthFired.current = true;
      console.warn("[auth] 403 scope error — forcing re-auth:", e.detail?.reason);
      logout();
      redirectToSpotify();
    };
    window.addEventListener("spotify-reauth", onReauth);
    return () => window.removeEventListener("spotify-reauth", onReauth);
  }, []);

  const handleLogout = () => {
    logout();
    setToken(null);
    setUser(null);
  };

  const handleReconnect = () => {
    logout();
    redirectToSpotify();
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (gateOk === null || loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#080808", color:"#333", fontFamily:"'Inter',sans-serif", fontSize:"0.65rem", letterSpacing:"4px", textTransform:"uppercase" }}>
      Connexion…
    </div>
  );

  if (!gateOk) return <ErrorBoundary><GatePage onSuccess={() => setGateOk(true)} /></ErrorBoundary>;
  if (!token) return <ErrorBoundary><Login /></ErrorBoundary>;
  return (
    <ErrorBoundary>
      {scopeWarning && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "rgba(255,170,0,0.95)", backdropFilter: "blur(8px)",
          padding: "12px 20px", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 12,
          fontSize: 13, fontWeight: 600, color: "#1a1a00",
          boxShadow: "0 2px 16px rgba(255,170,0,0.4)",
        }}>
          <span>⚠ Permissions insuffisantes — déconnecte-toi et reconnecte-toi pour activer toutes les fonctionnalités.</span>
          <button onClick={handleReconnect} style={{
            background: "#1a1a00", color: "#ffaa00", border: "none",
            borderRadius: 7, padding: "7px 16px", fontWeight: 700,
            fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
          }}>Se reconnecter</button>
        </div>
      )}
      <Main user={user} onLogout={handleLogout} onReconnect={handleReconnect} scopeWarning={scopeWarning} />
    </ErrorBoundary>
  );
}
