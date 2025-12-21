const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

// Запуск Express сервера
const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Secret
const API_SECRET = process.env.API_SECRET || 'mySecretKey2024';

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

        // Отправляем уведомление в Telegram
        if (bot && userId && amount) {
            const message = `🎉 *Новая инвестиция!*\n\n` +
                          `Пользователь: ${userName || 'Unknown'}\n` +
                          `Сумма: ${amount} Bs.\n` +
                          `ID: ${userId}`;

            bot.sendMessage(ADMIN_ID, message, { parse_mode: 'Markdown' });
        }

        res.json({ success: true, message: 'Инвестиция создана' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/connect-telegram', verifySecret, async (req, res) => {
    try {
        const { userId, telegramId } = req.body;

        if (bot && telegramId) {
            const message = `✅ *Ваш аккаунт подключен!*\n\n` +
                          `Теперь вы будете получать уведомления.`;

            bot.sendMessage(parseInt(telegramId), message, { parse_mode: 'Markdown' });
        }

        res.json({ success: true, message: 'Telegram подключен' });
    } catch (error) {
        res.status(500).json({ error: 'Error' });
    }
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`🌐 Сервер запущен на порту ${port}`);
});

// Жестко заданные переменные (временное решение)
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
const JSONBIN_BIN_ID = '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';

// Инициализация бота
console.log('🔧 Запуск бота с жестко заданными переменными...');

const bot = new TelegramBot(TOKEN, {
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

bot.onText(/\/api/, (msg) => {
    bot.sendMessage(msg.chat.id, `🌐 API эндпоинты:\n\n` +
        `POST /api/investment\n` +
        `POST /api/connect-telegram\n\n` +
        `Header: X-API-Secret: mySecretKey2024`);
});

console.log('🤖 Бот запущен успешно!');
bot.sendMessage(ADMIN_ID, '🤖 Бот запущен и работает!');