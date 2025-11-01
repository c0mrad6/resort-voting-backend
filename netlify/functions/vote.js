// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');
const { Redis } = require('@upstash/redis'); // ← ДОБАВЛЕНО: Redis клиент

// In-memory кэш как fallback на случай ошибок Redis или cold start
const ipVoteCache = new Map();

// ← ДОБАВЛЕНО: Инициализация Redis из переменных окружения
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

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

    // ← ИЗМЕНЕНО: Проверка дублей сначала через Redis, fallback на in-memory
    const nominationKeys = Object.keys(nominations);
    for (const nomination of nominationKeys) {
      const voteKey = `${clientIP}:${nomination}`;

      let isDuplicate = false;
      try {
        // Проверяем в Redis
        isDuplicate = await redis.exists(voteKey);
      } catch (err) {
        // Если Redis недоступен — используем in-memory кэш
        console.warn('Redis error, falling back to memory cache', err);
        const lastVote = ipVoteCache.get(voteKey);
        isDuplicate = lastVote && (now - lastVote < 24 * 60 * 60 * 1000);
      }

      if (isDuplicate) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: `Вы уже голосовали в номинации ${nomination}` }) };
      }
    }

    // Запись в таблицу (без изменений)
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
      PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    // ← ИСПРАВЛЕНО: убраны лишние пробелы в scopes
    const auth = new GoogleAuth({
      credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    if (!votesSheet) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Лист не найден' }) };

    await votesSheet.addRow({
      timestamp: new Date().toISOString(),
      email,
      ip: clientIP,
      ...nominations
    });

    // ← ДОБАВЛЕНО: Запись в Redis + in-memory кэш
    for (const nomination of nominationKeys) {
      const key = `${clientIP}:${nomination}`;
      // В in-memory кэш
      ipVoteCache.set(key, now);
      // В Redis с TTL 24 часа
      try {
        await redis.set(key, '1', { ex: 86400 });
      } catch (err) {
        console.warn('Failed to write to Redis', err);
        // Fallback: данные уже в памяти
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }) };

  } catch (error) {
    console.error('Ошибка:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Ошибка сервера' }) };
  }
};
