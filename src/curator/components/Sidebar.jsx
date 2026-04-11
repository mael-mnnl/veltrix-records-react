const NAV = [
  { id: "playlists", icon: "♪",  label: "Mes Playlists" },
  { id: "broadcast", icon: "⚡", label: "Multi-Playlist" },
  { id: "radar",     icon: "📡", label: "Radar" },
  { id: "stats",     icon: "📊", label: "Stats" },
  { id: "alerts",    icon: "🔔", label: "Alertes" },
  { id: "contracts", icon: "📄", label: "Contrats" },
];

export default function Sidebar({ user, tab, setTab, onLogout, onReconnect, badges = {}, scopeWarning }) {
  return (
    <aside className="sidebar">
      <div style={{ padding: "6px 10px 20px" }}>
        <div style={{ fontFamily: "var(--head)", fontSize: 17, fontWeight: 800, color: "var(--green)", letterSpacing: "-.5px" }}>
          🎧 CuratorOS
        </div>
      </div>

      {NAV.map(n => (
        <button key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}>
          <span style={{ fontSize: 15, width: 18, textAlign: "center", position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {n.icon}
            {badges[n.id] > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -6,
                background: "var(--red)", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 800,
                width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}>
                {badges[n.id] > 9 ? "9+" : badges[n.id]}
              </span>
            )}
          </span>
          {n.label}
        </button>
      ))}

      {user && (
        <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          {user.images?.[0]?.url
            ? <img src={user.images[0].url} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }} />
            : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>👤</div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.display_name}</div>
            <div style={{ fontSize: 11, color: "var(--faint)" }}>Spotify</div>
          </div>
          <button onClick={onLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--faint)", fontSize: 16, padding: 4 }} title="Déconnexion">⏏</button>
        </div>
      )}

      {onReconnect && (
        <button onClick={onReconnect} style={{
          margin: "8px 10px 10px", width: "calc(100% - 20px)",
          background: scopeWarning ? "rgba(255,170,0,0.15)" : "rgba(255,255,255,0.04)",
          border: scopeWarning ? "1px solid rgba(255,170,0,0.4)" : "1px solid var(--border)",
          borderRadius: 8, padding: "8px 10px", cursor: "pointer",
          color: scopeWarning ? "#ffaa00" : "var(--faint)",
          fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center",
          gap: 6, justifyContent: "center",
        }} title="Forcer une nouvelle authentification Spotify">
          🔄 Reconnecter
        </button>
      )}
    </aside>
  );
}
