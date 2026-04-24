import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const { password } = req.body ?? {};
  const correct = process.env.CURATOR_PASSWORD;
  const secret  = process.env.CURATOR_TOKEN_SECRET;

  if (!correct || !secret) {
    return res.status(500).json({ error: 'Service non configuré — variables manquantes' });
  }

  const pwBuf = Buffer.from(String(password ?? ''), 'utf8');
  const okBuf = Buffer.from(correct, 'utf8');
  const valid  = pwBuf.length === okBuf.length &&
    crypto.timingSafeEqual(pwBuf, okBuf);

  if (!valid) {
    // Délai pour ralentir le brute-force
    return setTimeout(() => res.status(401).json({ error: 'Mot de passe incorrect' }), 600);
  }

  const exp     = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig     = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return res.status(200).json({ token: `${payload}.${sig}` });
}
