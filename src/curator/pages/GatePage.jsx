import { useState } from "react";

// ── SHA-256 via Web Crypto (HTTPS uniquement) ─────────────────────────────────
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Proof of Work : trouve un nonce tel que SHA256(challenge+nonce) commence
//    par `difficulty` zéros. Rend chaque tentative de brute-force ~1-2s CPU. ──
async function solvePoW(challenge, difficulty) {
  const target = '0'.repeat(difficulty);
  for (let nonce = 0; ; nonce++) {
    const hash = await sha256hex(challenge + nonce);
    if (hash.startsWith(target)) return nonce;
    if (nonce % 400 === 0) await new Promise(r => setTimeout(r, 0)); // yield UI
  }
}

export default function GatePage({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [status,   setStatus]   = useState('idle'); // idle | pow | checking | ok

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('pow');

    try {
      // 1. Récupérer un challenge signé
      const cRes  = await fetch('/api/curator-challenge');
      const { challenge, sig, difficulty } = await cRes.json();

      // 2. Résoudre le puzzle cryptographique (~1-2s)
      const nonce = await solvePoW(challenge, difficulty);

      // 3. Soumettre mot de passe + preuve
      setStatus('checking');
      const res  = await fetch('/api/curator-auth', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password, challenge, sig, nonce }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Accès refusé');
        setPassword('');
        setStatus('idle');
        return;
      }

      localStorage.setItem('vtx_gate_token', data.token);
      setStatus('ok');
      onSuccess();
    } catch {
      setError('Erreur réseau — réessaie');
      setStatus('idle');
    }
  };

  const busy = status === 'pow' || status === 'checking';

  return (
    <div className="login-page">
      <div style={{ textAlign: 'center', maxWidth: 380, padding: '0 24px', width: '100%' }}>

        <div style={{
          fontSize: '0.62rem', fontWeight: 700, letterSpacing: '5px',
          color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 40,
        }}>
          Veltrix Records
        </div>

        <h1 style={{
          fontFamily: 'var(--head)', fontSize: '3rem', fontWeight: 900,
          letterSpacing: '-2px', marginBottom: 20, color: '#fff', lineHeight: 1,
        }}>
          VTXHub
        </h1>

        <p style={{
          color: 'var(--muted)', fontSize: '0.7rem', letterSpacing: '1px',
          lineHeight: 2, marginBottom: 48,
        }}>
          Ce service est exclusivement réservé à{' '}
          <span style={{ color: '#fff', fontWeight: 700 }}>Veltrix Records</span>{' '}
          et ses partenaires.<br />
          Pour y accéder, contacte{' '}
          <span style={{ color: 'var(--gold, #c9a94e)', fontWeight: 700 }}>pxroducer</span>.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ textAlign: 'center', letterSpacing: '6px', fontSize: 16 }}
            autoFocus
            disabled={busy}
          />

          {error && (
            <div style={{
              fontSize: 11, color: 'var(--red)', letterSpacing: '1px',
              textTransform: 'uppercase', marginTop: 2,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !password.trim()}
            style={{ opacity: busy || !password.trim() ? 0.55 : 1, marginTop: 4, position: 'relative' }}
          >
            {status === 'pow'      && 'Sécurisation…'}
            {status === 'checking' && 'Vérification…'}
            {status === 'idle'     && 'Accéder'}
            {status === 'ok'       && '✓'}
          </button>

          {status === 'pow' && (
            <div style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '1px', marginTop: -6 }}>
              Calcul de preuve cryptographique…
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
