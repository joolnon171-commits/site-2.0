console.log('🚀 Starting simple bot for Railway (hardcoded)...');

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors'); // <-- 1. Подключаем пакет

const app = express();
const port = process.env.PORT || 8080;

// --- ДАННЫЕ ВПИСАНЫ ПРЯМО СЮДА ДЛЯ ТЕСТА ---
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
// ---------------------------------------------

if (!TOKEN) {
    console.error('❌ ОШИБКА: TOKEN не указан в коде!');
    process.exit(1);
}

// Создаем бота. { polling: false } — т.к. используем вебхуки
const bot = new TelegramBot(TOKEN, { polling: false });

// 2. Включаем CORS middleware, разрешая запросы с вашего сайта
// Для production лучше указывать конкретный домен, а не '*'
app.use(cors({ origin: 'https://creecly.pythonanywhere.com' }));

// Middleware для JSON
app.use(express.json());

// Эндпоинт для отправки сообщения (для вашего сайта)
app.post('/send-notification', async (req, res) => {
    const { telegramId, text } = req.body;

    if (!telegramId || !text) {
        return res.status(400).json({ error: 'Нужны telegramId и text' });
    }

    try {
        console.log(`Отправка сообщения пользователю ${telegramId}...`);
        await bot.sendMessage(telegramId, text);
        console.log('✅ Сообщение отправлено!');
        res.json({ success: true });

    } catch (error) {
        console.error('❌ Ошибка отправки:', error.response?.body);

        // Если пользователь не нажал /start
        if (error.response?.body?.error_code === 403) {
            return res.status(403).json({
                success: false,
                error: 'FORBIDDEN',
                message: 'Пользователь должен сначала написать боту (/start).'
            });
        }

        res.status(500).json({ success: false, error: 'Что-то пошло не так' });
    }
});

// Эндпоинт для вебхука Telegram
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Обработчик команды /start (самая важная часть!)
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userName = msg.from.first_name || 'друг';
    console.log(`✅ Пользователь ${userName} (ID: ${chatId}) запустил бота!`);
    bot.sendMessage(chatId, `Привет, ${userName}! Теперь я могу отправлять тебе уведомления.`);
});

// Запуск сервера и настройка вебхука
app.listen(port, async () => {
    console.log(`✅ Сервер запущен на порту ${port}`);

    // Railway автоматически предоставляет публичный URL через RAILWAY_PUBLIC_URL
    const railwayUrl = process.env.RAILWAY_PUBLIC_URL;
    if (railwayUrl) {
        const webhookUrl = `https://${railwayUrl}/bot${TOKEN}`;
        console.log(`🔗 Настраиваю вебхук: ${webhookUrl}`);

        try {
            await bot.setWebHook(webhookUrl);
            console.log('✅ Вебхук успешно настроен!');
        } catch (error) {
            console.error('❌ Ошибка настройки вебхука:', error.message);
        }
    } else {
        console.warn('⚠️ RAILWAY_PUBLIC_URL не найден. Вебхук не настроен.');
    }
});