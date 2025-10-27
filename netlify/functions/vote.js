// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

// In-memory кэш
const ipVoteCache = new Map(); // 24 часа
const ipRateCache = new Map(); // 2 секунды

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body = JSON.parse(event.body);

    // === 1. Honeypot ===
    if (body.website) {
      console.log('🤖 Honeypot сработал');
      return { statusCode: 200, headers, body: '{}' };
    }

    // === 2. Валидация email ===
    const { email, nominations } = body;
    if (!email || !email.includes('@') || !nominations) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Неверный email или нет номинаций' }) };
    }

    // === 3. IP ===
    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    const now = Date.now();

    // === 4. Определяем номинацию (поддерживаем только одну за раз) ===
const nominationKeys = Object.keys(nominations);
if (nominationKeys.length !== 1) {
  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Только одна номинация за раз' }) };
}
const nomination = nominationKeys[0]; // например, 'best_spa'

// === 5. Rate limiting: 1 запрос в 2 секунды ПО НОМИНАЦИИ ===
const rateKey = `${clientIP}:${nomination}`;
const lastRequest = ipRateCache.get(rateKey);
if (lastRequest && now - lastRequest < 2000) {
  return { statusCode: 429, headers, body: JSON.stringify({ error: 'Подождите 2 секунды в этой номинации' }) };
}
ipRateCache.set(rateKey, now);

// === 6. Защита: 1 голос в 24 часа ПО НОМИНАЦИИ ===
const voteKey = `${clientIP}:${nomination}`;
const lastVote = ipVoteCache.get(voteKey);
if (lastVote && now - lastVote < 24 * 60 * 60 * 1000) {
  return { statusCode: 403, headers, body: JSON.stringify({ error: `Вы уже голосовали в номинации "${nomination}" за последние 24 часа.` }) };
}

    // === 7. Запись в Google Таблицу ===
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
      PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    const auth = new GoogleAuth({
      credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    if (!votesSheet) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Лист votes не найден' }) };
    }

    await votesSheet.addRow({
      timestamp: new Date().toISOString(),
      email,
      ip: clientIP,
      ...nominations,
    });

    ipVoteCache.set(voteKey, now);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }) };

  } catch (error) {
    console.error('Ошибка:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Ошибка сервера' }) };
  }
};
