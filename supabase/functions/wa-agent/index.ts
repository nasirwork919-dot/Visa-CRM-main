import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SB_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLAUDE_API_KEY = Deno.env.get('CLAUDE_API_KEY')!;
const WAHA_URL = Deno.env.get('WAHA_URL')!;         // https://your-app.railway.app
const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;  // VisaCRM2024SecretKey

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const claude = new Anthropic({ apiKey: CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are a friendly visa application assistant for Euro World Global Transit Private Limited. Your job is to qualify leads via WhatsApp by collecting their information naturally.

Collect these details one at a time in a conversational way:
1. Customer's full name
2. Which visa/service they need (e.g., Dubai Tourist Visa, Saudi Umrah Visa, UK Visit Visa, Schengen Visa, etc.)
3. Travel date (approximate is fine, e.g., "next month" is ok)
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
"Thank you [name]! ✅ Your details have been registered. Our team will contact you within 2 hours regarding your [service] application. For urgent queries, please reply here."`;

const tools: Anthropic.Tool[] = [
  {
    name: 'create_lead',
    description: 'Register a qualified lead in the CRM once all information is collected',
    input_schema: {
      type: 'object' as const,
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

async function sendWAMessage(chatId: string, text: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY,
      },
      body: JSON.stringify({ chatId, text, session: 'default' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const body = await res.text();
    console.log(`sendWAMessage status=${res.status} body=${body}`);
    return body;
  } catch (err) {
    console.error('sendWAMessage failed:', err);
    return null;
  }
}

async function getOrCreateConversation(phone: string) {
  const { data } = await supabase
    .from('wa_conversations')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (data) return data;

  const { data: newConv } = await supabase
    .from('wa_conversations')
    .insert({ phone, messages: [], stage: 'qualifying' })
    .select()
    .single();

  return newConv;
}

async function saveConversation(phone: string, messages: any[], extra: any = {}) {
  await supabase
    .from('wa_conversations')
    .update({ messages, updated_at: new Date().toISOString(), ...extra })
    .eq('phone', phone);
}

serve(async (req) => {
  try {
    // WAHA sends GET for webhook verification
    if (req.method === 'GET') {
      return new Response('OK', { status: 200 });
    }

    const body = await req.json();

    // Only handle incoming messages (not sent by us, not status updates)
    if (body.event !== 'message' || body.payload?.fromMe) {
      return new Response('ok', { status: 200 });
    }

    const payload = body.payload;
    const chatId: string = payload.from; // e.g. "919876543210@c.us"
    const phone = chatId.replace(/@.*/, '');
    const messageText: string = payload.body || '';

    if (!messageText.trim()) {
      return new Response('ok', { status: 200 });
    }

    // Load conversation
    const conv = await getOrCreateConversation(phone);

    if (!conv) {
      return new Response('ok', { status: 200 });
    }

    // Stop if lead already created
    if (conv.lead_id) {
      return new Response('ok', { status: 200 });
    }

    // Append incoming message
    const messages: Anthropic.MessageParam[] = [
      ...(conv.messages || []),
      { role: 'user', content: messageText },
    ];

    // Ask Claude
    const response = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',  // fast + cheap for chat
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages,
      tools,
    });

    let replyText = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        replyText = block.text;
      } else if (block.type === 'tool_use' && block.name === 'create_lead') {
        const input = block.input as any;
        const notes = [
          input.passport_ready !== undefined
            ? `Passport ready: ${input.passport_ready ? 'Yes' : 'No'}`
            : '',
          input.travel_date ? `Travel date: ${input.travel_date}` : '',
        ].filter(Boolean).join(' | ');

        // Insert lead into CRM
        const { data: lead } = await supabase
          .from('leads')
          .insert({
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
          })
          .select()
          .single();

        // Mark conversation as done
        await saveConversation(phone, [
          ...messages,
          { role: 'assistant', content: response.content },
        ], { lead_id: lead?.id, stage: 'qualified' });

        // Confirmation message
        const confirmMsg = `Thank you ${input.pax_name}! ✅\n\nYour details have been registered. Our team will contact you within 2 hours regarding your *${input.service_name}* application.\n\nFor urgent queries, please reply here.`;
        await sendWAMessage(chatId, confirmMsg);

        return new Response('ok', { status: 200 });
      }
    }

    // Save conversation + send Claude's reply
    if (replyText) {
      await saveConversation(phone, [
        ...messages,
        { role: 'assistant', content: replyText },
      ]);
      await sendWAMessage(chatId, replyText);
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('wa-agent error:', err);
    return new Response('error', { status: 500 });
  }
});
