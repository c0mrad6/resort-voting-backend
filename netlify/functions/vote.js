// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

// Простой in-memory кэш (работает ~10 минут в Netlify)
const ipCache = new Map();

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
    const { email, nominations } = body;
    if (!email || !nominations) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Нет email или номинаций' }) };

    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    
    // === 🔒 Защита по IP через in-memory кэш ===
    const now = Date.now();
    const lastVote = ipCache.get(clientIP);
    if (lastVote && now - lastVote < 24 * 60 * 60 * 1000) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' }) };
    }
    ipCache.set(clientIP, now);

    // === Запись в Google Таблицу ===
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');

    const auth = new GoogleAuth({ credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY }, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    if (!votesSheet) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Лист не найден' }) };

    await votesSheet.addRow({ timestamp: new Date().toISOString(), email, ip: clientIP, ...nominations });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }) };

  } catch (error) {
    console.error('Ошибка:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Ошибка сервера' }) };
  }
};
