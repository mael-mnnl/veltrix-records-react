import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const { token } = req.body ?? {};
  const secret = process.env.CURATOR_TOKEN_SECRET;

  if (!secret) return res.status(500).json({ valid: false });
  if (!token)  return res.status(400).json({ valid: false });

  const dot = String(token).lastIndexOf('.');
  if (dot < 1)  return res.status(400).json({ valid: false });

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
