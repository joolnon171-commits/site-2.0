const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// ==================== ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ====================

// Проверяем обязательные переменные
const BOT_TOKEN = process.env.BOT_TOKEN;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

console.log('🔍 Проверка переменных окружения:');
console.log(`   BOT_TOKEN: ${BOT_TOKEN ? '✓ Установлен' : '✗ ОТСУТСТВУЕТ'}`);
console.log(`   JSONBIN_BIN_ID: ${JSONBIN_BIN_ID ? '✓ Установлен' : '✗ ОТСУТСТВУЕТ'}`);
console.log(`   JSONBIN_MASTER_KEY: ${JSONBIN_MASTER_KEY ? '✓ Установлен' : '✗ ОТСУТСТВУЕТ'}`);
console.log(`   ADMIN_TELEGRAM_ID: ${ADMIN_TELEGRAM_ID}`);
console.log(`   WEBHOOK_URL: ${WEBHOOK_URL || '✗ Не настроен'}`);
console.log(`   PORT: ${PORT}`);

// Если нет токена бота, останавливаем выполнение
if (!BOT_TOKEN) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: BOT_TOKEN не установлен!');
    console.error('ℹ️ Убедитесь, что в Railway добавлены переменные окружения:');
    console.error('   1. Перейдите в настройки проекта Railway');
    console.error('   2. Откройте вкладку "Variables"');
    console.error('   3. Добавьте переменную BOT_TOKEN со значением токена вашего бота');
    console.error('   4. Также добавьте другие переменные из .env.example');
    process.exit(1);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

// Инициализация Express раньше
const app = express();

// Отложенная инициализация бота
let bot;
let botInitialized = false;

async function initializeBot() {
    try {
        const TelegramBot = require('node-telegram-bot-api');
        bot = new TelegramBot(BOT_TOKEN);

        if (WEBHOOK_URL) {
            console.log('🌐 Настройка Webhook...');
            try {
                await bot.setWebHook(`${WEBHOOK_URL}/bot-webhook/${BOT_TOKEN}`);
                console.log('✅ Webhook настроен успешно');
            } catch (webhookError) {
                console.error('❌ Ошибка настройки webhook:', webhookError.message);
                console.log('🔄 Использую polling как запасной вариант...');
                bot.startPolling();
            }
        } else {
            console.log('🔄 Webhook не настроен, использую polling...');
            bot.startPolling();
        }

        botInitialized = true;
        console.log(`🤖 Бот инициализирован: @${bot.options.username}`);

        // Настраиваем обработчики
        setupBotHandlers();

        return true;
    } catch (error) {
        console.error('❌ Ошибка инициализации бота:', error.message);
        return false;
    }
}

// ==================== КОНСТАНТЫ ====================

const BOT_API_URL = 'https://site-2.0.railway.app/api/investment-created';
const BOT_WELCOME_API_URL = 'https://site-2.0.railway.app/api/user-registered';
const BOT_HEALTH_API_URL = 'https://site-2.0.railway.app/api/health';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Параметры
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000;
const MAX_PROFIT_PERCENTAGE = 3258;

// ==================== MIDDLEWARE ====================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://Creecly.pythonanywhere.com');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Кэш уведомлений
const sentNotificationsCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// Состояния бота для массовой рассылки
const userStates = new Map();

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С БД ====================

async function loadDatabase() {
    try {
        if (!JSONBIN_BIN_ID || !JSONBIN_MASTER_KEY) {
            console.warn('⚠️ JSONBIN credentials отсутствуют, использую локальную БД');
            return { users: {}, settings: { admins: [ADMIN_TELEGRAM_ID] } };
        }

        const response = await axios.get(JSONBIN_URL, {
            headers: { 'X-Master-Key': JSONBIN_MASTER_KEY }
        });
        return response.data.record || { users: {}, settings: { admins: [ADMIN_TELEGRAM_ID] } };
    } catch (error) {
        console.error('❌ Ошибка загрузки БД:', error.message);
        return { users: {}, settings: { admins: [ADMIN_TELEGRAM_ID] } };
    }
}

async function saveDatabase(database) {
    try {
        if (!JSONBIN_BIN_ID || !JSONBIN_MASTER_KEY) {
            console.warn('⚠️ JSONBIN credentials отсутствуют, пропускаю сохранение');
            return true;
        }

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
    if (!botInitialized) {
        console.error('❌ Бот не инициализирован, не могу отправить сообщение');
        return false;
    }

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

// ==================== АДМИН ФУНКЦИИ ====================

// Проверка прав администратора
async function isAdmin(telegramId) {
    try {
        const db = await loadDatabase();
        const admins = db.settings?.admins || [];
        return admins.includes(telegramId.toString());
    } catch (error) {
        console.error('❌ Ошибка проверки прав:', error.message);
        return false;
    }
}

// Массовая рассылка
async function sendMassMessage(message) {
    if (!botInitialized) {
        console.error('❌ Бот не инициализирован, не могу выполнить рассылку');
        return { sentCount: 0, failedCount: 0, total: 0, error: 'Bot not initialized' };
    }

    try {
        const db = await loadDatabase();
        const users = db.users;
        let sentCount = 0;
        let failedCount = 0;

        for (const userId in users) {
            const user = users[userId];
            if (user.telegramId) {
                try {
                    await bot.sendMessage(user.telegramId, message, {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    sentCount++;

                    // Задержка чтобы не превысить лимиты Telegram
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (error) {
                    console.error(`❌ Ошибка отправки ${user.telegramId}:`, error.message);
                    failedCount++;
                }
            }
        }

        return { sentCount, failedCount, total: Object.keys(users).length };
    } catch (error) {
        console.error('❌ Ошибка массовой рассылки:', error.message);
        return { sentCount: 0, failedCount: 0, total: 0, error: error.message };
    }
}

// Назначить администратора
async function addAdmin(telegramId, addedByAdminId) {
    try {
        const db = await loadDatabase();

        if (!db.settings.admins) {
            db.settings.admins = [];
        }

        const admins = db.settings.admins;

        // Проверяем, не является ли уже администратором
        if (admins.includes(telegramId.toString())) {
            return { success: false, message: 'Этот пользователь уже является администратором' };
        }

        // Добавляем администратора
        admins.push(telegramId.toString());

        // Сохраняем изменения
        const saved = await saveDatabase(db);

        if (saved) {
            // Отправляем уведомление новому администратору
            try {
                if (botInitialized) {
                    await bot.sendMessage(telegramId,
                        `🎉 *ВЫ НАЗНАЧЕНЫ АДМИНИСТРАТОРОМ!*\n\n` +
                        `Вам предоставлены права администратора бота.\n\n` +
                        `*Доступные функции:*\n` +
                        `• Массовая рассылка\n` +
                        `• Управление администраторами\n` +
                        `• Просмотр статистики\n\n` +
                        `Используйте команду /admin для доступа к панели.`+
                        `Support- @Suports_Investment`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (error) {
                console.error('❌ Не удалось отправить уведомление новому админу:', error.message);
            }

            return {
                success: true,
                message: `Пользователь ${telegramId} назначен администратором`,
                adminsCount: admins.length
            };
        } else {
            return { success: false, message: 'Ошибка сохранения в БД' };
        }
    } catch (error) {
        console.error('❌ Ошибка назначения админа:', error.message);
        return { success: false, message: error.message };
    }
}

// Снять администратора
async function removeAdmin(telegramId, removedByAdminId) {
    try {
        const db = await loadDatabase();

        if (!db.settings.admins) {
            db.settings.admins = [];
        }

        const admins = db.settings.admins;

        // Проверяем, является ли администратором
        const adminIndex = admins.indexOf(telegramId.toString());

        if (adminIndex === -1) {
            return { success: false, message: 'Этот пользователь не является администратором' };
        }

        // Нельзя снять главного администратора
        if (telegramId.toString() === ADMIN_TELEGRAM_ID) {
            return { success: false, message: 'Нельзя снять главного администратора' };
        }

        // Удаляем администратора
        admins.splice(adminIndex, 1);

        // Сохраняем изменения
        const saved = await saveDatabase(db);

        if (saved) {
            // Отправляем уведомление бывшему администратору
            try {
                if (botInitialized) {
                    await bot.sendMessage(telegramId,
                        `ℹ️ *ПРАВА АДМИНИСТРАТОРА СНЯТЫ*\n\n` +
                        `Ваши права администратора были отозваны.\n\n` +
                        `Теперь у вас нет доступа к административной панели.`+
                        `Support- @Suports_Investment`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } catch (error) {
                console.error('❌ Не удалось отправить уведомление:', error.message);
            }

            return {
                success: true,
                message: `Пользователь ${telegramId} снят с администратора`,
                adminsCount: admins.length
            };
        } else {
            return { success: false, message: 'Ошибка сохранения в БД' };
        }
    } catch (error) {
        console.error('❌ Ошибка снятия админа:', error.message);
        return { success: false, message: error.message };
    }
}

// Получить список администраторов
async function getAdminsList() {
    try {
        const db = await loadDatabase();
        return db.settings?.admins || [];
    } catch (error) {
        console.error('❌ Ошибка получения списка админов:', error.message);
        return [];
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
app.get('/api/health', async (req, res) => {
    const dbStatus = await loadDatabase().then(() => 'OK').catch(() => 'ERROR');

    res.json({
        status: 'online',
        service: 'Inversiones Bolivia Bot',
        timestamp: new Date().toISOString(),
        bot_initialized: botInitialized,
        webhook: WEBHOOK_URL ? 'configured' : 'not configured',
        db_status: dbStatus,
        cache_size: sentNotificationsCache.size,
        environment_variables: {
            bot_token: BOT_TOKEN ? 'SET' : 'MISSING',
            jsonbin_id: JSONBIN_BIN_ID ? 'SET' : 'MISSING',
            jsonbin_key: JSONBIN_MASTER_KEY ? 'SET' : 'MISSING',
            admin_id: ADMIN_TELEGRAM_ID,
            port: PORT
        }
    });
});

// 4. Проверка бота
app.get('/api/bot-status', async (req, res) => {
    try {
        if (!botInitialized) {
            return res.json({
                status: 'not_initialized',
                message: 'Bot is not initialized yet'
            });
        }

        // Пробуем получить информацию о боте
        const botInfo = await bot.getMe();

        res.json({
            status: 'active',
            bot: {
                id: botInfo.id,
                username: botInfo.username,
                first_name: botInfo.first_name
            },
            initialized: botInitialized,
            webhook_enabled: !!WEBHOOK_URL
        });
    } catch (error) {
        res.json({
            status: 'error',
            message: error.message
        });
    }
});

// ==================== ВЕБХУК TELEGRAM ====================

// Маршрут для вебхука Telegram
app.post(`/bot-webhook/${BOT_TOKEN}`, (req, res) => {
    if (!botInitialized) {
        console.error('❌ Бот не инициализирован, не могу обработать webhook');
        return res.status(503).json({ error: 'Bot not initialized' });
    }

    const update = req.body;
    console.log('📱 Update from Telegram:', update?.message?.text || 'no text');

    // Обработка обновлений
    bot.processUpdate(update);
    res.sendStatus(200);
});

// ==================== НАСТРОЙКА ОБРАБОТЧИКОВ БОТА ====================

function setupBotHandlers() {
    if (!bot || !botInitialized) {
        console.error('❌ Не могу настроить обработчики: бот не инициализирован');
        return;
    }

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

    // Команда /admin - Админ панель
    bot.onText(/\/admin/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id.toString();

        // Проверяем права администратора
        const adminCheck = await isAdmin(telegramId);

        if (!adminCheck) {
            await bot.sendMessage(chatId,
                `⛔ *ДОСТУП ЗАПРЕЩЕН*\n\n` +
                `У вас нет прав для доступа к административной панели.`+
                `Support- @Suports_Investment`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Получаем статистику
        const db = await loadDatabase();
        const usersCount = Object.keys(db.users || {}).length;
        const adminsList = await getAdminsList();

        // Создаем клавиатуру админ-панели
        const adminKeyboard = {
            reply_markup: {
                keyboard: [
                    ['📢 Массовая рассылка'],
                    ['👑 Назначить админа', '🔓 Снять админа'],
                    ['📊 Статистика', '👥 Список админов'],
                    ['❌ Закрыть панель']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        const response = `⚡ *АДМИНИСТРАТИВНАЯ ПАНЕЛЬ*\n\n` +
                        `👑 *Главный админ:* ${ADMIN_TELEGRAM_ID}\n` +
                        `👥 *Всего пользователей:* ${usersCount}\n` +
                        `🛡️ *Администраторов:* ${adminsList.length}\n\n` +
                        `*Выберите действие:*\n\n` +
                        `📢 *Массовая рассылка* - отправить сообщение всем пользователям\n` +
                        `👑 *Назначить админа* - добавить нового администратора\n` +
                        `🔓 *Снять админа* - удалить права администратора\n` +
                        `📊 *Статистика* - подробная статистика бота\n` +
                        `👥 *Список админов* - просмотр всех администраторов`+
                        `Support- @Suports_Investment`;

        await bot.sendMessage(chatId, response, {
            parse_mode: 'Markdown',
            reply_markup: adminKeyboard.reply_markup
        });
    });

    // Обработка нажатий на кнопки админ-панели
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        const telegramId = msg.from.id.toString();

        // Пропускаем команды
        if (text?.startsWith('/')) return;

        // Проверяем, является ли пользователь администратором
        const isUserAdmin = await isAdmin(telegramId);
        if (!isUserAdmin) return;

        // Обработка кнопок админ-панели
        switch(text) {
            case '📢 Массовая рассылка':
                userStates.set(telegramId, 'awaiting_mass_message');
                await bot.sendMessage(chatId,
                    `📢 *МАССОВАЯ РАССЫЛКА*\n\n` +
                    `Введите сообщение для рассылки всем пользователям:\n\n` +
                    `ℹ️ Можно использовать Markdown разметку\n` +
                    `⏱️ Рассылка может занять несколько минут\n` +
                    `❌ Отправьте "отмена" для отмены`+
                    `Support- @Suports_Investment`,
                    { parse_mode: 'Markdown' }
                );
                break;

            case '👑 Назначить админа':
                userStates.set(telegramId, 'awaiting_add_admin');
                await bot.sendMessage(chatId,
                    `👑 *НАЗНАЧЕНИЕ АДМИНИСТРАТОРА*\n\n` +
                    `Введите Telegram ID пользователя для назначения администратором:\n\n` +
                    `ℹ️ ID можно получить с помощью бота @userinfobot\n` +
                    `❌ Отправьте "отмена" для отмены`+
                    `Support- @Suports_Investment`,
                    { parse_mode: 'Markdown' }
                );
                break;

            case '🔓 Снять админа':
                userStates.set(telegramId, 'awaiting_remove_admin');

                // Получаем список админов
                const admins = await getAdminsList();
                let adminsText = 'Текущие администраторы:\n';
                admins.forEach(adminId => {
                    adminsText += `• ${adminId}\n`;
                });

                await bot.sendMessage(chatId,
                    `🔓 *СНЯТИЕ АДМИНИСТРАТОРА*\n\n` +
                    `${adminsText}\n` +
                    `Введите Telegram ID администратора для снятия прав:\n\n` +
                    `⚠️ Нельзя снять главного администратора (${ADMIN_TELEGRAM_ID})\n` +
                    `❌ Отправьте "отмена" для отмены`+
                    `Support- @Suports_Investment`,
                    { parse_mode: 'Markdown' }
                );
                break;

            case '📊 Статистика':
                const db = await loadDatabase();
                const usersCount = Object.keys(db.users || {}).length;
                const activeInvestments = Object.values(db.users || {}).reduce((sum, user) => {
                    return sum + (user.investments?.length || 0);
                }, 0);
                const adminsCount = (db.settings?.admins || []).length;

                const statsMessage = `📊 *СТАТИСТИКА БОТА*\n\n` +
                                   `👥 *Пользователи:* ${usersCount}\n` +
                                   `💰 *Активные инвестиции:* ${activeInvestments}\n` +
                                   `🛡️ *Администраторов:* ${adminsCount}\n` +
                                   `💾 *Кэш уведомлений:* ${sentNotificationsCache.size}\n` +
                                   `🕐 *Время работы:* ${new Date().toLocaleString('ru-RU')}\n\n` +
                                   `*Статус:* ✅ Активен`+
                                   `Support- @Suports_Investment`;

                await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
                break;

            case '👥 Список админов':
                const allAdmins = await getAdminsList();
                let adminsMessage = `🛡️ *СПИСОК АДМИНИСТРАТОРОВ*\n\n`;

                if (allAdmins.length === 0) {
                    adminsMessage += `Нет администраторов.`;
                } else {
                    allAdmins.forEach((adminId, index) => {
                        const isMainAdmin = adminId === ADMIN_TELEGRAM_ID;
                        adminsMessage += `${index + 1}. ${adminId} ${isMainAdmin ? '👑 (Главный)' : ''}\n`;
                    });
                }

                adminsMessage += `\nВсего: ${allAdmins.length} администраторов`+
                `Support- @Suports_Investment`;

                await bot.sendMessage(chatId, adminsMessage, { parse_mode: 'Markdown' });
                break;

            case '❌ Закрыть панель':
                userStates.delete(telegramId);
                await bot.sendMessage(chatId,
                    `⚡ Админ-панель закрыта\n\n` +
                    `Используйте /admin для повторного открытия.`+
                    `Support- @Suports_Investment`,
                    { reply_markup: { remove_keyboard: true } }
                );
                break;

            default:
                // Обработка состояний ожидания ввода
                const userState = userStates.get(telegramId);

                if (userState === 'awaiting_mass_message') {
                    if (text.toLowerCase() === 'отмена') {
                        userStates.delete(telegramId);
                        await bot.sendMessage(chatId, '❌ Рассылка отменена.');
                        return;
                    }

                    // Начинаем рассылку
                    await bot.sendMessage(chatId, '⏳ Начинаю массовую рассылку...');

                    const result = await sendMassMessage(text);

                    const report = `📊 *ОТЧЕТ О РАССЫЛКЕ*\n\n` +
                                 `✅ *Отправлено:* ${result.sentCount}\n` +
                                 `❌ *Не отправлено:* ${result.failedCount}\n` +
                                 `📈 *Охват:* ${((result.sentCount / result.total) * 100).toFixed(1)}%\n` +
                                 `🕐 *Время:* ${new Date().toLocaleString('ru-RU')}`+
                                 `Support- @Suports_Investment`;

                    await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
                    userStates.delete(telegramId);

                } else if (userState === 'awaiting_add_admin') {
                    if (text.toLowerCase() === 'отмена') {
                        userStates.delete(telegramId);
                        await bot.sendMessage(chatId, '❌ Назначение отменено.');
                        return;
                    }

                    const newAdminId = text.trim();

                    // Проверяем, что это число
                    if (!/^\d+$/.test(newAdminId)) {
                        await bot.sendMessage(chatId, '❌ Неверный формат ID. ID должен состоять только из цифр.');
                        return;
                    }

                    await bot.sendMessage(chatId, `⏳ Назначаю пользователя ${newAdminId} администратором...`);

                    const result = await addAdmin(newAdminId, telegramId);

                    if (result.success) {
                        await bot.sendMessage(chatId,
                            `✅ *АДМИНИСТРАТОР НАЗНАЧЕН*\n\n` +
                            `Пользователь ${newAdminId} успешно назначен администратором.\n` +
                            `Теперь администраторов: ${result.adminsCount}`+
                            `Support- @Suports_Investment`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await bot.sendMessage(chatId,
                            `❌ *ОШИБКА*\n\n${result.message}`+
                            `Support- @Suports_Investment`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    userStates.delete(telegramId);

                } else if (userState === 'awaiting_remove_admin') {
                    if (text.toLowerCase() === 'отмена') {
                        userStates.delete(telegramId);
                        await bot.sendMessage(chatId, '❌ Снятие отменено.');
                        return;
                    }

                    const removeAdminId = text.trim();

                    // Проверяем, что это число
                    if (!/^\d+$/.test(removeAdminId)) {
                        await bot.sendMessage(chatId, '❌ Неверный формат ID. ID должен состоять только из цифр.');
                        return;
                    }

                    // Проверяем, не пытаемся ли снять главного админа
                    if (removeAdminId === ADMIN_TELEGRAM_ID) {
                        await bot.sendMessage(chatId, '❌ Нельзя снять главного администратора!');
                        userStates.delete(telegramId);
                        return;
                    }

                    await bot.sendMessage(chatId, `⏳ Снимаю права администратора с пользователя ${removeAdminId}...`);

                    const result = await removeAdmin(removeAdminId, telegramId);

                    if (result.success) {
                        await bot.sendMessage(chatId,
                            `✅ *АДМИНИСТРАТОР СНЯТ*\n\n` +
                            `Пользователь ${removeAdminId} снят с администратора.\n` +
                            `Теперь администраторов: ${result.adminsCount}`+
                            `Support- @Suports_Investment`,
                            { parse_mode: 'Markdown' }
                        );
                    } else {
                        await bot.sendMessage(chatId,
                            `❌ *ОШИБКА*\n\n${result.message}`+
                            `Support- @Suports_Investment`,
                            { parse_mode: 'Markdown' }
                        );
                    }

                    userStates.delete(telegramId);
                }
        }
    });

    // Команда /help
    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;

        const response = `📋 *AYUDA*\n\n` +
                        `Este bot envía notificaciones automáticas sobre tus inversiones.\n\n` +
                        `*Comandos disponibles:*\n` +
                        `/start - Mensaje de bienvenida\n` +
                        `/status - Ver estado de notificaciones\n` +
                        `/help - Esta ayuda\n` +
                        `/admin - Панель администратора (только для админов)\n\n` +
                        `Las inversiones se crean desde la web oficial.`;

        await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    });

    // Команда /status
    bot.onText(/\/status/, async (msg) => {
        const chatId = msg.chat.id;

        const db = await loadDatabase();
        const user = Object.values(db.users).find(u => u.telegramId == chatId);

        let response = `📊 *ESTADO DEL SISTEMA*\n\n`;
        response += `*Bot:* ${botInitialized ? 'Activo ✅' : 'Inactivo ❌'}\n`;
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

    // Обработка ошибок бота
    bot.on('polling_error', (error) => {
        console.error('❌ Ошибка polling:', error.message);
    });

    bot.on('webhook_error', (error) => {
        console.error('❌ Ошибка webhook:', error.message);
    });

    console.log('✅ Обработчики бота настроены');
}

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

app.listen(PORT, async () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);

    // Пробуем инициализировать бота
    console.log('🔄 Инициализация бота...');
    const botInitSuccess = await initializeBot();

    if (botInitSuccess) {
        console.log(`✅ Бот успешно инициализирован`);
    } else {
        console.warn('⚠️ Бот не инициализирован, но сервер продолжает работу');
        console.warn('   API endpoints будут доступны, но Telegram функции не работают');
    }

    console.log(`📞 API Health: http://localhost:${PORT}/api/health`);
    console.log(`📊 API Bot Status: http://localhost:${PORT}/api/bot-status`);
    console.log(`👑 Admin ID: ${ADMIN_TELEGRAM_ID}`);
    console.log(`⚡ Admin panel: /admin`);

    // Запускаем проверки каждые 10 минут
    cron.schedule('*/10 * * * *', checkInvestmentProgress);

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

    // Очистка состояний пользователей каждый час
    cron.schedule('0 * * * *', () => {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const statesToDelete = [];

        for (const [userId, state] of userStates.entries()) {
            // Если состояние старше часа, удаляем
            if (typeof state === 'string' || !state.timestamp) {
                // Простая проверка для строковых состояний
                continue;
            }

            if (state.timestamp && state.timestamp < oneHourAgo) {
                statesToDelete.push(userId);
            }
        }

        statesToDelete.forEach(userId => userStates.delete(userId));
        if (statesToDelete.length > 0) {
            console.log(`🧹 Очищено ${statesToDelete.length} состояний пользователей`);
        }
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Apagando...');
    if (botInitialized) {
        bot.stopPolling();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('👋 Recibido SIGTERM, apagando...');
    if (botInitialized) {
        bot.stopPolling();
    }
    process.exit(0);
});