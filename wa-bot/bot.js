const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const http = require('http');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
let claude = null;

// ── Shared state ──────────────────────────────────────────────────────────────
const botState = { connected: false, phone: null, qr: null };
let currentSock = null;
let isDisconnecting = false;
let lastError = null;

// ── Dynamic settings from Supabase ────────────────────────────────────────────
let cachedSettings = { system_prompt: null, claude_api_key: null };
let lastAppliedApiKey = null;

// Initialize Claude from env var immediately as fallback
const envApiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
if (envApiKey) {
  claude = new Anthropic({ apiKey: envApiKey });
  lastAppliedApiKey = envApiKey;
  console.log('Claude API key loaded from environment variable');
}

async function refreshBotSettings() {
  try {
    const { data, error } = await supabase.from('wa_bot_settings').select('system_prompt, claude_api_key').eq('id', 'default').maybeSingle();
    if (error) { console.error('wa_bot_settings query error:', error.message); return; }
    if (data) {
      cachedSettings.system_prompt = data.system_prompt || null;
      const newKey = data.claude_api_key || null;
      if (newKey && newKey !== lastAppliedApiKey) {
        claude = new Anthropic({ apiKey: newKey });
        lastAppliedApiKey = newKey;
        console.log('Claude API key loaded from Supabase');
      }
    }
  } catch (err) {
    console.error('Could not refresh bot settings:', err.message);
  }
}

// Refresh on startup and every 5 minutes
refreshBotSettings();
setInterval(refreshBotSettings, 5 * 60 * 1000);

// ── HTTP API server (CRM dashboard + health check) ────────────────────────────
const PORT = process.env.PORT || 3001;
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/version') {
    res.end(JSON.stringify({ version: '2cf6f18', send_endpoint: true }));
    return;
  }

  if (req.url === '/debug') {
    res.end(JSON.stringify({
      claude_initialized: claude !== null,
      supabase_url_set: !!process.env.SUPABASE_URL,
      supabase_key_set: !!process.env.SUPABASE_SERVICE_KEY,
      last_applied_api_key_prefix: lastAppliedApiKey ? lastAppliedApiKey.slice(0, 12) + '...' : null,
      last_error: lastError,
      bot_connected: botState.connected,
      bot_phone: botState.phone,
    }));
    return;
  }

  if (req.method === 'POST' && req.url === '/refresh-settings') {
    await refreshBotSettings();
    res.end(JSON.stringify({ ok: true, claude_initialized: claude !== null }));
    return;
  }

  if (req.method === 'POST' && (req.url === '/send' || req.url === '/send/')) {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { phone, message } = JSON.parse(Buffer.concat(chunks).toString());
      if (!phone || !message) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'phone and message required' }));
        return;
      }
      if (!currentSock || !botState.connected) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'Bot not connected to WhatsApp' }));
        return;
      }
      let clean = String(phone).replace(/\D/g, '');
      if (clean.startsWith('0')) clean = clean.slice(1);
      if (clean.length === 10) clean = '91' + clean;
      const jid = `${clean}@s.whatsapp.net`;
      await currentSock.sendMessage(jid, { text: message });
      console.log(`[/send] Sent to ${jid}: ${message.slice(0, 60)}`);
      res.end(JSON.stringify({ ok: true, sent_to: jid }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/disconnect') {
    console.log('Disconnect requested...');
    isDisconnecting = true;
    botState.connected = false;
    botState.phone = null;
    botState.qr = null;

    try { if (currentSock) await currentSock.logout(); } catch (_) {}

    // Clear local auth + Supabase session
    const authDir = path.join(__dirname, 'auth_info');
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    await supabase.from('wa_auth_sessions').delete().eq('id', 'default');

    isDisconnecting = false;
    setTimeout(startBot, 1000);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.end(JSON.stringify(botState));
}).listen(PORT, () => console.log(`Bot API listening on port ${PORT}`));

// ── Supabase auth helpers ─────────────────────────────────────────────────────
async function loadCredsFromSupabase() {
  try {
    const { data } = await supabase.from('wa_auth_sessions').select('creds').eq('id', 'default').maybeSingle();
    if (data?.creds) {
      const authDir = path.join(__dirname, 'auth_info');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(data.creds), 'utf8');
      console.log('Loaded credentials from Supabase');
      return true;
    }
  } catch (err) {
    console.error('Could not load creds from Supabase:', err.message);
  }
  return false;
}

async function saveCredsToSupabase(creds) {
  try {
    await supabase.from('wa_auth_sessions').upsert({
      id: 'default',
      creds,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Could not save creds to Supabase:', err.message);
  }
}

// ── Language detection ────────────────────────────────────────────────────────
function detectLanguage(text) {
  if (/[؀-ۿ]/.test(text)) {
    // Distinguish Urdu from Arabic by common Urdu-specific characters
    if (/[ٹڈڑںھہیے]/.test(text)) return 'urdu';
    return 'arabic';
  }
  if (/[ऀ-ॿ]/.test(text)) return 'hindi';
  return 'english';
}

// ── Claude prompt + tools ─────────────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `You are a friendly visa application assistant for Euro World Global Transit Private Limited. Your job is to qualify leads via WhatsApp by collecting their information naturally.

Collect EXACTLY these 4 details, one at a time, in this order:
1. Customer's full name
2. Which visa/service they need (e.g., Dubai Tourist Visa, Saudi Umrah Visa, UK Visit Visa, Schengen Visa, etc.)
3. Their contact phone number (for follow-up calls by our team)
4. Travel date (approximate is fine, e.g. "next month", "March 2026")

Rules:
- Ask only ONE question per message
- NEVER re-ask something the customer already answered — track what you have and what is missing
- Be warm, professional, and brief
- CRITICAL: Always respond in the EXACT same language the customer is writing in
  - If they write in Arabic → respond in Arabic
  - If they write in Urdu → respond in Urdu
  - If they write in Hindi → respond in Hindi
  - If they write in English → respond in English
- Do NOT switch languages mid-conversation
- Do NOT discuss fees or pricing
- Do NOT promise visa approval
- Once you have all 4 details, call the create_lead tool immediately

After creating the lead, send the confirmation in the customer's language:
- English: "Thank you [name]! Your details have been registered. Our team will call you at [phone] within 2 hours regarding your [service] application. For urgent queries, reply here."
- Arabic: "شكراً لك [name]! تم تسجيل بياناتك. سيتواصل معك فريقنا على [phone] خلال ساعتين بخصوص طلب [service]. للاستفسارات العاجلة، يرجى الرد هنا."
- Urdu: "شکریہ [name]! آپ کی معلومات درج ہو گئی ہیں۔ ہماری ٹیم آپ کو [phone] پر 2 گھنٹوں میں [service] کے بارے میں رابطہ کرے گی۔ فوری سوالات کے لیے یہاں جواب دیں۔"
- Hindi: "धन्यवाद [name]! आपकी जानकारी दर्ज हो गई है। हमारी टीम [phone] पर 2 घंटे के भीतर [service] के बारे में संपर्क करेगी। तत्काल प्रश्नों के लिए यहाँ उत्तर दें।"`;

function getSystemPrompt() {
  return cachedSettings.system_prompt || DEFAULT_SYSTEM_PROMPT;
}

const tools = [
  {
    name: 'create_lead',
    description: 'Register a qualified lead in the CRM once all 4 details are collected',
    input_schema: {
      type: 'object',
      properties: {
        pax_name: { type: 'string', description: 'Full name of the customer' },
        service_name: { type: 'string', description: 'Visa or service they need' },
        phone: { type: 'string', description: 'Customer contact phone number for follow-up calls' },
        travel_date: { type: 'string', description: 'Travel date or approximate timeframe' },
      },
      required: ['pax_name', 'service_name', 'phone', 'travel_date'],
    },
  },
];

// ── In-memory conversation cache (primary) + Supabase (async backup) ─────────
const conversationCache = new Map();

async function getOrCreateConversation(phone) {
  if (conversationCache.has(phone)) return conversationCache.get(phone);

  // Try loading from Supabase
  try {
    const { data } = await supabase.from('wa_conversations').select('*').eq('phone', phone).maybeSingle();
    if (data) { conversationCache.set(phone, data); return data; }
  } catch (err) {
    console.error('Supabase select error:', err.message);
  }

  // Create new conversation (in memory first)
  const newConv = { phone, messages: [], stage: 'qualifying', lead_id: null, language: null };
  conversationCache.set(phone, newConv);

  // Persist to Supabase async (don't block)
  supabase.from('wa_conversations').insert({ phone, messages: [], stage: 'qualifying' })
    .then(({ error }) => { if (error) console.error('Supabase insert error:', error.message); })
    .catch(err => console.error('Supabase insert exception:', err.message));

  return newConv;
}

async function saveConversation(phone, messages, extra = {}) {
  // Update in-memory cache immediately (this always works)
  const existing = conversationCache.get(phone) || { phone, messages: [], stage: 'qualifying' };
  conversationCache.set(phone, { ...existing, messages, ...extra });

  // Persist to Supabase async (don't block the reply)
  supabase.from('wa_conversations').update({ messages, updated_at: new Date().toISOString(), ...extra }).eq('phone', phone)
    .then(({ error }) => { if (error) console.error('Supabase update error:', error.message); })
    .catch(err => console.error('Supabase update exception:', err.message));
}

// ── Confirmation messages by language ────────────────────────────────────────
function confirmationMessage(name, service, contactPhone, lang) {
  switch (lang) {
    case 'arabic':
      return `شكراً لك ${name}!\n\nتم تسجيل بياناتك بنجاح.\n\n📋 الملخص:\n• الاسم: ${name}\n• الخدمة: ${service}\n• رقم التواصل: ${contactPhone}\n\nسيتواصل معك فريقنا خلال ساعتين. للاستفسارات العاجلة، يرجى الرد هنا.`;
    case 'urdu':
      return `شکریہ ${name}!\n\nآپ کی معلومات درج ہو گئی ہیں۔\n\n📋 خلاصہ:\n• نام: ${name}\n• سروس: ${service}\n• رابطہ نمبر: ${contactPhone}\n\nہماری ٹیم 2 گھنٹوں میں آپ سے رابطہ کرے گی۔ فوری سوالات کے لیے یہاں جواب دیں۔`;
    case 'hindi':
      return `धन्यवाद ${name}!\n\nआपकी जानकारी दर्ज हो गई है।\n\n📋 सारांश:\n• नाम: ${name}\n• सेवा: ${service}\n• संपर्क नंबर: ${contactPhone}\n\nहमारी टीम 2 घंटे के भीतर संपर्क करेगी। तत्काल प्रश्नों के लिए यहाँ उत्तर दें।`;
    default:
      return `Thank you ${name}!\n\nYour details have been registered.\n\n📋 Summary:\n• Name: ${name}\n• Service: ${service}\n• Contact: ${contactPhone}\n\nOur team will call you within 2 hours. For urgent queries, reply here.`;
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMessage(sock, from, text) {
  const phone = from.replace(/@.*/, '');
  const lang = detectLanguage(text);
  console.log(`[${phone}] [${lang}] ${text}`);

  const conv = await getOrCreateConversation(phone);
  if (!conv) { console.error(`[${phone}] Could not get conversation`); return; }
  if (conv.lead_id) { console.log(`[${phone}] Already qualified`); return; }

  const messages = [...(conv.messages || []), { role: 'user', content: text }];

  // Pass detected language as a hint so Claude locks in the right language
  const langHint = lang !== 'english'
    ? `\n\n[System note: Customer is writing in ${lang}. You MUST respond in ${lang} only.]`
    : '';

  if (!claude) throw new Error('Claude API key not configured. Add it in WhatsApp Bot Settings.');

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: getSystemPrompt() + langHint,
    messages,
    tools,
  });

  // Track language from the first message for confirmation
  const convLang = conv.language || lang;

  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      await saveConversation(phone, [...messages, { role: 'assistant', content: block.text }], { language: convLang });
      await sock.sendMessage(from, { text: block.text });
      console.log(`[${phone}] Reply sent`);

    } else if (block.type === 'tool_use' && block.name === 'create_lead') {
      const input = block.input;
      const notes = input.travel_date ? `Travel date: ${input.travel_date}` : null;

      const { data: lead, error: leadErr } = await supabase.from('leads').insert({
        pax_name: input.pax_name,
        phone: input.phone || `+${phone}`,
        whatsapp: `+${phone}`,
        service_name: input.service_name || '',
        pax_count: 1,
        notes: notes || null,
        source: 'WhatsApp Bot',
        status: 'Under Process',
        base_fee: 0, gst_amount: 0, total_amount: 0, amount_paid: 0,
        payment_method: 'Cash',
      }).select().single();

      if (leadErr) console.error(`Lead insert error:`, leadErr.message);

      await saveConversation(phone, [...messages, { role: 'assistant', content: response.content }], {
        lead_id: lead?.id, stage: 'qualified', language: convLang,
      });

      const confirmMsg = confirmationMessage(input.pax_name, input.service_name, input.phone || `+${phone}`, convLang);
      await sock.sendMessage(from, { text: confirmMsg });
      console.log(`Lead created: ${input.pax_name} - ${input.service_name} (${lead?.id}) [${convLang}]`);
    }
  }
}

// ── Bot startup ───────────────────────────────────────────────────────────────
async function startBot() {
  if (isDisconnecting) return;

  // Always try to load latest credentials from Supabase first
  await loadCredsFromSupabase();

  const authDir = path.join(__dirname, 'auth_info');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Desktop', '0.0.0'],
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 15000,
    logger: require('pino')({ level: 'silent' }),
  });

  currentSock = sock;

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    await saveCredsToSupabase(state.creds); // keep Supabase in sync
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan QR code with WhatsApp → Linked Devices:\n');
      qrcode.generate(qr, { small: true });
      botState.qr = await QRCode.toDataURL(qr);
      botState.connected = false;
      botState.phone = null;
    }
    if (connection === 'open') {
      const phone = sock.user?.id?.replace(/:.*/, '') || null;
      botState.connected = true;
      botState.phone = phone;
      botState.qr = null;
      console.log(`✅ Connected! Phone: ${phone}`);
    }
    if (connection === 'close') {
      if (isDisconnecting) return;
      botState.connected = false;
      botState.qr = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log(`Connection closed (code: ${code})`);
      if (code === DisconnectReason.loggedOut || code === 401) {
        // Session revoked — clear stale creds so next start shows a fresh QR
        console.log('Session logged out — clearing credentials for fresh QR');
        try {
          await supabase.from('wa_auth_sessions').delete().eq('id', 'default');
        } catch (_) {}
        const authDir = path.join(__dirname, 'auth_info');
        if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
      }
      setTimeout(startBot, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid?.endsWith('@g.us')) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;
      try { await handleMessage(sock, msg.key.remoteJid, text); }
      catch (err) {
        lastError = { message: err.message, time: new Date().toISOString() };
        console.error('Message error:', err.message);
        try { await sock.sendMessage(msg.key.remoteJid, { text: `⚠️ Bot error: ${err.message}` }); } catch (_) {}
      }
    }
  });
}

startBot();
