const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
require('dotenv').config();

// Конфигурация
const BOT_API_URL = 'https://site-2.0.railway.app/api/investment-created';
const BOT_WELCOME_API_URL = 'https://site-2.0.railway.app/api/user-registered';
const BOT_HEALTH_API_URL = 'https://site-2.0.railway.app/api/health';
const BOT_TOKEN = process.env.BOT_TOKEN
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const WEBHOOK_URL = process.env.WEBHOOK_URL  
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Параметры
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000;
const MAX_PROFIT_PERCENTAGE = 3258;

// Инициализация Express
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://Creecly.pythonanywhere.com');
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

// Состояния пользователей для админ-панели
const userStates = new Map();

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

// ==================== ФУНКЦИИ АДМИН-ПАНЕЛИ ====================

async function showAdminPanel(chatId) {
    try {
        const database = await loadDatabase();
        const admins = database.settings?.admins || ['Admin'];
        
        const message = `👑 *ПАНЕЛЬ АДМИНИСТРАТОРА*\n\n` +
                       `*Текущие администраторы:*\n` +
                       `${admins.map(admin => `• ${admin}`).join('\n') || 'Нет администраторов'}\n\n` +
                       `*Выберите действие:*`;
        
        const options = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📢 Массовая рассылка', callback_data: 'admin_broadcast' }],
                    [{ text: '👑 Назначить администратора', callback_data: 'admin_add' }],
                    [{ text: '❌ Снять администратора', callback_data: 'admin_remove' }],
                    [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_back' }]
                ]
            }
        };
        
        await bot.sendMessage(chatId, message, options);
        return true;
    } catch (error) {
        console.error('❌ Ошибка показа админ-панели:', error);
        return false;
    }
}

async function broadcastMessage(chatId) {
    userStates.set(chatId, { action: 'broadcast' });
    
    const message = `📢 *МАССОВАЯ РАССЫЛКА*\n\n` +
                   `Пожалуйста, отправьте сообщение для рассылки всем пользователям.\n` +
                   `Вы можете использовать Markdown форматирование.\n\n` +
                   `*Пример:*\n` +
                   `Привет всем! Это тестовая рассылка.`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function addAdmin(chatId) {
    userStates.set(chatId, { action: 'add_admin' });
    
    const message = `👑 *НАЗНАЧЕНИЕ АДМИНИСТРАТОРА*\n\n` +
                   `Пожалуйста, отправьте Telegram ID пользователя, которого хотите назначить администратором.\n\n` +
                   `*Как получить ID:*\n` +
                   `1. Попросите пользователя написать @userinfobot\n` +
                   `2. Или используйте команду /id в вашем боте\n\n` +
                   `Отправьте только цифры ID:`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function removeAdmin(chatId) {
    userStates.set(chatId, { action: 'remove_admin' });
    
    const database = await loadDatabase();
    const admins = database.settings?.admins || ['Admin'];
    
    const message = `❌ *СНЯТИЕ АДМИНИСТРАТОРА*\n\n` +
                   `*Текущие администраторы:*\n` +
                   `${admins.map(admin => `• ${admin}`).join('\n') || 'Нет администраторов'}\n\n` +
                   `Пожалуйста, отправьте Telegram ID администратора, которого хотите снять:\n\n` +
                   `Отправьте только цифры ID:`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function processAddAdmin(chatId, targetId) {
    try {
        const database = await loadDatabase();
        
        // Инициализируем настройки если их нет
        if (!database.settings) {
            database.settings = { admins: ['Admin'] };
        }
        if (!database.settings.admins) {
            database.settings.admins = ['Admin'];
        }
        
        // Проверяем, существует ли уже такой админ
        if (database.settings.admins.includes(targetId)) {
            await bot.sendMessage(chatId, `❌ Пользователь ${targetId} уже является администратором.`);
            return false;
        }
        
        // Добавляем админа
        database.settings.admins.push(targetId);
        
        // Сохраняем в БД
        const saved = await saveDatabase(database);
        
        if (saved) {
            // Отправляем сообщение новому админу
            try {
                const adminMessage = `👑 *ВЫ НАЗНАЧЕНЫ АДМИНИСТРАТОРОМ!*\n\n` +
                                   `Поздравляем! Вы были назначены администратором бота Inversiones Bolivia.\n\n` +
                                   `Теперь у вас есть доступ к админ-панели через команду /admin\n` +
                                   `Используйте свою власть с умом! 🛡️` +
                                   `Support- @Suports_Investment`;
                
                await sendNotification(targetId, adminMessage);
                await bot.sendMessage(chatId, `✅ Пользователь ${targetId} успешно назначен администратором!\nЕму отправлено уведомление.`);
            } catch (error) {
                await bot.sendMessage(chatId, `✅ Пользователь ${targetId} назначен администратором, но уведомление не доставлено (возможно, бот заблокирован).`);
            }
            
            // Показываем обновленную админ-панель
            await showAdminPanel(chatId);
            return true;
        } else {
            await bot.sendMessage(chatId, `❌ Ошибка сохранения в базу данных.`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Ошибка добавления админа:', error);
        await bot.sendMessage(chatId, `❌ Произошла ошибка: ${error.message}`);
        return false;
    }
}

async function processRemoveAdmin(chatId, targetId) {
    try {
        // Нельзя снять главного админа
        if (targetId === ADMIN_TELEGRAM_ID) {
            await bot.sendMessage(chatId, `❌ Нельзя снять главного администратора (ID: ${ADMIN_TELEGRAM_ID})`);
            return false;
        }
        
        const database = await loadDatabase();
        
        if (!database.settings?.admins) {
            await bot.sendMessage(chatId, `❌ В базе данных нет списка администраторов.`);
            return false;
        }
        
        // Проверяем, существует ли такой админ
        const adminIndex = database.settings.admins.indexOf(targetId);
        if (adminIndex === -1) {
            await bot.sendMessage(chatId, `❌ Пользователь ${targetId} не является администратором.`);
            return false;
        }
        
        // Удаляем админа
        database.settings.admins.splice(adminIndex, 1);
        
        // Сохраняем в БД
        const saved = await saveDatabase(database);
        
        if (saved) {
            // Отправляем сообщение снятому админу
            try {
                const adminMessage = `⚠️ *ВЫ СНЯТЫ С ДОЛЖНОСТИ АДМИНИСТРАТОРА*\n\n` +
                                   `Ваши права администратора в боте Inversiones Bolivia были отозваны.\n\n` +
                                   `Теперь у вас нет доступа к админ-панели.\n` +
                                   `По вопросам обращайтесь к главному администратору.` +
                                   `Support- @Suports_Investment`;
                
                await sendNotification(targetId, adminMessage);
                await bot.sendMessage(chatId, `✅ Пользователь ${targetId} успешно снят с должности администратора!\nЕму отправлено уведомление.`);
            } catch (error) {
                await bot.sendMessage(chatId, `✅ Пользователь ${targetId} снят с должности, но уведомление не доставлено.`);
            }
            
            // Показываем обновленную админ-панель
            await showAdminPanel(chatId);
            return true;
        } else {
            await bot.sendMessage(chatId, `❌ Ошибка сохранения в базу данных.`);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Ошибка снятия админа:', error);
        await bot.sendMessage(chatId, `❌ Произошла ошибка: ${error.message}`);
        return false;
    }
}

async function processBroadcast(chatId, messageText) {
    try {
        await bot.sendMessage(chatId, `⏳ Начинаю массовую рассылку...\nСообщение отправляется всем пользователям.`);
        
        const database = await loadDatabase();
        const users = database.users || {};
        let sentCount = 0;
        let failedCount = 0;
        
        // Отправляем всем пользователям
        for (const userId in users) {
            const user = users[userId];
            if (user.telegramId) {
                try {
                    const fullMessage = `📢 *ВАЖНОЕ ОБЪЯВЛЕНИЕ*\n\n${messageText}\n\n` +
                                      `_Это автоматическое сообщение от администрации._` +
                                      `Support- @Suports_Investment`;
                    
                    await sendNotification(user.telegramId, fullMessage);
                    sentCount++;
                    
                    // Небольшая задержка чтобы не превысить лимиты Telegram
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`❌ Ошибка отправки пользователю ${user.telegramId}:`, error.message);
                    failedCount++;
                }
            }
        }
        
        // Отправляем статистику админу
        const statsMessage = `📊 *РЕЗУЛЬТАТЫ РАССЫЛКИ*\n\n` +
                           `✅ Успешно отправлено: ${sentCount}\n` +
                           `❌ Не отправлено: ${failedCount}\n` +
                           `📝 Общее количество пользователей: ${Object.keys(users).length}\n\n` +
                           `Рассылка завершена!`;
        
        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
        
        // Очищаем состояние
        userStates.delete(chatId);
        
    } catch (error) {
        console.error('❌ Ошибка массовой рассылки:', error);
        await bot.sendMessage(chatId, `❌ Ошибка при рассылке: ${error.message}`);
    }
}

async function showAdminStats(chatId) {
    try {
        const database = await loadDatabase();
        const users = database.users || {};
        const admins = database.settings?.admins || ['Admin'];
        
        let activeInvestments = 0;
        let totalInvestments = 0;
        
        // Считаем инвестиции
        for (const userId in users) {
            const user = users[userId];
            if (user.investments && Array.isArray(user.investments)) {
                totalInvestments += user.investments.length;
                
                // Считаем активные инвестиции
                const now = Date.now();
                for (const investment of user.investments) {
                    const startTime = new Date(investment.startDate).getTime();
                    if (now - startTime < INVESTMENT_DURATION) {
                        activeInvestments++;
                    }
                }
            }
        }
        
        const message = `📊 *СТАТИСТИКА СИСТЕМЫ*\n\n` +
                       `👥 *Пользователи:* ${Object.keys(users).length}\n` +
                       `👑 *Администраторы:* ${admins.length}\n` +
                       `💼 *Всего инвестиций:* ${totalInvestments}\n` +
                       `🔄 *Активных инвестиций:* ${activeInvestments}\n` +
                       `📨 *Уведомлений в кэше:* ${sentNotificationsCache.size}\n\n` +
                       `*Дата:* ${new Date().toLocaleString('es-ES')}`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
    } catch (error) {
        console.error('❌ Ошибка показа статистики:', error);
        await bot.sendMessage(chatId, `❌ Ошибка получения статистики: ${error.message}`);
    }
}

// ==================== API ДЛЯ ВАШЕГО САЙТА ====================

// 1. Конечная точка для создания инвестиций (будет вызываться с вашего сайта)
app.post('/api/investment-created', async (req, res) => {
    console.log('📥 Получен запрос от сайта:', req.body);

    try {
        const { userId, telegramId, userName, amount, investmentId } = req.body;

        // Валидация
        if (!telegramId || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Faltan datos: telegramId y amount son requeridos'
            });
        }

        // Отправляем уведомление о новой инвестиции
        const message = `🎉 *¡NUEVA INVERSIÓN CREADA!*\n\n` +
                       `*Usuario:* ${userName || 'Inversor'}\n` +
                       `*Monto:* Bs. ${parseFloat(amount).toFixed(2)}\n` +
                       `*Retorno máximo:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                       `*Duración:* 4 horas\n\n` +
                       `¡Tu dinero ya está creciendo! 🚀\n` +
                       `Recibirás actualizaciones cada 2 horas.`+
                       `Support- @Suports_Investment`;

        const sent = await sendNotification(telegramId, message);

        // Также отправляем администратору
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
                       `¡Comienza tu camino al éxito! 🚀`+
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

// ==================== ВЕБХУК TELEGRAM ====================

// Маршрут для вебхука Telegram
app.post(`/bot-webhook/${BOT_TOKEN}`, (req, res) => {
    const update = req.body;
    console.log('📱 Update from Telegram:', update?.message?.text || 'no text');

    // Обработка обновлений
    bot.processUpdate(update);
    res.sendStatus(200);
});

// ==================== ОБРАБОТЧИКИ КОМАНД ====================

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Usuario';

    const response = `🤖 *BOT DE INVERSIONES BOLIVIA*\n\n` +
                    `Hola ${firstName}, soy el sistema de notificaciones.\n\n` +
                    `*Recibirás automáticamente:*\n` +
                    `• 🎉 Confirmación de inversiones\n` +
                    `• 📈 Actualizaciones cada 2 horas\n` +
                    `• 🏆 Notificación de finalización\n\n` +
                    `Para crear inversiones, visita nuestra web.`+
                    `Support- @Suports_Investment`;

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Команда /help
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

// Команда /status
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
        response += `*ID:* ${user.id?.substring(0, 8)}...\n`;

        if (user.investments && user.investments.length > 0) {
            response += `*Inversiones activas:* ${user.investments.length}\n`;
        } else {
            response += `*No tienes inversiones activas.*\n`;
        }
    } else {
        response += `*No estás registrado en el sistema.*\n`;
        response += `Visita la web para crear tu cuenta.`;
    }

    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// Команда /admin - только для администраторов
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Проверяем права доступа
    const database = await loadDatabase();
    const admins = database.settings?.admins || ['Admin'];
    
    if (chatId.toString() === ADMIN_TELEGRAM_ID || admins.includes(chatId.toString())) {
        await showAdminPanel(chatId);
    } else {
        await bot.sendMessage(chatId, `❌ У вас нет доступа к админ-панели.\n\nЭта функция доступна только администраторам.`);
    }
});

// Команда /id - для получения своего ID
bot.onText(/\/id/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `🆔 Ваш Telegram ID: \`${chatId}\``, { parse_mode: 'Markdown' });
});

// Обработка callback-кнопок
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    // Проверяем права доступа для админ-действий
    if (data.startsWith('admin_')) {
        const database = await loadDatabase();
        const admins = database.settings?.admins || ['Admin'];
        
        if (chatId.toString() !== ADMIN_TELEGRAM_ID && !admins.includes(chatId.toString())) {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Нет доступа!' });
            return;
        }
    }
    
    try {
        await bot.answerCallbackQuery(callbackQuery.id);
        
        switch (data) {
            case 'admin_broadcast':
                await broadcastMessage(chatId);
                break;
                
            case 'admin_add':
                await addAdmin(chatId);
                break;
                
            case 'admin_remove':
                await removeAdmin(chatId);
                break;
                
            case 'admin_stats':
                await showAdminStats(chatId);
                break;
                
            case 'admin_back':
                await showAdminPanel(chatId);
                break;
        }
        
    } catch (error) {
        console.error('❌ Ошибка обработки callback:', error);
    }
});

// Обработка текстовых сообщений для админ-панели
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    const state = userStates.get(chatId);
    
    if (state) {
        switch (state.action) {
            case 'broadcast':
                await processBroadcast(chatId, text);
                break;
                
            case 'add_admin':
                // Проверяем что это число
                if (/^\d+$/.test(text.trim())) {
                    await processAddAdmin(chatId, text.trim());
                    userStates.delete(chatId);
                } else {
                    await bot.sendMessage(chatId, '❌ Пожалуйста, отправьте только цифры (Telegram ID).');
                }
                break;
                
            case 'remove_admin':
                // Проверяем что это число
                if (/^\d+$/.test(text.trim())) {
                    await processRemoveAdmin(chatId, text.trim());
                    userStates.delete(chatId);
                } else {
                    await bot.sendMessage(chatId, '❌ Пожалуйста, отправьте только цифры (Telegram ID).');
                }
                break;
        }
    }
});

// ==================== АВТОМАТИЧЕСКИЕ ПРОВЕРКИ ====================

// Функция для проверки прогресса инвестиций
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
                // Убедимся, что есть объект notifications
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

                // Уведомление через 2 часа
                if (!investment.notifications.twoHours && hoursElapsed >= 2 && !isCompleted) {
                    const profit = calculateCurrentProfit(investment);
                    const message = `📈 *¡CRECIMIENTO DETECTADO!*\n\n` +
                                   `Han pasado 2 horas de tu inversión.\n` +
                                   `*Crecimiento actual:* +${profit.toFixed(1)}%\n` +
                                   `*Ganancia:* Bs. ${(investment.amount * profit / 100).toFixed(2)}\n\n` +
                                   `¡Sigue creciendo! 💰`+
                                   `Support- @Suports_Investment`;

                    await sendNotification(user.telegramId, message);
                    investment.notifications.twoHours = true;
                    notificationsSent++;
                }

                // Уведомление о завершении
                if (!investment.notifications.completed && isCompleted) {
                    const finalProfit = investment.amount * MAX_PROFIT_PERCENTAGE / 100;
                    const total = investment.amount + finalProfit;

                    const message = `🏆 *¡INVERSIÓN COMPLETADA!*\n\n` +
                                   `*Inversión:* Bs. ${investment.amount.toFixed(2)}\n` +
                                   `*Ganancia:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                                   `*Total:* Bs. ${total.toFixed(2)}\n\n` +
                                   `⚠️ *¡CONTACTA AL ADMINISTRADOR PARA RETIRAR!*`+
                                   `Support- @Suports_Investment`;
                    await sendNotification(user.telegramId, message);
                    investment.notifications.completed = true;
                    notificationsSent++;
                }
            }
        }

        // Сохраняем обновления
        if (notificationsSent > 0) {
            await saveDatabase(database);
            console.log(`✅ ${notificationsSent} notificaciones enviadas`);
        }

    } catch (error) {
        console.error('❌ Error en checkInvestmentProgress:', error.message);
    }
}

// Функция расчета прибыли
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

    // Запускаем планировщик
    if (!WEBHOOK_URL) {
        console.warn('⚠️  WEBHOOK_URL no configurado. Usando polling como respaldo.');
        bot.startPolling();
    }
});

// Запускаем проверки каждые 10 минут
cron.schedule('*/10 * * * *', checkInvestmentProgress);

// Очистка кэша cada día
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

// Очистка userStates каждый час
cron.schedule('0 * * * *', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleared = 0;

    for (const [key, state] of userStates.entries()) {
        if (state.timestamp && state.timestamp < oneHourAgo) {
            userStates.delete(key);
            cleared++;
        }
    }

    console.log(`🧹 Limpiadas ${cleared} состояний пользователей`);
});

// Manejo de errores
bot.on('webhook_error', (error) => {
    console.error('❌ Error de webhook:', error.message);
});

bot.on('polling_error', (error) => {
    console.error('❌ Error de polling:', error.message);
});

process.on('SIGINT', () => {
    console.log('👋 Apagando...');
    bot.stopPolling();
    process.exit(0);
});