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

// ── Dynamic settings from Supabase ────────────────────────────────────────────
let cachedSettings = { system_prompt: null, claude_api_key: null };
let lastAppliedApiKey = null;

async function refreshBotSettings() {
  try {
    const { data } = await supabase.from('wa_bot_settings').select('system_prompt, claude_api_key').eq('id', 'default').maybeSingle();
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
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.end('{}'); return; }

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

Collect these details one at a time in a conversational way:
1. Customer's full name
2. Which visa/service they need (e.g., Dubai Tourist Visa, Saudi Umrah Visa, UK Visit Visa, Schengen Visa, etc.)
3. Travel date (approximate is fine)
4. Number of travelers
5. Whether their passport is ready (yes/no)

Rules:
- Ask only ONE question per message
- Be warm, professional, and brief
- CRITICAL: Always respond in the EXACT same language the customer is writing in
  - If they write in Arabic → respond in Arabic
  - If they write in Urdu → respond in Urdu
  - If they write in Hindi → respond in Hindi
  - If they write in English → respond in English
- Do NOT switch languages mid-conversation
- Do NOT discuss fees or pricing
- Do NOT promise visa approval
- Once you have all 5 details, call the create_lead tool immediately

After creating the lead, send the confirmation in the customer's language:
- English: "Thank you [name]! Your details have been registered. Our team will contact you within 2 hours regarding your [service] application. For urgent queries, please reply here."
- Arabic: "شكراً لك [name]! تم تسجيل بياناتك. سيتواصل معك فريقنا خلال ساعتين بخصوص طلب تأشيرة [service]. للاستفسارات العاجلة، يرجى الرد هنا."
- Urdu: "شکریہ [name]! آپ کی معلومات درج ہو گئی ہیں۔ ہماری ٹیم 2 گھنٹوں میں آپ کی [service] درخواست کے بارے میں آپ سے رابطہ کرے گی۔ فوری سوالات کے لیے یہاں جواب دیں۔"
- Hindi: "धन्यवाद [name]! आपकी जानकारी दर्ज हो गई है। हमारी टीम 2 घंटे के भीतर आपके [service] आवेदन के बारे में संपर्क करेगी। तत्काल प्रश्नों के लिए यहाँ उत्तर दें।"`;

function getSystemPrompt() {
  return cachedSettings.system_prompt || DEFAULT_SYSTEM_PROMPT;
}

const tools = [
  {
    name: 'create_lead',
    description: 'Register a qualified lead in the CRM once all information is collected',
    input_schema: {
      type: 'object',
      properties: {
        pax_name: { type: 'string', description: 'Full name of the customer' },
        service_name: { type: 'string', description: 'Visa or service they need' },
        travel_date: { type: 'string', description: 'Travel date or approximate timeframe' },
        pax_count: { type: 'number', description: 'Number of travelers' },
        passport_ready: { type: 'boolean', description: 'Whether passport is ready' },
      },
      required: ['pax_name', 'service_name'],
    },
  },
];

// ── Conversation helpers ──────────────────────────────────────────────────────
async function getOrCreateConversation(phone) {
  const { data } = await supabase.from('wa_conversations').select('*').eq('phone', phone).maybeSingle();
  if (data) return data;
  const { data: newConv } = await supabase.from('wa_conversations')
    .insert({ phone, messages: [], stage: 'qualifying' }).select().single();
  return newConv;
}

async function saveConversation(phone, messages, extra = {}) {
  await supabase.from('wa_conversations')
    .update({ messages, updated_at: new Date().toISOString(), ...extra }).eq('phone', phone);
}

// ── Confirmation messages by language ────────────────────────────────────────
function confirmationMessage(name, service, lang) {
  switch (lang) {
    case 'arabic':
      return `شكراً لك ${name}!\n\nتم تسجيل بياناتك بنجاح. سيتواصل معك فريقنا خلال ساعتين بخصوص طلب تأشيرة ${service}.\n\nللاستفسارات العاجلة، يرجى الرد هنا.`;
    case 'urdu':
      return `شکریہ ${name}!\n\nآپ کی معلومات کامیابی سے درج ہو گئی ہیں۔ ہماری ٹیم 2 گھنٹوں میں آپ کی ${service} درخواست کے بارے میں رابطہ کرے گی۔\n\nفوری سوالات کے لیے یہاں جواب دیں۔`;
    case 'hindi':
      return `धन्यवाद ${name}!\n\nआपकी जानकारी सफलतापूर्वक दर्ज हो गई है। हमारी टीम 2 घंटे के भीतर आपके ${service} आवेदन के बारे में संपर्क करेगी।\n\nतत्काल प्रश्नों के लिए यहाँ उत्तर दें।`;
    default:
      return `Thank you ${name}!\n\nYour details have been registered. Our team will contact you within 2 hours regarding your ${service} application.\n\nFor urgent queries, please reply here.`;
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
    model: 'claude-haiku-4-5-20251001',
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
      const notes = [
        input.passport_ready !== undefined ? `Passport ready: ${input.passport_ready ? 'Yes' : 'No'}` : '',
        input.travel_date ? `Travel date: ${input.travel_date}` : '',
      ].filter(Boolean).join(' | ');

      const { data: lead, error: leadErr } = await supabase.from('leads').insert({
        pax_name: input.pax_name,
        phone: `+${phone}`,
        whatsapp: `+${phone}`,
        service_name: input.service_name || '',
        pax_count: Number(input.pax_count) || 1,
        notes: notes || null,
        source: 'WhatsApp',
        status: 'Under Process',
        base_fee: 0, gst_amount: 0, total_amount: 0, amount_paid: 0,
        payment_method: 'Cash',
      }).select().single();

      if (leadErr) console.error(`Lead insert error:`, leadErr.message);

      await saveConversation(phone, [...messages, { role: 'assistant', content: response.content }], {
        lead_id: lead?.id, stage: 'qualified', language: convLang,
      });

      const confirmMsg = confirmationMessage(input.pax_name, input.service_name, convLang);
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
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(startBot, 3000);
      } else {
        setTimeout(startBot, 1000);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe || msg.key.remoteJid?.endsWith('@g.us')) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;
      try { await handleMessage(sock, msg.key.remoteJid, text); }
      catch (err) { console.error('Message error:', err.message); }
    }
  });
}

startBot();
