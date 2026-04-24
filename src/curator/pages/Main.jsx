import { useState, useEffect, useRef } from "react";
import Sidebar from "../components/Sidebar";
import PlaylistsPage from "./PlaylistsPage";
import BroadcastPage from "./BroadcastPage";
import RadarPage from "./RadarPage";
import StatsPage from "./StatsPage";
import AlertsPage from "./AlertsPage";
import ContractsPage from "./ContractsPage";
import SlotsPage from "./SlotsPage";
import { clearRateLimit } from "../utils/spotify";
import { getActiveSlots, subscribeToSlots, unsubscribeSlots } from "../utils/slots";
import { isSupabaseConfigured } from "../utils/supabase";

// ── Compute initial unseen alerts count from localStorage (no API) ────────────
function getInitialUnseen() {
  try {
    const ac    = JSON.parse(localStorage.getItem("radar_artist_cache_v2") || "{}");
    const seen  = new Set(JSON.parse(localStorage.getItem("curator_alerts_seen_v1")  || "[]"));
    const rules = JSON.parse(localStorage.getItem("curator_alerts_rules_v1") || '{"popularity":50,"window":7}');
    const ms    = rules.window === 2 ? 2 * 86_400_000 : rules.window === 7 ? 7 * 86_400_000 : 30 * 86_400_000;
    let count   = 0;
    for (const entry of Object.values(ac)) {
      if (!entry?.releases) continue;
      for (const r of entry.releases) {
        const age = Date.now() - new Date(r.releaseDate).getTime();
        if (age <= ms && r.popularity > rules.popularity && !seen.has(r.id)) count++;
      }
    }
    return count;
  } catch { return 0; }
}

// ── Rate limit banner with countdown ─────────────────────────────────────────
function RateLimitBanner({ until, onExpire }) {
  const [secsLeft, setSecsLeft] = useState(() => Math.ceil((until - Date.now()) / 1000));
  const iRef = useRef(null);

  useEffect(() => {
    iRef.current = setInterval(() => {
      const s = Math.ceil((until - Date.now()) / 1000);
      setSecsLeft(s);
      if (s <= 0) {
        clearInterval(iRef.current);
        clearRateLimit();
        onExpire();
      }
    }, 1000);
    return () => clearInterval(iRef.current);
  }, [until]);

  if (secsLeft <= 0) return null;
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9000,
      background: "rgba(255,85,85,.92)", backdropFilter: "blur(8px)",
      padding: "10px 20px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontSize: 13, fontWeight: 600, color: "#fff",
      boxShadow: "0 2px 16px rgba(255,85,85,.4)",
    }}>
      <span>⚠ Rate limit Spotify atteint — tous les boutons sont bloqués. Réessaie dans <strong>{label}</strong>.</span>
      <span style={{ fontSize: 11, opacity: 0.75 }}>Les données en cache restent accessibles.</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Main({ user, onLogout, onReconnect, scopeWarning }) {
  const [tab,          setTab]          = useState("playlists");
  const [unseenAlerts, setUnseenAlerts] = useState(getInitialUnseen);
  const [activeSlotsCount, setActiveSlotsCount] = useState(0);
  const [rlUntil,      setRlUntil]      = useState(() => {
    try {
      const t = parseInt(localStorage.getItem("spotify_rl_until") || "0");
      return t > Date.now() ? t : null;
    } catch { return null; }
  });

  // Listen for rate-limit events from apiFetch
  useEffect(() => {
    const handle = (e) => setRlUntil(e.detail.until);
    window.addEventListener("spotify-rate-limit", handle);
    return () => window.removeEventListener("spotify-rate-limit", handle);
  }, []);

  // Active slots count + realtime sync for sidebar badge
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const refresh = () => getActiveSlots().then(s => setActiveSlotsCount(s.length)).catch(() => {});
    refresh();
    const channel = subscribeToSlots(refresh);
    return () => unsubscribeSlots(channel);
  }, []);

  const isRL = rlUntil && rlUntil > Date.now();

  return (
    <div className="layout">
      {isRL && <RateLimitBanner until={rlUntil} onExpire={() => setRlUntil(null)} />}

      <Sidebar
        user={user}
        tab={tab}
        setTab={setTab}
        onLogout={onLogout}
        onReconnect={onReconnect}
        badges={{ alerts: unseenAlerts, slots: activeSlotsCount }}
        rateLimited={isRL}
        scopeWarning={scopeWarning}
      />

      <div className="main" style={isRL ? { paddingTop: 46 } : {}}>
        {tab === "playlists" && <PlaylistsPage rateLimited={isRL} />}
        {tab === "broadcast" && <BroadcastPage />}
        {tab === "radar"     && <RadarPage />}
        {tab === "stats"     && <StatsPage />}
        {tab === "alerts"    && <AlertsPage onUnseenChange={setUnseenAlerts} />}
        {tab === "slots"     && <SlotsPage />}
        {tab === "contracts" && <ContractsPage />}
      </div>
    </div>
  );
}
