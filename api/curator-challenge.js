import crypto from 'crypto';

const ALLOWED = ['veltrix-records.com', 'localhost', '127.0.0.1'];
function allowedOrigin(req) {
  const o = req.headers.origin || req.headers.referer || '';
  return !o || ALLOWED.some(h => o.includes(h));
}

export default function handler(req, res) {
  if (!allowedOrigin(req)) return res.status(403).end();
  if (req.method !== 'GET')  { res.setHeader('Allow', 'GET'); return res.status(405).end(); }

  const secret = process.env.CURATOR_TOKEN_SECRET;
  if (!secret) return res.status(500).json({ error: 'Non configuré' });

  const rand    = crypto.randomBytes(16).toString('hex');
  const expires = Date.now() + 3 * 60 * 1000; // valide 3 min
  const data    = `${rand}.${expires}`;
  const sig     = crypto.createHmac('sha256', secret).update(data).digest('hex');

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ challenge: data, sig, difficulty: 4 });
}
