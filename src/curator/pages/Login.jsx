import { redirectToSpotify } from "../utils/auth";

export default function Login() {
  return (
    <div className="login-page">
      <div style={{ textAlign: "center", maxWidth: 380, padding: "0 24px", width: "100%" }}>

        {/* Eyebrow */}
        <div style={{
          fontSize: "0.62rem", fontWeight: 700, letterSpacing: "5px",
          color: "var(--muted)", textTransform: "uppercase", marginBottom: 40,
        }}>
          Veltrix Records
        </div>

        {/* Title */}
        <h1 style={{
          fontFamily: "var(--head)", fontSize: "3rem", fontWeight: 900,
          letterSpacing: "-2px", marginBottom: 16, color: "#fff", lineHeight: 1,
        }}>
          VTXHub
        </h1>

        {/* Subtitle */}
        <p style={{
          color: "var(--muted)", fontSize: "0.72rem", letterSpacing: "2px",
          textTransform: "uppercase", lineHeight: 1.8, marginBottom: 52,
        }}>
          Connecte-toi avec le compte Spotify<br />qui possède tes playlists.
        </p>

        {/* Spotify button — Veltrix submit-btn style */}
        <button
          className="btn btn-primary"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}
          onClick={redirectToSpotify}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          Se connecter avec Spotify
        </button>

        {/* Footnote */}
        <p style={{
          marginTop: 28, fontSize: "0.62rem", color: "var(--faint)",
          letterSpacing: "1px", textTransform: "uppercase", lineHeight: 1.7,
        }}>
          Tes données ne quittent jamais ton navigateur.
        </p>

        {/* Hint */}
        <p style={{
          marginTop: 16, fontSize: "0.62rem", color: "var(--faint)",
          letterSpacing: ".5px", lineHeight: 1.8,
        }}>
          Si tes playlists ne chargent pas, déconnecte-toi et reconnecte-toi
          pour rafraîchir tes permissions Spotify.
        </p>
      </div>
    </div>
  );
}
