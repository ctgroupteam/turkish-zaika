const crypto = require('crypto');

function getAuthSecret() {
  return process.env.TZ_AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-dev-secret-change-in-prod';
}

function signToken(role = 'owner', ttlMs = 12 * 60 * 60 * 1000) {
  const payload = {
    role,
    exp: Date.now() + ttlMs,
    iat: Date.now()
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyPin(inputPin) {
  const expectedPin = String(process.env.TZ_ADMIN_PIN || '').trim();
  const actualPin = String(inputPin || '').trim();
  if (!expectedPin || !actualPin) return false;

  const a = Buffer.from(actualPin);
  const b = Buffer.from(expectedPin);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getBearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = {
  signToken,
  verifyToken,
  verifyPin,
  getBearerToken,
  readJsonBody
};
