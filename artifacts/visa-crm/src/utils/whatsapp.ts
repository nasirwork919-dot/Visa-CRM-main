import { calcGST, formatINR } from './gst';
import { loadSettings } from '@/hooks/use-settings';

const BOT_API = (import.meta.env.VITE_WA_BOT_URL as string) || 'http://localhost:3001';

/** Substitute {name}, {service}, {fee}, {gst}, {net}, {paid}, {balance} in a template */
function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function buildWAPayload(lead: any, messageType: string, extraVars?: Record<string, string>): { phone: string; message: string } | null {
  if (!lead.whatsapp && !lead.phone) return null;

  const phone = lead.whatsapp || lead.phone;
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.slice(1);
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

  const settings = loadSettings();
  const { serviceGST, bankGST, totalGST, totalAmount, netFee } = calcGST(
    lead.base_fee || 0,
    lead.payment_method,
    settings.serviceGSTRate,
    settings.bankGSTRate,
  );
  const balance = Math.max(0, totalAmount - (lead.amount_paid || 0));
  const isCash = !lead.payment_method || lead.payment_method === 'Cash';

  const gstDetail = isCash
    ? formatINR(serviceGST)
    : `${formatINR(serviceGST)} (svc) + ${formatINR(bankGST)} (bank) = ${formatINR(totalGST)}`;

  const vars: Record<string, string> = {
    name: lead.pax_name || '',
    service: lead.service_name || '',
    status: lead.status || '',
    fee: formatINR(totalAmount),
    gst: gstDetail,
    net: formatINR(netFee),
    paid: formatINR(lead.amount_paid || 0),
    balance: formatINR(balance),
    ...extraVars,
  };

  const tpl = settings.messages;

  let templateKey: keyof typeof tpl;
  switch (messageType) {
    case 'welcome':           templateKey = 'welcome'; break;
    case 'payment_received':  templateKey = 'payment_received'; break;
    case 'payment_reminder':  templateKey = 'payment_reminder'; break;
    case 'completed':         templateKey = 'completed'; break;
    case 'status_update':
      switch (lead.status) {
        case 'Under Process': templateKey = 'under_process'; break;
        case 'Follow-up':     templateKey = 'under_process'; break;
        case 'Submitted':     templateKey = 'submitted'; break;
        case 'Completed':     templateKey = 'completed'; break;
        case 'Cancelled':     templateKey = 'cancelled'; break;
        default:              templateKey = 'under_process';
      }
      break;
    default: templateKey = 'welcome';
  }

  return { phone: cleanPhone, message: applyTemplate(tpl[templateKey], vars) };
}

export function buildWAUrl(lead: any, messageType: string, extraVars?: Record<string, string>) {
  const payload = buildWAPayload(lead, messageType, extraVars);
  if (!payload) return '#';
  return `https://wa.me/${payload.phone}?text=${encodeURIComponent(payload.message)}`;
}

/** Send via the connected bot. Returns true if sent, false if bot unavailable (caller should fallback). */
async function sendViaBot(phone: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`${BOT_API}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function openWhatsApp(lead: any, messageType: string, extraVars?: Record<string, string>): Promise<void> {
  const payload = buildWAPayload(lead, messageType, extraVars);
  if (!payload) return;

  const sent = await sendViaBot(payload.phone, payload.message);
  if (!sent) {
    // Bot offline or failed — open WhatsApp web as fallback
    window.open(`https://wa.me/${payload.phone}?text=${encodeURIComponent(payload.message)}`, '_blank');
  }
}
