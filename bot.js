const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
require('dotenv').config();

// Конфигурация
const BOT_API_URL = process.env.BOT_API_URL || 'https://site-2.0.railway.app/api/investment-created';
const BOT_WELCOME_API_URL = process.env.BOT_WELCOME_API_URL || 'https://site-2.0.railway.app/api/user-registered';
const BOT_HEALTH_API_URL = process.env.BOT_HEALTH_API_URL || 'https://site-2.0.railway.app/api/health';
const BOT_TOKEN = process.env.BOT_TOKEN;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Параметры
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000;
const MAX_PROFIT_PERCENTAGE = 3258;

// Инициализация Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Открыто для всех для удобства тестов, в проде ограничьте
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Инициализация бота в режиме вебхуков
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${WEBHOOK_URL}/${BOT_TOKEN}`);

// Кэш уведомлений
const sentNotificationsCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С БД ====================

async function loadDatabase() {
    try {
        const response = await axios.get(JSONBIN_URL, {
            headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
        });
        return response.data.record || { users: {}, settings: { admins: ['Admin'] } };
    } catch (error) {
        console.error('❌ Ошибка загрузки БД:', error.message);
        return { users: {}, settings: { admins: ['Admin'] } };
    }
}

async function saveDatabase(database) {
    try {
        await axios.put(
            `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
            database,
            { headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_MASTER_KEY } }
        );
        return true;
    } catch (error) {
        console.error('❌ Ошибка сохранения БД:', error.message);
        return false;
    }
}

async function sendNotification(chatId, message) {
    try {
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
        console.log(`📨 Отправлено ${chatId}`);
        return true;
    } catch (error) {
        console.error(`❌ Ошибка отправки ${chatId}:`, error.message);
        return false;
    }
}

// ==================== API ДЛЯ САЙТА ====================

// 1. Конечная точка для создания инвестиций
app.post('/api/investment-created', async (req, res) => {
    console.log('📥 Получен запрос от сайта:', req.body);

    try {
        const { userId, telegramId, userName, amount, investmentId } = req.body;

        if (!telegramId || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Faltan datos: telegramId y amount son requeridos'
            });
        }

        const message = `🎉 *¡NUEVA INVERSIÓN CREADA!*\n\n` +
                       `*Usuario:* ${userName || 'Inversor'}\n` +
                       `*Monto:* Bs. ${parseFloat(amount).toFixed(2)}\n` +
                       `*Retorno máximo:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                       `*Duración:* 4 horas\n\n` +
                       `¡Tu dinero ya está creciendo! 🚀\n` +
                       `Recibirás actualizaciones cada 2 horas.` +
                       `Support- @Suports_Investment`;

        const sent = await sendNotification(telegramId, message);

        if (ADMIN_TELEGRAM_ID && ADMIN_TELEGRAM_ID !== telegramId) {
            const adminMsg = `📊 *Nueva inversión*\n\n` +
                           `Usuario: ${userName || 'Nuevo'}\n` +
                           `Monto: Bs. ${parseFloat(amount).toFixed(2)}\n` +
                           `Hora: ${new Date().toLocaleString('es-ES')}`;
            await sendNotification(ADMIN_TELEGRAM_ID, adminMsg);
        }

        res.json({
            success: true,
            message: 'Notificación enviada correctamente',
            notificationSent: sent
        });

    } catch (error) {
        console.error('❌ Error en investment-created:', error);
        res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// 2. Регистрация нового пользователя
app.post('/api/user-registered', async (req, res) => {
    try {
        const { telegramId, userName } = req.body;

        const message = `👋 *¡BIENVENIDO A INVERSIONES BOLIVIA, ${userName}!*\n\n` +
                       `Tu cuenta ha sido creada exitosamente.\n\n` +
                       `*Ahora puedes:*\n` +
                       `• Crear inversiones\n` +
                       `• Seguir el crecimiento en tiempo real\n` +
                       `• Recibir notificaciones automáticas\n\n` +
                       `¡Comienza tu camino al éxito! 🚀` +
                       `Support- @Suports_Investment`;

        const sent = await sendNotification(telegramId, message);

        res.json({
            success: true,
            message: 'Mensaje de bienvenida enviado',
            notificationSent: sent
        });

    } catch (error) {
        console.error('❌ Error en user-registered:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Статус здоровья API
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Inversiones Bolivia Bot',
        timestamp: new Date().toISOString(),
        webhook: WEBHOOK_URL ? 'configured' : 'not configured',
        cacheSize: sentNotificationsCache.size
    });
});

// ==================== НОВЫЕ API ДЛЯ АДМИН-ПАНЕЛИ ====================

// Middleware для проверки супер-админа
const checkSuperAdmin = (req, res, next) => {
    const adminId = req.body.adminId || req.query.adminId;
    if (adminId !== ADMIN_TELEGRAM_ID) {
        return res.status(403).json({ success: false, error: 'Acceso denegado' });
    }
    next();
};

// Массовая рассылка
app.post('/api/admin/broadcast', checkSuperAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Mensaje vacío' });

        const database = await loadDatabase();
        const users = Object.values(database.users);
        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            if (user.telegramId) {
                try {
                    await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                    successCount++;
                    // Небольшая задержка, чтобы не забанить за спам
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (e) {
                    console.error(`Error sending to ${user.telegramId}:`, e.message);
                    failCount++;
                }
            }
        }

        res.json({
            success: true,
            message: `Рассылка завершена. Успешно: ${successCount}, Ошибок: ${failCount}`
        });

    } catch (error) {
        console.error('❌ Error en broadcast:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Назначение/Снятие админа
app.post('/api/admin/toggle-admin', checkSuperAdmin, async (req, res) => {
    try {
        const { targetTelegramId, action } = req.body; // action: 'assign' or 'remove'

        if (!targetTelegramId || !action) {
            return res.status(400).json({ success: false, error: 'Faltan datos' });
        }

        const database = await loadDatabase();
        let targetUser = null;

        // Ищем пользователя по telegramId
        for (const key in database.users) {
            if (database.users[key].telegramId == targetTelegramId) {
                targetUser = database.users[key];
                break;
            }
        }

        if (!targetUser) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        }

        targetUser.isAdmin = (action === 'assign');
        await saveDatabase(database);

        // Отправляем уведомление пользователю
        let notifyMsg = '';
        if (action === 'assign') {
            notifyMsg = `👑 *¡FELICIDADES!*\n\n` +
                        `Has sido promovido a **ADMINISTRADOR** de Inversiones Bolivia.\n` +
                        `Ahora tienes acceso a funciones especiales en el panel.`;
        } else {
            notifyMsg = `⚠️ *AVISO IMPORTANTE*\n\n` +
                        `Tus privilegios de **ADMINISTRADOR** han sido revocados.`;
        }

        await bot.sendMessage(targetTelegramId, notifyMsg, { parse_mode: 'Markdown' });

        res.json({
            success: true,
            message: `Estatus de admin actualizado para ${targetUser.name}`,
            user: targetUser.name
        });

    } catch (error) {
        console.error('❌ Error en toggle-admin:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Управление ботом (Очистка кэша)
app.post('/api/admin/bot-control', checkSuperAdmin, async (req, res) => {
    try {
        const { action } = req.body; // 'clear-cache'

        if (action === 'clear-cache') {
            sentNotificationsCache.clear();
            console.log('🧹 Cache cleared by admin');
            return res.json({ success: true, message: 'Кэш уведомлений очищен' });
        }

        res.status(400).json({ success: false, error: 'Unknown action' });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ВЕБХУК TELEGRAM ====================

app.post(`/bot-webhook/${BOT_TOKEN}`, (req, res) => {
    const update = req.body;
    bot.processUpdate(update);
    res.sendStatus(200);
});

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Usuario';
    const response = `🤖 *BOT DE INVERSIONES BOLIVIA*\n\n` +
                    `Hola ${firstName}, soy el sistema de notificaciones.\n\n` +
                    `*Recibirás automáticamente:*\n` +
                    `• 🎉 Confirmación de inversiones\n` +
                    `• 📈 Actualizaciones cada 2 horas\n` +
                    `• 🏆 Notificación de finalización\n\n` +
                    `Para crear inversiones, visita nuestra web.` +
                    `Support- @Suports_Investment`;
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const response = `📋 *AYUDA*\n\n` +
                    `Este bot envía notificaciones automáticas sobre tus inversiones.\n\n` +
                    `*Comandos disponibles:*\n` +
                    `/start - Mensaje de bienvenida\n` +
                    `/status - Ver estado de notificaciones\n` +
                    `/help - Esta ayuda\n\n` +
                    `Las inversiones se crean desde la web oficial.`;
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const db = await loadDatabase();
    const user = Object.values(db.users).find(u => u.telegramId == chatId);

    let response = `📊 *ESTADO DEL SISTEMA*\n\n`;
    response += `*Bot:* Activo ✅\n`;
    response += `*Hora:* ${new Date().toLocaleString('es-ES')}\n`;
    response += `*Notificaciones en cache:* ${sentNotificationsCache.size}\n\n`;

    if (user) {
        response += `*Tu usuario:* ${user.name}\n`;
        response += `*Admin:* ${user.isAdmin ? 'Sí 👑' : 'No'}\n`;
    } else {
        response += `*No estás registrado en el sistema.*\n`;
    }

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// ==================== АВТОМАТИЧЕСКИЕ ПРОВЕРКИ ====================

async function checkInvestmentProgress() {
    console.log('⏰ Ejecutando chequeo de inversiones...');

    try {
        const database = await loadDatabase();
        const users = database.users;
        let notificationsSent = 0;

        for (const userId in users) {
            const user = users[userId];

            if (!user.telegramId || !user.investments) continue;

            for (const investment of user.investments) {
                if (!investment.notifications) {
                    investment.notifications = {
                        purchase: false,
                        twoHours: false,
                        completed: false
                    };
                }

                const now = Date.now();
                const startTime = new Date(investment.startDate).getTime();
                const elapsed = now - startTime;
                const hoursElapsed = elapsed / (1000 * 60 * 60);
                const isCompleted = elapsed >= INVESTMENT_DURATION;

                if (!investment.notifications.twoHours && hoursElapsed >= 2 && !isCompleted) {
                    const profit = calculateCurrentProfit(investment);
                    const message = `📈 *¡CRECIMIENTO DETECTADO!*\n\n` +
                                   `Han pasado 2 horas de tu inversión.\n` +
                                   `*Crecimiento actual:* +${profit.toFixed(1)}%\n` +
                                   `*Ganancia:* Bs. ${(investment.amount * profit / 100).toFixed(2)}\n\n` +
                                   `¡Sigue creciendo! 💰` +
                                   `Support- @Suports_Investment`;
                    await sendNotification(user.telegramId, message);
                    investment.notifications.twoHours = true;
                    notificationsSent++;
                }

                if (!investment.notifications.completed && isCompleted) {
                    const finalProfit = investment.amount * MAX_PROFIT_PERCENTAGE / 100;
                    const total = investment.amount + finalProfit;
                    const message = `🏆 *¡INVERSIÓN COMPLETADA!*\n\n` +
                                   `*Inversión:* Bs. ${investment.amount.toFixed(2)}\n` +
                                   `*Ganancia:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                                   `*Total:* Bs. ${total.toFixed(2)}\n\n` +
                                   `⚠️ *¡CONTACTA AL ADMINISTRADOR PARA RETIRAR!*` +
                                   `Support- @Suports_Investment`;
                    await sendNotification(user.telegramId, message);
                    investment.notifications.completed = true;
                    notificationsSent++;
                }
            }
        }

        if (notificationsSent > 0) {
            await saveDatabase(database);
            console.log(`✅ ${notificationsSent} notificaciones enviadas`);
        }

    } catch (error) {
        console.error('❌ Error en checkInvestmentProgress:', error.message);
    }
}

function calculateCurrentProfit(investment) {
    const now = Date.now();
    const startTime = new Date(investment.startDate).getTime();
    const elapsed = now - startTime;

    if (elapsed >= INVESTMENT_DURATION) return MAX_PROFIT_PERCENTAGE;

    const progress = elapsed / INVESTMENT_DURATION;
    const profit = MAX_PROFIT_PERCENTAGE * (1 - Math.pow(0.5, progress * 2));
    return Math.min(profit, MAX_PROFIT_PERCENTAGE);
}

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🤖 Bot: ${bot.options.username}`);
    console.log(`🌐 Webhook: ${WEBHOOK_URL || 'No configurado'}`);
    console.log(`📞 API Health: http://localhost:${PORT}/api/health`);
    console.log(`👑 Admin: ${ADMIN_TELEGRAM_ID}`);

    if (!WEBHOOK_URL) {
        console.warn('⚠️  WEBHOOK_URL no configurado. Usando polling como respaldo.');
        bot.startPolling();
    }
});

cron.schedule('*/10 * * * *', checkInvestmentProgress);

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

bot.on('webhook_error', (error) => console.error('❌ Error de webhook:', error.message));
bot.on('polling_error', (error) => console.error('❌ Error de polling:', error.message));

process.on('SIGINT', () => {
    console.log('👋 Apagando...');
    bot.stopPolling();
    process.exit(0);
});