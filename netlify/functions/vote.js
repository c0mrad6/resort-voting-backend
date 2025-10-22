// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, nominations } = body;
    if (!email || !nominations) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Нет email или номинаций' }) };
    }

    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    const now = new Date();
    const timestamp = now.toISOString();

    // === Google Auth ===
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

    // === Читаем последние 200 голосов ===
    const rows = await votesSheet.getRows({ limit: 200 });
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const hasVoted = rows.some(row => {
      const rowTime = new Date(row.timestamp);
      return row.ip === clientIP && !isNaN(rowTime) && rowTime > oneDayAgo;
    });

    if (hasVoted) {
      console.log('🚫 Отказано по IP:', clientIP);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' })
      };
    }

    // === Записываем голос с IP ===
    await votesSheet.addRow({
      timestamp,
      email,
      ip: clientIP, // ← добавляем IP в votes
      ...nominations
    });

    console.log('✅ Голос записан с IP:', clientIP);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }),
    };

  } catch (error) {
    console.error('Ошибка:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Ошибка сервера' }),
    };
  }
};
