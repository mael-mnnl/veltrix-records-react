import crypto from 'crypto';

// ── Rate limiting sur la vérification (anti-énumération) ─────────────────────
const store = new Map();
const MAX   = 30;
const WIN   = 60 * 1000; // 30 vérifications / minute par IP

function getIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function checkVerifyLimit(ip) {
  const now   = Date.now();
  const entry = store.get(ip) || { count: 0, firstAt: now };
  if (now - entry.firstAt > WIN) { entry.count = 0; entry.firstAt = now; }
  entry.count++;
  store.set(ip, entry);
  return entry.count > MAX;
}

const ALLOWED = ['veltrix-records.com', 'localhost', '127.0.0.1'];
function allowedOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  return !origin || ALLOWED.some(h => origin.includes(h));
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default function handler(req, res) {
  if (!allowedOrigin(req)) return res.status(403).json({ valid: false });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }

  const ip = getIp(req);
  if (checkVerifyLimit(ip)) return res.status(429).json({ valid: false });

  const { token } = req.body ?? {};
  const secret = process.env.CURATOR_TOKEN_SECRET;

  if (!secret) return res.status(500).json({ valid: false });
  if (!token)  return res.status(400).json({ valid: false });

  const dot = String(token).lastIndexOf('.');
  if (dot < 1) return res.status(400).json({ valid: false });

  const payload  = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  let sigMatch = false;
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sig,      'utf8');
    sigMatch = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { /* longueurs différentes */ }

  if (!sigMatch) return res.status(401).json({ valid: false });

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return res.status(400).json({ valid: false });
  }

  if (!parsed.exp || parsed.exp < Date.now()) {
    return res.status(401).json({ valid: false });
  }

  return res.status(200).json({ valid: true });
}
