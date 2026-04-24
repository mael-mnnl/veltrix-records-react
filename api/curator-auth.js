import crypto from 'crypto';

// ── Rate limiting secondaire (le PoW est la protection principale) ────────────
const store = new Map();
const MAX_REQ  = 15;
const WIN_MS   = 60 * 1000; // 15 req/min par IP

function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function rateLimit(ip) {
  const now = Date.now();
  const e   = store.get(ip) || { count: 0, firstAt: now };
  if (now - e.firstAt > WIN_MS) { e.count = 0; e.firstAt = now; }
  e.count++;
  store.set(ip, e);
  return e.count > MAX_REQ;
}

// ── Origin allowlist ──────────────────────────────────────────────────────────
const ALLOWED = ['veltrix-records.com', 'localhost', '127.0.0.1'];
function allowedOrigin(req) {
  const o = req.headers.origin || req.headers.referer || '';
  return !o || ALLOWED.some(h => o.includes(h));
}

// ── Proof of Work verification ────────────────────────────────────────────────
function verifyPoW({ challenge, sig, nonce, difficulty }, secret) {
  if (!challenge || !sig || nonce === undefined) return 'Champs manquants';

  // 1. Vérifier la signature du challenge
  const expected = crypto.createHmac('sha256', secret).update(String(challenge)).digest('hex');
  if (expected !== sig) return 'Challenge invalide';

  // 2. Vérifier l'expiration
  const expires = parseInt(String(challenge).split('.')[1] || '0');
  if (Date.now() > expires) return 'Challenge expiré — réessaie';

  // 3. Vérifier la solution PoW
  const hash   = crypto.createHash('sha256').update(String(challenge) + String(nonce)).digest('hex');
  const target = '0'.repeat(difficulty ?? 4);
  if (!hash.startsWith(target)) return 'Solution PoW incorrecte';

  return null; // OK
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default function handler(req, res) {
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }

  const ip = getIp(req);
  if (rateLimit(ip)) return res.status(429).json({ error: 'Trop de requêtes — réessaie dans 1 min' });

  const { password, challenge, sig, nonce } = req.body ?? {};
  const correct = process.env.CURATOR_PASSWORD;
  const secret  = process.env.CURATOR_TOKEN_SECRET;

  if (!correct || !secret) return res.status(500).json({ error: 'Service non configuré' });

  // Vérifier le PoW en premier — rejette sans délai si invalide
  const powErr = verifyPoW({ challenge, sig, nonce, difficulty: 4 }, secret);
  if (powErr) return res.status(400).json({ error: powErr });

  // Vérifier le mot de passe (timing-safe)
  const pwBuf = Buffer.from(String(password ?? ''), 'utf8');
  const okBuf = Buffer.from(correct, 'utf8');
  const valid  = pwBuf.length === okBuf.length && crypto.timingSafeEqual(pwBuf, okBuf);

  if (!valid) {
    // Délai fixe — ne pas révéler d'info via le timing
    return setTimeout(() => res.status(401).json({ error: 'Mot de passe incorrect' }), 800);
  }

  // Générer le token d'accès (30 jours)
  const exp     = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const tokSig  = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return res.status(200).json({ token: `${payload}.${tokSig}` });
}
