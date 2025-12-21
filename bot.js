const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Запуск Express сервера ПЕРВЫМ
const app = express();
const port = process.env.PORT || 8080;

// Health check - должен работать всегда
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
    res.json({
        status: 'Server работает!',
        time: new Date().toISOString()
    });
});

// API эндпоинты
app.post('/api/investment', (req, res) => {
    console.log('📥 Получен запрос на инвестицию');
    res.json({ success: true, message: 'API работает' });
});

app.post('/api/connect-telegram', (req, res) => {
    console.log('📥 Получен запрос на подключение Telegram');
    res.json({ success: true, message: 'API работает' });
});

// Запускаем сервер СРАЗУ
app.listen(port, () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`🌐 Health check: http://localhost:${port}/health`);
});

// Бот инициализируем ПОСЛЕ сервера
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;

// Пытаемся запустить бота через 5 секунд
setTimeout(() => {
    try {
        console.log('🔧 Запуск бота...');

        const bot = new TelegramBot(TOKEN, {
            polling: true
        });

        bot.onText(/\/start/, (msg) => {
            bot.sendMessage(msg.chat.id, '👋 Бот работает!');
        });

        bot.on('polling_error', (error) => {
            console.error('❌ Ошибка бота:', error.message);
        });

        console.log('✅ Бот запущен успешно!');

        // Отправляем сообщение админу если получилось
        bot.sendMessage(ADMIN_ID, '🤖 Бот запущен и работает!')
            .catch(err => console.log('⚠️ Не удалось отправить сообщение админу'));

    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error.message);
        console.log('⚠️ Сервер продолжает работать без бота');
    }
}, 5000);

// Обработка ошибок процесса
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});