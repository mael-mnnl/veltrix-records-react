import { useState } from "react";

export default function GatePage({ onSuccess }) {
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/curator-auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Accès refusé");
        setPassword("");
        return;
      }
      localStorage.setItem("vtx_gate_token", data.token);
      onSuccess();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div style={{ textAlign: "center", maxWidth: 380, padding: "0 24px", width: "100%" }}>

        <div style={{
          fontSize: "0.62rem", fontWeight: 700, letterSpacing: "5px",
          color: "var(--muted)", textTransform: "uppercase", marginBottom: 40,
        }}>
          Veltrix Records
        </div>

        <h1 style={{
          fontFamily: "var(--head)", fontSize: "3rem", fontWeight: 900,
          letterSpacing: "-2px", marginBottom: 20, color: "#fff", lineHeight: 1,
        }}>
          VTXHub
        </h1>

        <p style={{
          color: "var(--muted)", fontSize: "0.7rem", letterSpacing: "1px",
          lineHeight: 2, marginBottom: 48,
        }}>
          Ce service est exclusivement réservé à{" "}
          <span style={{ color: "#fff", fontWeight: 700 }}>Veltrix Records</span>{" "}
          et ses partenaires.<br />
          Pour y accéder, contacte{" "}
          <span style={{ color: "var(--gold, #c9a94e)", fontWeight: 700 }}>pxroducer</span>.
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ textAlign: "center", letterSpacing: "6px", fontSize: 16 }}
            autoFocus
            disabled={loading}
          />

          {error && (
            <div style={{
              fontSize: 11, color: "var(--red)", letterSpacing: "1px",
              textTransform: "uppercase", marginTop: 2,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !password.trim()}
            style={{ opacity: loading || !password.trim() ? 0.45 : 1, marginTop: 4 }}
          >
            {loading ? "Vérification…" : "Accéder"}
          </button>
        </form>
      </div>
    </div>
  );
}
