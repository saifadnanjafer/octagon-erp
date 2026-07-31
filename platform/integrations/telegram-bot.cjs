'use strict';

// Telegram transport boundary. Secrets are read only from the server process
// environment and are never returned in errors, logs, or persisted payloads.
const API_ROOT = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10000;

function tokenFrom(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  return token || null;
}

function configured(env = process.env) {
  return Boolean(tokenFrom(env));
}

function safeError(message, status = 502) {
  const error = new Error(String(message || 'Telegram request failed').replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]'));
  error.statusCode = status;
  return error;
}

async function callTelegram(method, params = {}, env = process.env) {
  const token = tokenFrom(env);
  if (!token) throw safeError('TELEGRAM_BOT_TOKEN is not configured', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    let payload;
    try { payload = await response.json(); } catch (_) { throw safeError('Telegram returned invalid JSON', response.status); }
    if (!response.ok || payload?.ok !== true) {
      throw safeError(payload?.description || `Telegram HTTP ${response.status}`, response.status || 502);
    }
    return payload.result;
  } catch (error) {
    if (error.name === 'AbortError') throw safeError('Telegram request timed out', 504);
    if (error.statusCode) throw error;
    throw safeError(error.message || 'Telegram request failed', 502);
  } finally {
    clearTimeout(timer);
  }
}

function getMe(env) { return callTelegram('getMe', {}, env); }
function getWebhookInfo(env) { return callTelegram('getWebhookInfo', {}, env); }
function getUpdates(params, env) { return callTelegram('getUpdates', params, env); }
function setWebhook(params, env) { return callTelegram('setWebhook', params, env); }
function deleteWebhook(params, env) { return callTelegram('deleteWebhook', params, env); }
function sendMessage({ chatId, text, parseMode = 'HTML', disableWebPagePreview = true }, env) {
  if (chatId === undefined || chatId === null || !/^-?\d+$/.test(String(chatId))) {
    throw safeError('A numeric Telegram chat id is required', 400);
  }
  const message = String(text || '').trim();
  if (!message) throw safeError('Telegram message text is required', 400);
  return callTelegram('sendMessage', {
    chat_id: String(chatId), text: message, parse_mode: parseMode,
    link_preview_options: { is_disabled: Boolean(disableWebPagePreview) },
  }, env);
}

function allowedChatIds(env = process.env) {
  return String(env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map(value => value.trim())
    .filter(value => /^-?\d+$/.test(value));
}

function isAllowedChatId(chatId, env = process.env) {
  const allowed = allowedChatIds(env);
  return !allowed.length || allowed.includes(String(chatId));
}

function verifyWebhookSecret(headers = {}, env = process.env) {
  const expected = String(env.TELEGRAM_WEBHOOK_SECRET || '');
  const received = String(headers['x-telegram-bot-api-secret-token'] || '');
  if (!expected) return { enforced: false, verified: false, reason: 'TELEGRAM_WEBHOOK_SECRET is not configured' };
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  const verified = a.length === b.length && cryptoTimingSafeEqual(a, b);
  return { enforced: true, verified, reason: verified ? undefined : 'Webhook secret mismatch' };
}

function cryptoTimingSafeEqual(a, b) {
  // Avoid importing the whole server security layer into this small boundary.
  const crypto = require('crypto');
  return crypto.timingSafeEqual(a, b);
}

function extractMessage(update) {
  const message = update?.message || update?.edited_message || update?.channel_post;
  if (!message || !message.chat) return null;
  const from = message.from || {};
  const text = message.text || message.caption || '';
  const media = message.photo?.at(-1) || message.document || message.video || message.audio || message.voice;
  return {
    updateId: Number.isInteger(update.update_id) ? update.update_id : null,
    messageId: message.message_id ?? null,
    chatId: String(message.chat.id),
    chatTitle: message.chat.title || [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') || String(message.chat.id),
    chatType: message.chat.type || 'unknown',
    senderId: from.id ?? null,
    sender: [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram user',
    username: from.username || '',
    text: String(text).slice(0, 10000),
    receivedAt: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
    attachment: media ? { type: media.file_id ? 'media' : 'attachment', fileId: String(media.file_id || '') } : null,
    rawType: message.text ? 'text' : message.caption ? 'caption' : media ? 'media' : 'message',
  };
}

module.exports = {
  allowedChatIds,
  callTelegram,
  configured,
  deleteWebhook,
  extractMessage,
  getMe,
  getUpdates,
  getWebhookInfo,
  isAllowedChatId,
  sendMessage,
  setWebhook,
  verifyWebhookSecret,
};
