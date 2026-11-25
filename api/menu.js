const { verifyToken, getBearerToken, readJsonBody } = require('../lib/auth');

const ALLOWED_CATEGORIES = new Set(['mandi', 'kebabs', 'curries', 'desserts']);
const ALLOWED_DIETS = new Set(['veg', 'nonveg']);

function sanitizeMenuItem(item, index) {
  const cleanId = String(item?.id || `tz-dish-${Date.now()}-${index}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const category = ALLOWED_CATEGORIES.has(item?.category) ? item.category : 'kebabs';
  const diet = ALLOWED_DIETS.has(item?.diet) ? item.diet : 'nonveg';
  const priceNum = Number(item?.price);
  const price = Number.isFinite(priceNum) && priceNum >= 0 ? Math.round(priceNum) : 0;

  let tags = [];
  if (Array.isArray(item?.tags)) {
    tags = item.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
  } else if (typeof item?.tags === 'string') {
    tags = item.tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8);
  }

  return {
    id: cleanId || `tz-dish-${Date.now()}-${index}`,
    name: String(item?.name || 'Untitled Dish').trim().slice(0, 120),
    category,
    diet,
    price,
    portion: String(item?.portion || 'Serves 1 - 2 Persons').trim().slice(0, 60),
    bestseller: Boolean(item?.bestseller),
    image: String(item?.image || '').trim().slice(0, 1000),
    desc: String(item?.desc || '').trim().slice(0, 500),
    tags
  };
}

async function cleanupRemovedImages(supabaseUrl, serviceKey, oldMenu, newMenu) {
  try {
    const prefix = `${supabaseUrl}/storage/v1/object/public/uploads/`;
    const newImages = new Set(newMenu.map(i => i.image).filter(Boolean));
    const removedPaths = oldMenu
      .map(i => i.image)
      .filter(img => img && img.startsWith(prefix) && !newImages.has(img))
      .map(img => img.slice(prefix.length))
      .filter(path => path.startsWith('turkishzaika/'));

    if (removedPaths.length === 0) return;

    await fetch(`${supabaseUrl}/storage/v1/object/uploads`, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefixes: removedPaths })
    });
  } catch (e) {
    console.warn('Image cleanup note:', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Database environment variables are not configured.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/stores?slug=eq.turkishzaika&select=site_data,updated_at`, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      if (!r.ok) {
        const text = await r.text();
        return res.status(r.status).json({ ok: false, error: text });
      }
      const rows = await r.json();
      const row = rows?.[0];
      const menu = Array.isArray(row?.site_data?.restaurantMenu) ? row.site_data.restaurantMenu : null;
      return res.status(200).json({
        ok: true,
        menu,
        updatedAt: row?.updated_at || null
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Failed to load menu' });
    }
  }

  if (req.method === 'POST') {
    const token = getBearerToken(req);
    const session = verifyToken(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: 'Unauthorized. Please unlock with your 4-digit PIN.' });
    }

    try {
      const body = await readJsonBody(req);
      if (!Array.isArray(body?.menu)) {
        return res.status(400).json({ ok: false, error: 'Invalid menu payload.' });
      }

      const sanitizedMenu = body.menu.map((item, idx) => sanitizeMenuItem(item, idx));
      const now = new Date().toISOString();

      // Load existing row to preserve metadata and detect removed images
      const getRes = await fetch(`${supabaseUrl}/rest/v1/stores?slug=eq.turkishzaika&select=id,site_data`, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      const existingRows = await getRes.json();
      const existingRow = existingRows?.[0];
      const oldMenu = Array.isArray(existingRow?.site_data?.restaurantMenu)
        ? existingRow.site_data.restaurantMenu
        : [];

      const updatedSiteData = {
        ...(existingRow?.site_data || {
          id: 'site-turkishzaika-solapur',
          slug: 'turkishzaika',
          name: 'Turkish Zaika Restaurant',
          type: 'restaurant',
          liveUrl: 'https://turkishzaika.linkal.in',
          status: 'live'
        }),
        restaurantMenu: sanitizedMenu,
        updatedAt: now
      };

      if (existingRow) {
        const patchRes = await fetch(`${supabaseUrl}/rest/v1/stores?slug=eq.turkishzaika`, {
          method: 'PATCH',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            site_data: updatedSiteData,
            updated_at: now
          })
        });
        if (!patchRes.ok) {
          const errText = await patchRes.text();
          return res.status(patchRes.status).json({ ok: false, error: errText });
        }
      } else {
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/stores`, {
          method: 'POST',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            id: 'site-turkishzaika-solapur',
            slug: 'turkishzaika',
            business_name: 'Turkish Zaika Restaurant',
            category: 'restaurant',
            template_id: 'turkish-zaika-custom',
            is_active: true,
            site_data: updatedSiteData
          })
        });
        if (!insertRes.ok) {
          const errText = await insertRes.text();
          return res.status(insertRes.status).json({ ok: false, error: errText });
        }
      }

      // Clean up orphaned uploaded photos asynchronously
      cleanupRemovedImages(supabaseUrl, serviceKey, oldMenu, sanitizedMenu);

      return res.status(200).json({
        ok: true,
        menu: sanitizedMenu,
        updatedAt: now
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Failed to save menu' });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
