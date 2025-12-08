import { config } from '../config.js';

const WA_BASE_URL = 'https://graph.facebook.com/v21.0';

/**
 * Lähettää tekstiviestin WhatsApp Cloud API:n kautta.
 * - käyttää WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN -env-muuttujia
 * - jos tunnukset puuttuvat, ei heitä virhettä vaan vain logittaa ja palaa
 */
export async function sendTextMessage(to, text) {
  const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = config.WHATSAPP_ACCESS_TOKEN;

  // Jos ei ole vielä asetettu oikeita tunnuksia → ei yritetä kutsua API:a
  if (!phoneNumberId || !accessToken) {
    console.warn('[WhatsApp] Credentials missing; skipping send');
    console.log(`[WhatsApp] Would send message to ${to}: ${text}`);
    return;
  }

  const url = `${WA_BASE_URL}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: String(to),
    type: 'text',
    text: {
      body: String(text ?? ''),
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error(
        '[WhatsApp] sendTextMessage failed:',
        res.status,
        res.statusText,
        bodyText,
      );
      return;
    }

    const data = await res.json().catch(() => null);
    const msgId = data?.messages?.[0]?.id;
    console.log('[WhatsApp] Message sent OK', msgId ? `id=${msgId}` : '');
  } catch (err) {
    console.error('[WhatsApp] sendTextMessage error:', err?.message || err);
  }
}
