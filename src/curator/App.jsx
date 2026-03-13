import { useState, useEffect, useRef, Component } from "react";
import './curator.css';
import { exchangeCodeForToken, getValidToken, logout } from "./utils/auth";
import { getMe } from "./utils/spotify";
import Login from "./pages/Login";
import Main from "./pages/Main";
import DebugPage from "./pages/DebugPage";

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12, fontFamily:"sans-serif", color:"#eeeef8", background:"#080810" }}>
        <div style={{ fontSize:32 }}>⚠</div>
        <div style={{ fontWeight:700 }}>Une erreur est survenue</div>
        <div style={{ fontSize:13, color:"#7777aa", maxWidth:400, textAlign:"center" }}>{this.state.error.message}</div>
        <button onClick={() => window.location.reload()} style={{ marginTop:8, padding:"8px 20px", background:"#1DB954", border:"none", borderRadius:8, color:"#000", fontWeight:700, cursor:"pointer" }}>
          Recharger
        </button>
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  const [unlocked, setUnlocked] = useState(
    sessionStorage.getItem("curator_unlocked") === "true"
  );
  const [token, setToken]     = useState(null);
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const initDone = useRef(false);

  // ── Auth init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get("code");

      if (code) {
        window.history.replaceState({}, "", "/");
        try {
          const t = await exchangeCodeForToken(code);
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

  const handleLogout = () => {
    logout();
    setToken(null);
    setUser(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!unlocked) return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#080810", flexDirection: "column", gap: 16
    }}>
      <div style={{ fontSize: 32 }}>🎧</div>
      <div style={{ color: "#eeeef8", fontFamily: "sans-serif", fontSize: 14, marginBottom: 8 }}>
        CuratorOS — Accès restreint
      </div>
      <input
        type="password"
        placeholder="Mot de passe"
        autoFocus
        style={{
          background: "#171726", border: "1px solid #2a2a45", color: "#eeeef8",
          padding: "10px 16px", borderRadius: 9, fontSize: 14, outline: "none", width: 220
        }}
        onChange={e => {
          if (e.target.value === import.meta.env.VITE_CURATOR_PASSWORD) {
            sessionStorage.setItem("curator_unlocked", "true");
            setUnlocked(true);
          }
        }}
      />
    </div>
  );

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--muted)", fontFamily:"var(--sans)" }}>
      Connexion…
    </div>
  );

  if (window.location.pathname === "/debug") return <ErrorBoundary><DebugPage /></ErrorBoundary>;
  if (!token) return <ErrorBoundary><Login /></ErrorBoundary>;
  return <ErrorBoundary><Main user={user} onLogout={handleLogout} /></ErrorBoundary>;
}
