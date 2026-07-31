import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const telegram = require('../../platform/integrations/telegram-bot.cjs');

test('Telegram update normalization contains no credential fields', () => {
  const message = telegram.extractMessage({
    update_id: 42,
    message: {
      message_id: 9,
      date: 1700000000,
      text: 'hello',
      chat: { id: -10042, type: 'group', title: 'Workshop' },
      from: { id: 7, first_name: 'User', username: 'workshop_user' },
    },
  });
  assert.equal(message.chatId, '-10042');
  assert.equal(message.text, 'hello');
  assert.equal(Object.hasOwn(message, 'token'), false);
  assert.equal(Object.hasOwn(message, 'botToken'), false);
});

test('Telegram webhook secret fails closed and compares correctly', () => {
  assert.equal(telegram.verifyWebhookSecret({}, {}).enforced, false);
  const env = { TELEGRAM_WEBHOOK_SECRET: 'secret-value' };
  assert.equal(telegram.verifyWebhookSecret({ 'x-telegram-bot-api-secret-token': 'wrong' }, env).verified, false);
  assert.equal(telegram.verifyWebhookSecret({ 'x-telegram-bot-api-secret-token': 'secret-value' }, env).verified, true);
});

test('Telegram allowed-chat filter is empty-open only when not configured', () => {
  assert.equal(telegram.isAllowedChatId('123', {}), true);
  assert.equal(telegram.isAllowedChatId('123', { TELEGRAM_ALLOWED_CHAT_IDS: '456,789' }), false);
  assert.equal(telegram.isAllowedChatId('456', { TELEGRAM_ALLOWED_CHAT_IDS: '456,789' }), true);
});
