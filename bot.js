const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// ==================== КОНФИГУРАЦИЯ ====================

const BOT_TOKEN = process.env.BOT_TOKEN;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const WEBHOOK_URL = process.env.WEBHOOK_URL 
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Параметры
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000; // 4 часа
const MAX_PROFIT_PERCENTAGE = 3258;

// Инициализация Express
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
const bot = new TelegramBot(BOT_TOKEN);
if (WEBHOOK_URL) {
    bot.setWebHook(`${WEBHOOK_URL}/bot-webhook/${BOT_TOKEN}`);
}

// Кэш уведомлений
const sentNotificationsCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// ==================== ФУНКЦИИ РАБОТЫ С БД (BACKEND) ====================

async function loadDatabase() {
    try {
        const response = await axios.get(JSONBIN_URL, {
            headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
        });
        return response.data || { record: { users: {}, settings: { admins: ['Admin'] } } }; // Возвращаем полный ответ JSONBin
    } catch (error) {
        console.error('❌ Ошибка загрузки БД (Backend):', error.message);
        // Возвращаем пустую структуру, если ошибка, чтобы не уронить всё
        return { record: { users: {}, settings: { admins: ['Admin'] }, depositInstructions: { imageUrl: null, message: null } } };
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
        console.error('❌ Ошибка сохранения БД (Backend):', error.message);
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

// ==================== API ДЛЯ ФРОНТЕНДА (ПРОКСИ) ====================
// Это решение проблемы "Error de conexión". Сайт теперь ходит в БД через сервер.

app.get('/api/database', async (req, res) => {
    try {
        console.log('📥 Frontend requesting database...');
        const data = await loadDatabase();
        res.json(data);
    } catch (e) {
        console.error('❌ Error proxying DB to frontend:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/database', async (req, res) => {
    try {
        const newData = req.body;
        console.log('📤 Frontend saving database...');
        const success = await saveDatabase(newData);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, error: 'Failed to save to external DB' });
        }
    } catch (e) {
        console.error('❌ Error saving DB from frontend:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== API ДЛЯ ЛОГИКИ ИНВЕСТИЦИЙ ====================

app.post('/api/investment-created', async (req, res) => {
    console.log('📥 Получен запрос от сайта:', req.body);
    try {
        const { userId, telegramId, userName, amount, investmentId } = req.body;
        if (!telegramId || !amount) {
            return res.status(400).json({ success: false, error: 'Faltan datos' });
        }

        const message = `🎉 *¡NUEVA INVERSIÓN CREADA!*\n\n` +
                       `*Usuario:* ${userName || 'Inversor'}\n` +
                       `*Monto:* Bs. ${parseFloat(amount).toFixed(2)}\n` +
                       `*Retorno máximo:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                       `*Duración:* 4 horas\n\n` +
                       `¡Tu dinero ya está creciendo! 🚀\n` +
                       `Support- @Suports_Investment`;

        await sendNotification(telegramId, message);

        if (ADMIN_TELEGRAM_ID && ADMIN_TELEGRAM_ID !== telegramId) {
            const adminMsg = `📊 *Nueva inversión*\n\nUsuario: ${userName || 'Nuevo'}\nMonto: Bs. ${parseFloat(amount).toFixed(2)}`;
            await sendNotification(ADMIN_TELEGRAM_ID, adminMsg);
        }

        res.json({ success: true, message: 'Notificación enviada' });
    } catch (error) {
        console.error('❌ Error en investment-created:', error);
        res.status(500).json({ success: false, error: 'Error interno' });
    }
});

app.post('/api/user-registered', async (req, res) => {
    try {
        const { telegramId, userName } = req.body;
        const message = `👋 *¡BIENVENIDO A INVERSIONES BOLIVIA, ${userName}!*\n\n` +
                       `Tu cuenta ha sido creada exitosamente.\n\n` +
                       `*Ahora puedes:*\n` +
                       `• Crear inversiones\n` +
                       `• Seguir el crecimiento en tiempo real\n` +
                       `• Recibir notificaciones automáticas\n\n` +
                       `¡Comienza tu camino al éxito! 🚀\n` +
                       `Support- @Suports_Investment`;
        await sendNotification(telegramId, message);
        res.json({ success: true, message: 'Mensaje de bienvenida enviado' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Inversiones Bolivia Bot',
        timestamp: new Date().toISOString(),
        webhook: WEBHOOK_URL ? 'configured' : 'not configured',
        cacheSize: sentNotificationsCache.size
    });
});

// ==================== API ДЛЯ АДМИН ПАНЕЛИ ====================

const checkSuperAdmin = (req, res, next) => {
    const adminId = req.body.adminId || req.query.adminId;
    if (adminId !== ADMIN_TELEGRAM_ID) {
        return res.status(403).json({ success: false, error: 'Acceso denegado' });
    }
    next();
};

app.post('/api/admin/broadcast', checkSuperAdmin, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Mensaje vacío' });

        const database = await loadDatabase();
        const users = Object.values(database.record?.users || {});
        let successCount = 0;

        for (const user of users) {
            if (user.telegramId) {
                try {
                    await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                    successCount++;
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (e) { console.error(`Error broadcast to ${user.telegramId}:`, e.message); }
            }
        }

        res.json({ success: true, message: `Рассылка завершена. Успешно: ${successCount}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/toggle-admin', checkSuperAdmin, async (req, res) => {
    try {
        const { targetTelegramId, action } = req.body;
        if (!targetTelegramId || !action) return res.status(400).json({ success: false, error: 'Faltan datos' });

        const database = await loadDatabase();
        let targetUser = null;
        // Ищем в record
        for (const key in database.record?.users) {
            if (database.record.users[key].telegramId == targetTelegramId) {
                targetUser = database.record.users[key];
                break;
            }
        }

        if (!targetUser) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });

        targetUser.isAdmin = (action === 'assign');
        await saveDatabase(database.record); // Сохраняем только содержимое record

        let notifyMsg = '';
        if (action === 'assign') notifyMsg = `👑 *¡FELICIDADES!*\n\nHas sido promovido a **ADMINISTRADOR**.`;
        else notifyMsg = `⚠️ *AVISO IMPORTANTE*\n\nTus privilegios de **ADMINISTRADOR** han sido revocados.`;

        await bot.sendMessage(targetTelegramId, notifyMsg, { parse_mode: 'Markdown' });
        res.json({ success: true, message: `Estatus actualizado para ${targetUser.name}` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/bot-control', checkSuperAdmin, async (req, res) => {
    try {
        const { action } = req.body;
        if (action === 'clear-cache') {
            sentNotificationsCache.clear();
            return res.json({ success: true, message: 'Кэш очищен' });
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
    const response = `🤖 *BOT DE INVERSIONES BOLIVIA*\n\nHola ${firstName}, soy el sistema de notificaciones.\n\n*Recibirás automáticamente:*\n• 🎉 Confirmación de inversiones\n• 📈 Actualizaciones cada 2 horas\n• 🏆 Notificación de finalización\n\nPara crear inversiones, visita nuestra web.\nSupport- @Suports_Investment`;
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const db = await loadDatabase();
    const user = Object.values(db.record?.users || {}).find(u => u.telegramId == chatId);

    let response = `📊 *ESTADO DEL SISTEMA*\n\n*Bot:* Activo ✅\n*Cache:* ${sentNotificationsCache.size} entradas\n\n`;
    if (user) response += `*Usuario:* ${user.name}\n*Admin:* ${user.isAdmin ? 'Sí 👑' : 'No'}`;
    else response += `*No estás registrado.*`;

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// ==================== CRON JOBS ====================

async function checkInvestmentProgress() {
    console.log('⏰ Chequeo de inversiones...');
    try {
        const database = await loadDatabase();
        const users = database.record?.users || {};
        let notificationsSent = 0;

        for (const userId in users) {
            const user = users[userId];
            if (!user.telegramId || !user.investments) continue;

            for (const investment of user.investments) {
                if (!investment.notifications) investment.notifications = { purchase: false, twoHours: false, completed: false };

                const now = Date.now();
                const startTime = new Date(investment.startDate).getTime();
                const elapsed = now - startTime;
                const hoursElapsed = elapsed / (1000 * 60 * 60);
                const isCompleted = elapsed >= INVESTMENT_DURATION;

                if (!investment.notifications.twoHours && hoursElapsed >= 2 && !isCompleted) {
                    const profit = calculateCurrentProfit(investment);
                    const msg = `📈 *¡CRECIMIENTO DETECTADO!*\nHan pasado 2 horas.\n*Crecimiento:* +${profit.toFixed(1)}%\n\n¡Sigue creciendo! 💰\nSupport- @Suports_Investment`;
                    await sendNotification(user.telegramId, msg);
                    investment.notifications.twoHours = true;
                    notificationsSent++;
                }

                if (!investment.notifications.completed && isCompleted) {
                    const finalProfit = investment.amount * MAX_PROFIT_PERCENTAGE / 100;
                    const msg = `🏆 *¡INVERSIÓN COMPLETADA!*\n\nInversión: Bs. ${investment.amount.toFixed(2)}\nGanancia: +${MAX_PROFIT_PERCENTAGE}%\nTotal: Bs. ${(investment.amount + finalProfit).toFixed(2)}\n\n⚠️ *¡CONTACTA AL ADMINISTRADOR PARA RETIRAR!*\nSupport- @Suports_Investment`;
                    await sendNotification(user.telegramId, msg);
                    investment.notifications.completed = true;
                    notificationsSent++;
                }
            }
        }

        if (notificationsSent > 0) await saveDatabase(database.record);

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

cron.schedule('*/10 * * * *', checkInvestmentProgress);
cron.schedule('0 0 * * *', () => {
    const oneDayAgo = Date.now() - CACHE_DURATION;
    for (const [key, timestamp] of sentNotificationsCache.entries()) {
        if (timestamp < oneDayAgo) sentNotificationsCache.delete(key);
    }
    console.log('🧹 Cache limpiada');
});

// ==================== СЕРВЕР ====================

const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado puerto ${PORT}`);
    console.log(`🌐 Webhook: ${WEBHOOK_URL}`);
    if (!WEBHOOK_URL) bot.startPolling();
});