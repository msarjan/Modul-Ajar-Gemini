// Vercel Serverless Function — proxy aman ke Gemini API via OpenRouter
// API key disimpan di environment variable Vercel, tidak pernah terekspos ke browser

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL              = 'google/gemini-3.5-flash';
const MAX_TOKENS         = 65536;

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

// Konversi format Gemini (contents/parts) ke format OpenAI/OpenRouter (messages/content)
function convertToOpenAI(contents) {
  return contents.map(item => {
    const role = item.role === 'model' ? 'assistant' : 'user';

    // Jika parts hanya berisi teks biasa
    if (item.parts && item.parts.length === 1 && item.parts[0].text) {
      return { role, content: item.parts[0].text };
    }

    // Jika parts berisi campuran (teks + inline_data/PDF)
    if (item.parts) {
      const contentParts = item.parts.map(part => {
        if (part.text) {
          return { type: 'text', text: part.text };
        }
        if (part.inline_data) {
          return {
            type: 'image_url',
            image_url: {
              url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`
            }
          };
        }
        return null;
      }).filter(Boolean);

      return { role, content: contentParts };
    }

    return { role, content: '' };
  });
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  if (!OPENROUTER_API_KEY)
    return res.status(500).json({ error: 'OPENROUTER_API_KEY belum diset di Vercel environment variables.' });

  const { contents, max_tokens } = req.body || {};

  if (!contents)
    return res.status(400).json({ error: 'Request body tidak valid.' });

  try {
    const messages = convertToOpenAI(contents);

    const upstream = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model:       MODEL,
          messages,
          max_tokens:  max_tokens || MAX_TOKENS,
          temperature: 1,
        })
      }
    );

    const data = await upstream.json();

    // Konversi response OpenRouter kembali ke format Gemini
    // agar index.html tidak perlu diubah
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message?.content || '';
      return res.status(200).json({
        candidates: [{
          content: {
            parts: [{ text }]
          },
          finishReason: data.choices[0].finish_reason?.toUpperCase() || 'STOP'
        }]
      });
    }

    // Jika ada error dari OpenRouter, teruskan apa adanya
    return res.status(upstream.status).json(data);

  } catch (err) {
    return res.status(500).json({
      error:   'Gagal terhubung ke OpenRouter API',
      details: err.message
    });
  }
};
