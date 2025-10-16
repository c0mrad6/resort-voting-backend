// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

exports.handler = async (event, context) => {
  // CORS Headers
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

    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     event.headers['x-real-ip'] || 'unknown';

    const now = new Date();
    const timestamp = now.toISOString();

    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
  PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
}

    if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
      console.error('Missing env vars:', { SHEET_ID, CLIENT_EMAIL, PRIVATE_KEY: !!PRIVATE_KEY });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Server misconfiguration' }),
      };
    }

    // ✅ Новая авторизация для google-spreadsheet v4+
    const auth = new GoogleAuth({
      credentials: {
        client_email: CLIENT_EMAIL,
        private_key: PRIVATE_KEY,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo();

    const votesSheet = doc.sheetsByTitle['votes'];
    const logSheet = doc.sheetsByTitle['ip_log'];

    if (!votesSheet || !logSheet) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Sheets not found' }),
      };
    }

    const rows = await logSheet.getRows();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const hasVoted = rows.some(row => {
      const rowTime = new Date(row.timestamp);
      return row.ip === clientIP && rowTime > oneDayAgo;
    });

    if (hasVoted) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' }),
      };
    }

    await votesSheet.addRow({
      timestamp,
      email,
      ...nominations
    });

    await logSheet.addRow({
      ip: clientIP,
      timestamp
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Ошибка сервера' }),
    };
  }
};
