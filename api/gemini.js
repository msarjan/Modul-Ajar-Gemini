// Vercel Serverless Function — proxy aman ke Gemini API
// API key disimpan di environment variable Vercel, tidak pernah terekspos ke browser

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL          = 'gemini-3.1-flash-lite';
const MAX_TOKENS     = 65536;

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

  if (!GEMINI_API_KEY)
    return res.status(500).json({ error: 'GEMINI_API_KEY belum diset di Vercel environment variables.' });

  const { contents, max_tokens } = req.body || {};

  if (!contents)
    return res.status(400).json({ error: 'Request body tidak valid.' });

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: max_tokens || MAX_TOKENS,
            temperature:     1,
          }
        })
      }
    );

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    return res.status(500).json({
      error:   'Gagal terhubung ke Gemini API',
      details: err.message
    });
  }
};
