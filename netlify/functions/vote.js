// netlify/functions/vote.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { GoogleAuth } = require('google-auth-library');

exports.handler = async (event, context) => {// netlify/functions/vote.js
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
    // === 1. Парсинг входных данных ===
    let body, email, nominations;
    try {
      body = JSON.parse(event.body);
      email = body.email;
      nominations = body.nominations;
    } catch (e) {
      console.error('❌ Ошибка парсинга JSON:', e.message);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Неверный формат данных' }),
      };
    }

    if (!email || !nominations || Object.keys(nominations).length === 0) {
      console.error('❌ Нет email или номинаций');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Не хватает данных' }),
      };
    }

    // === 2. Получение IP ===
    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 
                     event.headers['x-real-ip'] || 'unknown';
    console.log('📥 IP:', clientIP);

    const now = new Date();
    const timestamp = now.toISOString();

    // === 3. Настройка доступа к Google Таблице ===
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
    let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

    if (PRIVATE_KEY && PRIVATE_KEY.includes('\\n')) {
      PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');
    }

    if (!SHEET_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
      console.error('❌ Не заданы переменные окружения');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Ошибка сервера' }),
      };
    }

    // === 4. Авторизация ===
    let auth, doc;
    try {
      auth = new GoogleAuth({
        credentials: { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      doc = new GoogleSpreadsheet(SHEET_ID, auth);
      await doc.loadInfo();
    } catch (e) {
      console.error('❌ Ошибка авторизации в Google:', e.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Ошибка подключения к таблице' }),
      };
    }

    const votesSheet = doc.sheetsByTitle['votes'];
    const logSheet = doc.sheetsByTitle['ip_log'];

    if (!votesSheet || !logSheet) {
      console.error('❌ Не найдены листы votes или ip_log');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Таблица настроена неверно' }),
      };
    }

    // === 5. Проверка по IP (только последние 100 строк) ===
    let hasVoted = false;
    try {
      const rows = await logSheet.getRows({ limit: 100 }); // ← ограничение!
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

      console.log(`🔍 Проверка IP: ${clientIP}`);
      console.log(`📅 24 часа назад: ${oneDayAgo.toISOString()}`);
      console.log(`📄 Загружено строк из ip_log: ${rows.length}`);

      hasVoted = rows.some(row => {
        const rowTime = new Date(row.timestamp);
        const valid = row.ip === clientIP && !isNaN(rowTime) && rowTime > oneDayAgo;
        if (valid) {
          console.log(`✅ Найден дубль: IP=${row.ip}, время=${row.timestamp}`);
        }
        return valid;
      });
    } catch (e) {
      console.error('⚠️ Не удалось проверить IP:', e.message);
      // Не блокируем — продолжаем без защиты
    }

    if (hasVoted) {
      console.log('🚫 Отказано: уже голосовал');
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' }),
      };
    }

    // === 6. Запись голоса ===
    try {
      await votesSheet.addRow({
        timestamp,
        email,
        ...nominations
      });
      console.log('✅ Голос записан в votes');
    } catch (e) {
      console.error('❌ Ошибка записи голоса:', e.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Не удалось сохранить голос' }),
      };
    }

    // === 7. Логирование IP ===
    try {
      await logSheet.addRow({
        ip: clientIP,
        timestamp
      });
      console.log('📝 IP залогирован в ip_log');
    } catch (e) {
      console.error('⚠️ Не удалось записать IP:', e.message);
      // Не критично
    }

    // === 8. Успех ===
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Ваш голос учтён!' }),
    };

  } catch (error) {
    console.error('💥 Необработанная ошибка:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Ошибка сервера' }),
    };
  }
};

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
    // === Парсинг данных ===
    const body = JSON.parse(event.body);
    const { email, nominations } = body;
    if (!email || !nominations) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Нет email или номинаций' }) };
    }

    const clientIP = event.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
    const now = new Date();
    const timestamp = now.toISOString();

    // === Настройка Google ===
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
    const logSheet = doc.sheetsByTitle['ip_log'];

    if (!votesSheet || !logSheet) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Листы не найдены' }) };
    }

    // === 1. Сначала записываем IP в лог ===
    await logSheet.addRow({ ip: clientIP, timestamp });

    // === 2. Читаем ВСЕ записи с этим IP за 24 часа ===
    const allRows = await logSheet.getRows({ limit: 500 });
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const recentRows = allRows.filter(row => {
      const rowTime = new Date(row.timestamp);
      return row.ip === clientIP && !isNaN(rowTime) && rowTime > oneDayAgo;
    });

    // === 3. Если больше одной записи — это дубль ===
    if (recentRows.length > 1) {
      // Удаляем дубль из ip_log
      await recentRows[recentRows.length - 1].delete();
      console.log('🚫 Обнаружен дубль по IP:', clientIP);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Вы уже голосовали в последние 24 часа.' })
      };
    }

    // === 4. Записываем голос ===
    await votesSheet.addRow({ timestamp, email, ...nominations });

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
