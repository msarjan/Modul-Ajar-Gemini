// api/lynk-webhook.js
// Vercel Serverless Function
// Menerima webhook dari Lynk.id → generate kode GBD (sebanyak qty) → insert Supabase → kirim email

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ── Mapping nama produk Lynk.id → jumlah kuota per unit ──────
const PRODUK_KUOTA = {
  'Kuota x1 Modul' : 1,
  'Kuota x4 Modul' : 4,
  'Kuota x10 Modul': 10,
};
// ─────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Generate kode GBD-XXXXXX (6 karakter, tanpa 0/O dan 1/I)
function generateKode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'GBD-';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// Generate kode unik (cek ke Supabase, coba sampai 10x)
async function generateKodeUnik() {
  let attempts = 0;
  while (attempts < 10) {
    const kandidat = generateKode();
    const { data: existing } = await supabase
      .from('invite_codes')
      .select('code')
      .eq('code', kandidat)
      .single();

    if (!existing) {
      return kandidat;
    }
    attempts++;
  }
  throw new Error('Gagal generate kode unik setelah 10 percobaan');
}

// Validasi signature Lynk.id
function validasiSignature(body, signature, merchantKey) {
  const expected = crypto
    .createHmac('sha256', merchantKey)
    .update(body)
    .digest('hex');
  return expected === signature;
}

// Kirim email via Gmail SMTP (Nodemailer) — 1 kotak per kode
async function kirimEmail({ email, nama, namaPaket, kuota, kodeList }) {
  const nodemailer = require('nodemailer');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const kodeBoxes = kodeList.map(kode => `
        <div style="
          background: #FAF7F1;
          border: 2px solid #0E6B53;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin: 16px 0;
        ">
          <p style="margin: 0 0 8px; font-size: 14px; color: #666;">Kode Aksesmu</p>
          <p style="margin: 0; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #0E6B53;">${kode}</p>
          <p style="margin: 8px 0 0; font-size: 14px; color: #666;">Kuota: ${kuota} modul</p>
        </div>
  `).join('');

  const jumlahKodeText = kodeList.length > 1
    ? `<p>Terima kasih sudah membeli <strong>${namaPaket}</strong> (${kodeList.length}x). Berikut ${kodeList.length} kode kuota kamu — masing-masing berisi ${kuota} modul:</p>`
    : `<p>Terima kasih sudah membeli <strong>${namaPaket}</strong>. Berikut kode kuota kamu:</p>`;

  await transporter.sendMail({
    from: `"Modul Ajar Madrasah" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Kode Kuota Modul Ajar Madrasah kamu sudah siap! 🎉',
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #141414;">
        <h2 style="color: #0E6B53;">Halo ${nama},</h2>
        ${jumlahKodeText}

        ${kodeBoxes}

        <p><strong>Cara pakai:</strong></p>
        <ol style="line-height: 1.8;">
          <li>Buka <a href="https://modul-ajar-madrasah.vercel.app" style="color: #0E6B53;">modul-ajar-madrasah.vercel.app</a></li>
          <li>Masukkan kode di kolom <strong>"Kode Akses"</strong></li>
          <li>Mulai generate modul ajar! 🚀</li>
        </ol>

        <p style="margin-top: 32px; font-size: 14px; color: #666;">
          Ada pertanyaan? DM Instagram 
          <a href="https://instagram.com/sarjan.eth" style="color: #0E6B53;">@sarjan.eth</a>
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
        <p style="font-size: 12px; color: #999; text-align: center;">
          Tim Modul Ajar Madrasah · Generator modul ajar berbasis AI untuk guru madrasah Indonesia
        </p>
      </div>
    `,
  });
}

// ── Handler utama ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Hanya terima POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Ambil raw body untuk validasi signature
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-lynk-signature'];

    // Validasi signature — sementara dinonaktifkan untuk testing
    // TODO: aktifkan kembali setelah format signature Lynk.id dikonfirmasi
    // if (!validasiSignature(rawBody, signature, process.env.LYNK_MERCHANT_KEY)) {
    //   console.error('Signature tidak valid');
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // Log payload asli untuk debugging
    console.log("PAYLOAD LYNK:", JSON.stringify(req.body, null, 2));

    // Ekstrak data dari payload Lynk.id
    const messageData = req.body?.data?.message_data;
    const { customer, items, totals, refId } = messageData;
    const email     = customer?.email;
    const nama      = customer?.name || 'Guru';
    const namaPaket = items?.[0]?.title;
    const qty       = items?.[0]?.qty || 1;
    const grandTotal = totals?.grandTotal;

    // Validasi field wajib
    if (!email || !namaPaket) {
      console.error('Payload tidak lengkap:', { email, namaPaket });
      return res.status(400).json({ error: 'Payload tidak lengkap' });
    }

    // Mapping produk → kuota per unit
    const kuota = PRODUK_KUOTA[namaPaket];
    if (!kuota) {
      console.error('Nama produk tidak dikenali:', namaPaket);
      return res.status(400).json({ error: `Produk tidak dikenali: ${namaPaket}` });
    }

    // Generate & insert kode sebanyak qty
    const kodeList = [];
    for (let i = 0; i < qty; i++) {
      const kode = await generateKodeUnik();

      const { error: insertError } = await supabase
        .from('invite_codes')
        .insert({
          code        : kode,
          kuota_total : kuota,
          kuota_sisa  : kuota,
          Nama        : `${nama} - ${email} - refId:${refId}-${i + 1}/${qty}`,
        });

      if (insertError) {
        throw new Error(`Supabase insert error (kode ${i + 1}/${qty}): ${insertError.message}`);
      }

      kodeList.push(kode);
    }

    // Kirim 1 email berisi semua kode
    await kirimEmail({ email, nama, namaPaket, kuota, kodeList });

    console.log(`✅ Webhook OK | refId:${refId} | ${email} | ${namaPaket} x${qty} | kode:${kodeList.join(', ')}`);
    return res.status(200).json({ success: true, kodes: kodeList });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
