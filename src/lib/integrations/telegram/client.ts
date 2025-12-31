import { config } from '@/lib/config';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
  };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// Send a message via Telegram Bot API
export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<string> {
  const url = `${TELEGRAM_API_BASE}${config.telegram.botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });

  const data: TelegramResponse<TelegramMessage> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
  }

  return String(data.result!.message_id);
}

// Parse an incoming webhook update from Telegram
export function parseTelegramUpdate(body: unknown): {
  chatId: string;
  text: string;
  messageId: number;
  updateId: number;
} | null {
  const update = body as TelegramUpdate;

  if (!update.message?.text || !update.message?.chat?.id) {
    return null;
  }

  return {
    chatId: String(update.message.chat.id),
    text: update.message.text,
    messageId: update.message.message_id,
    updateId: update.update_id,
  };
}

// Set webhook URL (call this during setup)
export async function setTelegramWebhook(webhookUrl: string): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.telegram.botToken}/setWebhook`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: webhookUrl,
    }),
  });

  const data: TelegramResponse<boolean> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to set Telegram webhook: ${data.description || 'Unknown error'}`);
  }
}

// Get webhook info (for debugging)
export async function getTelegramWebhookInfo(): Promise<unknown> {
  const url = `${TELEGRAM_API_BASE}${config.telegram.botToken}/getWebhookInfo`;

  const response = await fetch(url);
  const data = await response.json();

  return data;
}

// Delete webhook (useful for switching to polling mode)
export async function deleteTelegramWebhook(): Promise<void> {
  const url = `${TELEGRAM_API_BASE}${config.telegram.botToken}/deleteWebhook`;

  const response = await fetch(url, {
    method: 'POST',
  });

  const data: TelegramResponse<boolean> = await response.json();

  if (!data.ok) {
    throw new Error(`Failed to delete Telegram webhook: ${data.description || 'Unknown error'}`);
  }
}
