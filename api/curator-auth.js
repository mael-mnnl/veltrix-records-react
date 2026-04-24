import crypto from 'crypto';

// ── Rate limiting (module-level, persiste sur les instances chaudes) ──────────
const store = new Map(); // ip -> { count, firstAt, lockedUntil }

const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 min
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 min de blocage

function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function check(ip) {
  const now   = Date.now();
  const entry = store.get(ip);
  if (!entry) return { blocked: false };
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { blocked: true, secsLeft: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (now - entry.firstAt > WINDOW_MS) { store.delete(ip); return { blocked: false }; }
  return { blocked: false, count: entry.count };
}

function fail(ip) {
  const now   = Date.now();
  const entry = store.get(ip) || { count: 0, firstAt: now, lockedUntil: null };
  if (now - entry.firstAt > WINDOW_MS) { entry.count = 0; entry.firstAt = now; entry.lockedUntil = null; }
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCKOUT_MS;
  store.set(ip, entry);
  return entry.count;
}

function succeed(ip) { store.delete(ip); }

// ── Allowed origins ───────────────────────────────────────────────────────────
const ALLOWED = ['veltrix-records.com', 'localhost', '127.0.0.1'];

function allowedOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  return !origin || ALLOWED.some(h => origin.includes(h));
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default function handler(req, res) {
  if (!allowedOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }

  const ip = getIp(req);
  const rl = check(ip);

  if (rl.blocked) {
    const mins = Math.ceil(rl.secsLeft / 60);
    return res.status(429).json({ error: `Trop de tentatives — réessaie dans ${mins} min` });
  }

  const { password } = req.body ?? {};
  const correct = process.env.CURATOR_PASSWORD;
  const secret  = process.env.CURATOR_TOKEN_SECRET;

  if (!correct || !secret) return res.status(500).json({ error: 'Service non configuré' });

  const pwBuf = Buffer.from(String(password ?? ''), 'utf8');
  const okBuf = Buffer.from(correct, 'utf8');
  const valid  = pwBuf.length === okBuf.length && crypto.timingSafeEqual(pwBuf, okBuf);

  if (!valid) {
    const count     = fail(ip);
    const remaining = MAX_ATTEMPTS - count;
    const delay     = count >= 3 ? 2000 : 800;
    const msg       = remaining <= 0
      ? 'Compte bloqué 15 min'
      : remaining <= 2
        ? `Mot de passe incorrect — ${remaining} tentative${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`
        : 'Mot de passe incorrect';
    return setTimeout(() => res.status(remaining <= 0 ? 429 : 401).json({ error: msg }), delay);
  }

  succeed(ip);

  const exp     = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return res.status(200).json({ token: `${payload}.${sig}` });
}
