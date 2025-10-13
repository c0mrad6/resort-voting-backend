// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { email, nominations } = body;

    // Получаем IP
    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     event.headers['x-real-ip'] || 'unknown';

    const now = new Date();
    const timestamp = now.toISOString();

    // === Настройки Google ===
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

    if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
      return { statusCode: 500, body: 'Google credentials missing' };
    }

    // Подключаемся к таблице
    const doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: CLIENT_EMAIL,
      private_key: PRIVATE_KEY,
    });
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    const logSheet = doc.sheetsByTitle['ip_log'];

    if (!votesSheet || !logSheet) {
      return { statusCode: 500, body: 'Sheets not found' };
    }

    // === Проверка: голосовал ли IP за последние 24 часа? ===
    const rows = await logSheet.getRows();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const hasVoted = rows.some(row => {
      const rowTime = new Date(row.timestamp);
      return row.ip === clientIP && rowTime > oneDayAgo;
    });

    if (hasVoted) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' })
      };
    }

    // === Записываем голос ===
    await votesSheet.addRow({
      timestamp,
      email,
      ...nominations
    });

    // === Логируем IP ===
    await logSheet.addRow({
      ip: clientIP,
      timestamp
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Ошибка сервера' })
    };
  }
};
