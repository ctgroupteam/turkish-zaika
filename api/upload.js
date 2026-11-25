const { verifyToken, getBearerToken, readJsonBody } = require('../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = getBearerToken(req);
  const session = verifyToken(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Unauthorized. Please unlock with your 4-digit PIN.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Storage credentials missing.' });
  }

  try {
    const body = await readJsonBody(req);
    const { base64, filename } = body || {};

    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({ ok: false, error: 'Compressed image data is required.' });
    }

    const mimeMatch = base64.match(/^data:(image\/(?:webp|jpeg|jpg|png));base64,/);
    const contentType = mimeMatch ? (mimeMatch[1] === 'image/jpg' ? 'image/jpeg' : mimeMatch[1]) : 'image/webp';
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp';
    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'Image is too large even after compression (max 2MB).' });
    }

    const safeBase = String(filename || 'dish')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const objectPath = `turkishzaika/${Date.now()}-${safeBase}.${ext}`;

    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/uploads/${objectPath}`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': contentType,
        'Cache-Control': '31536000',
        'x-upsert': 'true'
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return res.status(uploadRes.status).json({ ok: false, error: `Storage upload failed: ${errText}` });
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/uploads/${objectPath}`;
    return res.status(200).json({
      ok: true,
      url: publicUrl,
      bytes: buffer.length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Image upload failed' });
  }
};
