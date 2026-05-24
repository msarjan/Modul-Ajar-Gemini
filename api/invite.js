// Vercel Serverless Function — validasi kode invite & kelola kuota via Supabase
// API key Supabase diambil dari environment variable, tidak pernah ke browser

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ── Helper: request ke Supabase REST API ──
async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    return res.status(500).json({ error: 'Supabase belum dikonfigurasi.' });

  const { action, code } = req.body || {};

  if (!code || typeof code !== 'string')
    return res.status(400).json({ error: 'Kode invite diperlukan.' });

  const kode = code.trim().toUpperCase();

  // ══ ACTION: check — validasi kode & ambil kuota ══
  if (action === 'check') {
    const result = await supabase(
      `invite_codes?code=eq.${encodeURIComponent(kode)}&select=code,kuota_sisa`
    );
    if (!result.ok || !result.data?.length)
      return res.status(200).json({ valid: false, error: 'Kode tidak valid.' });

    const row = result.data[0];
    return res.status(200).json({
      valid:      true,
      kuota_sisa: row.kuota_sisa
    });
  }

  // ══ ACTION: use — kurangi kuota setelah generate berhasil ══
  if (action === 'use') {
    // Ambil data terkini dulu
    const result = await supabase(
      `invite_codes?code=eq.${encodeURIComponent(kode)}&select=code,kuota_sisa`
    );
    if (!result.ok || !result.data?.length)
      return res.status(200).json({ valid: false, error: 'Kode tidak ditemukan.' });

    const row = result.data[0];
    if (row.kuota_sisa <= 0)
      return res.status(200).json({ valid: true, kuota_sisa: 0, error: 'Kuota habis.' });

    // Kurangi kuota
    const sisaBaru = row.kuota_sisa - 1;
    await supabase(
      `invite_codes?code=eq.${encodeURIComponent(kode)}`,
      {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ kuota_sisa: sisaBaru, last_used_at: new Date().toISOString() })
      }
    );

    // Catat ke usage_logs
    await supabase('usage_logs', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ code: kode, action: 'generate' })
    });

    return res.status(200).json({ valid: true, kuota_sisa: sisaBaru });
  }

  return res.status(400).json({ error: 'Action tidak dikenal. Gunakan "check" atau "use".' });
};
