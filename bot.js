const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

// Запуск Express сервера СРАЗУ
const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Secret
const API_SECRET = process.env.API_SECRET || 'your-secret-key-here';

function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// API эндпоинты
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        const { userId, amount, userName } = req.body;
        res.json({ success: true, message: 'API работает' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/connect-telegram', verifySecret, async (req, res) => {
    try {
        const { userId, telegramId } = req.body;
        res.json({ success: true, message: 'API работает' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`🌐 Сервер запущен на порту ${port}`);
});

// Конфигурация БЕЗ dotenv
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TOKEN;
const ADMIN_ID = process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID) : null;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;

// Глобальные переменные
let bot = null;
let database = {
    users: {},
    settings: {
        minInvestment: 10,
        maxInvestment: 50000,
        profitRate: 32.58,
        investmentDuration: 4
    },
    stats: {
        totalUsers: 0,
        totalInvested: 0,
        totalProfits: 0,
        lastUpdate: new Date().toISOString()
    }
};

// Запуск бота только если есть все переменные
if (TOKEN && ADMIN_ID && JSONBIN_BIN_ID && JSONBIN_MASTER_KEY) {
    console.log('✅ Переменные найдены, запускаем бота...');

    bot = new TelegramBot(TOKEN, {
        polling: true
    });

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const username = msg.from.username || msg.from.first_name || 'Пользователь';

        bot.sendMessage(chatId, `👋 Привет, ${username}! Бот работает!`);
    });

    bot.onText(/\/test/, (msg) => {
        bot.sendMessage(msg.chat.id, '✅ Бот отвечает на команды!');
    });

    console.log('🤖 Бот запущен успешно!');

    if (ADMIN_ID) {
        bot.sendMessage(ADMIN_ID, '🤖 Бот запущен и работает!');
    }

} else {
    console.log('⚠️ Бот не запущен - отсутствуют переменные');
    console.log('Нужные переменные:', {
        TELEGRAM_BOT_TOKEN: !!TOKEN,
        ADMIN_ID: !!ADMIN_ID,
        JSONBIN_BIN_ID: !!JSONBIN_BIN_ID,
        JSONBIN_MASTER_KEY: !!JSONBIN_MASTER_KEY
    });
}

// Для отладки - выводим все переменные
console.log('Все переменные окружения:', {
    PORT: process.env.PORT,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? '***' : 'NOT SET',
    ADMIN_ID: process.env.ADMIN_ID,
    JSONBIN_BIN_ID: process.env.JSONBIN_BIN_ID ? '***' : 'NOT SET',
    JSONBIN_MASTER_KEY: process.env.JSONBIN_MASTER_KEY ? '***' : 'NOT SET',
    API_SECRET: process.env.API_SECRET ? '***' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV
});