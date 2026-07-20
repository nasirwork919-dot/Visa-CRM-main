const path = require('path');
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

// ── Status state (read by HTTP server) ───────────────────────────────────────
const botState = { connected: false, phone: null, qr: null };

// ── Tiny HTTP API server for the CRM dashboard ───────────────────────────────
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(botState));
}).listen(3001, () => console.log('Bot API listening on http://localhost:3001'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are a friendly visa application assistant for Euro World Global Transit Private Limited. Your job is to qualify leads via WhatsApp by collecting their information naturally.

Collect these details one at a time in a conversational way:
1. Customer's full name
2. Which visa/service they need (e.g., Dubai Tourist Visa, Saudi Umrah Visa, UK Visit Visa, Schengen Visa, etc.)
3. Travel date (approximate is fine)
4. Number of travelers
5. Whether their passport is ready (yes/no)

Rules:
- Ask only ONE question per message
- Be warm, professional, and brief
- Respond in the same language the customer uses (Hindi, Urdu, or English)
- Do NOT discuss fees or pricing
- Do NOT promise visa approval
- Once you have all 5 details, call the create_lead tool immediately

After creating the lead, send this confirmation:
"Thank you [name]! Your details have been registered. Our team will contact you within 2 hours regarding your [service] application. For urgent queries, please reply here."`;

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

async function getOrCreateConversation(phone) {
  const { data } = await supabase.from('wa_conversations').select('*').eq('phone', phone).maybeSingle();
  if (data) return data;
  const { data: newConv } = await supabase.from('wa_conversations').insert({ phone, messages: [], stage: 'qualifying' }).select().single();
  return newConv;
}

async function saveConversation(phone, messages, extra = {}) {
  await supabase.from('wa_conversations').update({ messages, updated_at: new Date().toISOString(), ...extra }).eq('phone', phone);
}

async function handleMessage(sock, from, text) {
  const phone = from.replace(/@.*/, '');
  console.log(`[${phone}] Received: ${text}`);

  console.log(`[${phone}] Loading conversation...`);
  const conv = await getOrCreateConversation(phone);
  if (!conv) {
    console.log(`[${phone}] ERROR: Could not get/create conversation (check SUPABASE_SERVICE_KEY in .env)`);
    return;
  }
  if (conv.lead_id) {
    console.log(`[${phone}] Already a lead (${conv.lead_id}), skipping.`);
    return;
  }

  const messages = [...(conv.messages || []), { role: 'user', content: text }];
  console.log(`[${phone}] Calling Claude (${messages.length} messages in history)...`);

  const response = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
    tools,
  });

  console.log(`[${phone}] Claude responded with ${response.content.length} block(s), stop_reason=${response.stop_reason}`);

  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      console.log(`[${phone}] Sending reply: ${block.text.substring(0, 80)}...`);
      await saveConversation(phone, [...messages, { role: 'assistant', content: block.text }]);
      await sock.sendMessage(from, { text: block.text });
      console.log(`[${phone}] Reply sent.`);

    } else if (block.type === 'tool_use' && block.name === 'create_lead') {
      const input = block.input;
      console.log(`[${phone}] Creating lead:`, JSON.stringify(input));
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
        base_fee: 0,
        gst_amount: 0,
        total_amount: 0,
        amount_paid: 0,
        payment_method: 'Cash',
      }).select().single();

      if (leadErr) console.error(`[${phone}] Lead insert error:`, leadErr.message);

      await saveConversation(phone, [...messages, { role: 'assistant', content: response.content }], {
        lead_id: lead?.id,
        stage: 'qualified',
      });

      const confirmMsg = `Thank you ${input.pax_name}!\n\nYour details have been registered. Our team will contact you within 2 hours regarding your ${input.service_name} application.\n\nFor urgent queries, please reply here.`;
      await sock.sendMessage(from, { text: confirmMsg });
      console.log(`[${phone}] Lead created: ${input.pax_name} - ${input.service_name} (id: ${lead?.id})`);
    }
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));
  const { version } = await fetchLatestBaileysVersion();
  console.log(`Using WA version: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Ubuntu', 'Desktop', '0.0.0'],
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 15000,
    logger: require('pino')({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR code with WhatsApp -> Linked Devices:\n');
      qrcode.generate(qr, { small: true });
      // Store as base64 PNG for the CRM dashboard
      botState.qr = await QRCode.toDataURL(qr);
      botState.connected = false;
      botState.phone = null;
    }
    if (connection === 'open') {
      const phone = sock.user?.id?.replace(/:.*/, '') || null;
      botState.connected = true;
      botState.phone = phone;
      botState.qr = null;
      console.log(`\n✅ WhatsApp connected! Phone: ${phone}. Bot is running.\n`);
    }
    if (connection === 'close') {
      botState.connected = false;
      botState.qr = null;
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'unknown';
      console.log(`Connection closed: ${reason} (code: ${code})`);
      if (code !== DisconnectReason.loggedOut) {
        console.log('Reconnecting in 3s...');
        setTimeout(startBot, 3000);
      } else {
        console.log('Logged out. Delete the auth_info folder and restart.');
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
      if (!text.trim()) continue;
      try {
        await handleMessage(sock, msg.key.remoteJid, text);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
}

startBot();
