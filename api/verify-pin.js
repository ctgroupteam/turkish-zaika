const { verifyPin, signToken, verifyToken, getBearerToken, readJsonBody } = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Allow checking if an existing session token is still valid
  if (req.method === 'GET') {
    const token = getBearerToken(req);
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ ok: false, error: 'Session expired' });
    }
    return res.status(200).json({ ok: true, role: payload.role });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const pin = body?.pin;

    if (!verifyPin(pin)) {
      // Slight delay to mitigate brute-force guessing
      await new Promise(r => setTimeout(r, 350));
      return res.status(401).json({ ok: false, error: 'Incorrect 4-digit PIN.' });
    }

    const token = signToken('owner');
    return res.status(200).json({ ok: true, token });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Verification failed' });
  }
};
