// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

// Только основная защита
const ipVoteCache = new Map(); // 24 часа

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

    // Honeypot
    if (body.website) return { statusCode: 200, headers, body: '{}' };

    // Валидация
    const { email, nominations } = body;
    if (!email || !email.includes('@') || !nominations || Object.keys(nominations).length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Нет email или номинаций' }) };
    }

    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    const now = Date.now();

    // Проверка КАЖДОЙ номинации на дубль
    const nominationKeys = Object.keys(nominations);
    for (const nomination of nominationKeys) {
      const voteKey = `${clientIP}:${nomination}`;
      const lastVote = ipVoteCache.get(voteKey);
      if (lastVote && now - lastVote < 24 * 60 * 60 * 1000) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: `Вы уже голосовали в "${nomination}"` }) };
      }
    }

    // Запись в таблицу
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
      PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    const auth = new GoogleAuth({ credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    if (!votesSheet) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Лист не найден' }) };

    await votesSheet.addRow({
      timestamp: new Date().toISOString(),
      email,
      ip: clientIP,
      ...nominations // ← заполняет ТОЛЬКО указанные столбцы
    });

    // Сохраняем в кэш
    for (const nomination of nominationKeys) {
      ipVoteCache.set(`${clientIP}:${nomination}`, now);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }) };

  } catch (error) {
    console.error('Ошибка:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Ошибка сервера' }) };
  }
};
