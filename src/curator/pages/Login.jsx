import { redirectToSpotify } from "../utils/auth";

export default function Login() {
  return (
    <div className="login-page">
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🎧</div>
        <h1 style={{ fontFamily: "var(--head)", fontSize: 36, fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 8 }}>
          CuratorOS
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 36, lineHeight: 1.6 }}>
          Connecte-toi avec le compte Spotify qui possède tes playlists.
        </p>
        <button
          className="btn btn-green"
          style={{ padding: "14px 32px", fontSize: 15, borderRadius: 50, display: "inline-flex", alignItems: "center", gap: 10 }}
          onClick={redirectToSpotify}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Se connecter avec Spotify
        </button>
        <p style={{ marginTop: 20, fontSize: 12, color: "var(--faint)" }}>
          Tes données ne quittent jamais ton navigateur.
        </p>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--muted)", lineHeight: 1.6, padding: "10px 14px", background: "rgba(119,119,170,.08)", borderRadius: 10, border: "1px solid rgba(119,119,170,.15)" }}>
          Si tes playlists ne chargent pas, déconnecte-toi et reconnecte-toi pour rafraîchir tes permissions Spotify.
        </p>
      </div>
    </div>
  );
}
