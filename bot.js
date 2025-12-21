const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

// Загрузка переменных окружения
require('dotenv').config();

// Конфигурация
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const API_SECRET = process.env.API_SECRET || 'your-secret-key-here';

// Проверка обязательных переменных
if (!TOKEN || !ADMIN_ID || !JSONBIN_BIN_ID || !JSONBIN_MASTER_KEY) {
    console.error('❌ Отсутствуют обязательные переменные окружения!');
    process.exit(1);
}

// Улучшенная конфигурация для избежания ошибок подключения
const options = {
    polling: {
        interval: 1000,
        autoStart: false,
        params: {
            timeout: 60
        }
    },
    request: {
        agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 5,
            maxFreeSockets: 2,
            timeout: 60000,
            family: 4
        }
    }
};

const bot = new TelegramBot(TOKEN, options);

// Конфигурация JSONbin
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
const JSONBIN_URL_LATEST = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// Начальная структура базы данных
const initialDatabase = {
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

// Глобальные переменные
let database = JSON.parse(JSON.stringify(initialDatabase));
const sentNotifications = new Map();
let isPolling = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// =============== API ЭНДПОИНТЫ ДЛЯ САЙТА ===============

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Middleware для проверки API секрета
function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Эндпоинт для создания новой инвестиции
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        const { userId, amount, userName } = req.body;

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId и amount обязательны' });
        }

        await initializeDatabase();

        // Найти или создать пользователя
        let user = database.users[userId];
        if (!user) {
            user = {
                id: userId,
                name: userName || 'Пользователь',
                telegramId: null,
                balance: 0,
                investments: [],
                createdAt: new Date().toISOString(),
                isAdmin: false
            };
            database.users[userId] = user;
            database.stats.totalUsers++;
        }

        // Создать новую инвестицию
        const investment = {
            id: Date.now().toString(),
            amount: parseFloat(amount),
            startDate: new Date().toISOString(),
            status: 'active',
            notifications: {
                purchase: false,
                twoHours: false,
                completed: false
            }
        };

        if (!user.investments) user.investments = [];
        user.investments.push(investment);
        database.stats.totalInvested += investment.amount;

        await saveDatabase();

        // Отправить немедленное уведомление если у пользователя подключен Telegram
        if (user.telegramId) {
            const message = `🎉 *Новая инвестиция создана!*\n\n` +
                          `Вы создали новую инвестицию на сумму *${investment.amount} Bs.*\n\n` +
                          `*Детали:*\n` +
                          `• Сумма: ${investment.amount} Bs.\n` +
                          `• Максимальная прибыль: +3258%\n` +
                          `• Длительность: 4 часа\n` +
                          `• Номер: #${user.investments.length}\n\n` +
                          `📊 *Следующие уведомления:*\n` +
                          `• Через 2 часа: Рост +1200%!\n` +
                          `• Через 4 часа: Максимальная доходность!\n\n` +
                          `Ваши деньги растут! 🚀`;

            bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
            console.log(`✅ Уведомление отправлено ${user.name} о новой инвестиции`);
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Инвестиция успешно создана'
        });

    } catch (error) {
        console.error('❌ Ошибка создания инвестиции:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Эндпоинт для подключения Telegram пользователя
app.post('/api/connect-telegram', verifySecret, async (req, res) => {
    try {
        const { userId, telegramId } = req.body;

        if (!userId || !telegramId) {
            return res.status(400).json({ error: 'userId и telegramId обязательны' });
        }

        await initializeDatabase();

        if (database.users[userId]) {
            database.users[userId].telegramId = parseInt(telegramId);
            await saveDatabase();

            // Отправить приветственное сообщение
            const message = `✅ *Ваш аккаунт подключен!*\n\n` +
                          `Теперь вы будете получать автоматические уведомления о ваших инвестициях.\n\n` +
                          `Используйте /misinversiones для просмотра активных инвестиций.`;

            bot.sendMessage(parseInt(telegramId), message, { parse_mode: 'Markdown' });

            res.json({ success: true, message: 'Telegram успешно подключен' });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }

    } catch (error) {
        console.error('❌ Ошибка подключения Telegram:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Эндпоинт для добавления баланса пользователю
app.post('/api/add-balance', verifySecret, async (req, res) => {
    try {
        const { userId, amount } = req.body;

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId и amount обязательны' });
        }

        await initializeDatabase();

        if (database.users[userId]) {
            database.users[userId].balance += parseFloat(amount);
            await saveDatabase();

            // Уведомить пользователя если у него подключен Telegram
            if (database.users[userId].telegramId) {
                const message = `💰 *Баланс пополнен!*\n\n` +
                              `Ваш баланс пополнен на ${amount} Bs.\n` +
                              `Текущий баланс: ${database.users[userId].balance} Bs.\n\n` +
                              `Время инвестировать! 🚀`;

                bot.sendMessage(database.users[userId].telegramId, message, { parse_mode: 'Markdown' });
            }

            res.json({ success: true, message: 'Баланс успешно пополнен' });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }

    } catch (error) {
        console.error('❌ Ошибка пополнения баланса:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Эндпоинт для проверки здоровья
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Запуск Express сервера
app.listen(port, () => {
    console.log(`🌐 API сервер запущен на порту ${port}`);
});

// =============== ОСНОВНЫЕ ФУНКЦИИ БОТА ===============

// Функция для проверки токена с несколькими методами
async function verifyTokenWithRetry(maxRetries = 5) {
    const methods = [
        async () => {
            const agent = new https.Agent({
                keepAlive: true,
                family: 4,
                timeout: 15000,
                rejectUnauthorized: false
            });

            const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`, {
                agent: agent,
                timeout: 15000
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        },

        async () => {
            return await bot.getMe();
        },

        async () => {
            const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`, {
                timeout: 10000
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        }
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        for (let methodIndex = 0; methodIndex < methods.length; methodIndex++) {
            try {
                console.log(`🔍 Проверка токена (попытка ${attempt}/${maxRetries}, метод ${methodIndex + 1})...`);

                const data = await methods[methodIndex]();

                if (data.ok) {
                    console.log('✅ Токен успешно проверен!');
                    console.log(`📱 Имя: ${data.result.first_name}`);
                    console.log(`🆔 Username: @${data.result.username || 'N/A'}`);
                    return data.result;
                } else {
                    throw new Error(data.description || 'Неверный токен');
                }
            } catch (error) {
                console.error(`❌ Метод ${methodIndex + 1} не удался:`, error.message);

                if (methodIndex === methods.length - 1 && attempt === maxRetries) {
                    throw error;
                }

                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
}

// Инициализация базы данных
async function initializeDatabase() {
    try {
        if (!database.users) database.users = {};
        if (!database.settings) database.settings = initialDatabase.settings;
        if (!database.stats) database.stats = initialDatabase.stats;

        database.stats.totalUsers = Object.keys(database.users).length;
        database.stats.lastUpdate = new Date().toISOString();

        console.log('✅ База данных инициализирована');
        return true;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        return false;
    }
}

// Загрузка базы данных с резервным вариантом
async function loadDatabase() {
    try {
        console.log('🔄 Загрузка базы данных...');

        try {
            const agent = new https.Agent({
                keepAlive: true,
                family: 4,
                timeout: 15000,
                rejectUnauthorized: false
            });

            const response = await fetch(JSONBIN_URL_LATEST, {
                headers: {
                    'X-Master-Key': JSONBIN_MASTER_KEY,
                    'Content-Type': 'application/json'
                },
                agent: agent,
                timeout: 15000
            });

            if (response.ok) {
                const data = await response.json();
                if (data.record) {
                    database = data.record;
                    await initializeDatabase();
                    console.log('✅ База данных загружена из JSONbin');
                    return database;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки из JSONbin:', error.message);
        }

        if (fs.existsSync('./database.json')) {
            try {
                const localData = fs.readFileSync('./database.json', 'utf8');
                database = JSON.parse(localData);
                await initializeDatabase();
                console.log('✅ База данных загружена из локального файла');
                return database;
            } catch (error) {
                console.error('❌ Ошибка с локальным файлом:', error.message);
            }
        }

        database = JSON.parse(JSON.stringify(initialDatabase));
        await initializeDatabase();
        await saveDatabaseLocal();
        console.log('📝 Создана новая база данных');
        return database;

    } catch (error) {
        console.error('❌ Критическая ошибка загрузки базы данных:', error.message);
        database = JSON.parse(JSON.stringify(initialDatabase));
        await initializeDatabase();
        return database;
    }
}

// Сохранение базы данных
async function saveDatabase(data = null) {
    if (data) database = data;
    await initializeDatabase();
    await saveDatabaseLocal();

    try {
        const agent = new https.Agent({
            keepAlive: true,
            family: 4,
            timeout: 15000,
            rejectUnauthorized: false
        });

        const response = await fetch(JSONBIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_MASTER_KEY
            },
            agent: agent,
            timeout: 15000,
            body: JSON.stringify(database)
        });

        if (response.ok) {
            console.log('✅ База данных сохранена в JSONbin');
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Ошибка сохранения в JSONbin:', error.message);
        console.log('📁 Данные сохранены локально');
    }
}

// Локальное сохранение
async function saveDatabaseLocal() {
    try {
        fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
        console.log('💾 База данных сохранена локально');
    } catch (error) {
        console.error('❌ Ошибка локального сохранения:', error.message);
    }
}

// Функция переподключения
async function reconnectBot() {
    if (isPolling) return;

    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        console.error('❌ Достигнуто максимальное количество попыток переподключения');
        console.log('🔄 Перезапуск бота через 1 минуту...');
        setTimeout(() => {
            reconnectAttempts = 0;
            startBot();
        }, 60000);
        return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    console.log(`🔄 Попытка переподключения через ${delay/1000} секунд... (попытка ${reconnectAttempts})`);

    setTimeout(async () => {
        try {
            if (isPolling) {
                await bot.stopPolling();
                isPolling = false;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
            await bot.startPolling();
            isPolling = true;
            console.log('✅ Бот успешно переподключен');
            reconnectAttempts = 0;
        } catch (error) {
            console.error('❌ Ошибка переподключения:', error.message);
            reconnectBot();
        }
    }, delay);
}

// Расчет роста инвестиции
function calculateInvestmentGrowth(investment) {
    const now = new Date().getTime();
    const startTime = new Date(investment.startDate).getTime();
    const elapsed = now - startTime;
    const duration = database.settings.investmentDuration * 60 * 60 * 1000;

    if (elapsed >= duration) return database.settings.profitRate;

    const progress = elapsed / duration;
    const growthPercentage = (database.settings.profitRate - 1) * 100 * (1 - Math.pow(0.5, progress * 2));
    return 1 + (growthPercentage / 100);
}

// Отправка уведомлений об инвестициях
async function sendInvestmentNotifications() {
    try {
        console.log('🔍 Проверка уведомлений...');
        let notificationsSent = 0;
        const now = Date.now();
        let needsSaving = false;

        for (const [userId, user] of Object.entries(database.users)) {
            if (!user.investments || user.investments.length === 0) continue;
            if (!user.telegramId) continue;

            user.investments.forEach((investment, index) => {
                const startTime = new Date(investment.startDate).getTime();
                const elapsed = Date.now() - startTime;
                const hoursElapsed = elapsed / (1000 * 60 * 60);
                const isCompleted = hoursElapsed >= database.settings.investmentDuration;

                if (!investment.notifications) {
                    investment.notifications = {
                        purchase: false,
                        twoHours: false,
                        completed: false
                    };
                    needsSaving = true;
                }

                const notificationKey = `${userId}_${investment.id}`;
                const lastSentTime = sentNotifications.get(notificationKey) || 0;

                // Уведомление о покупке
                if (!investment.notifications.purchase && user.telegramId) {
                    const message = `🎉 *Новая инвестиция создана!*\n\n` +
                                  `Вы создали новую инвестицию на сумму *${investment.amount} Bs.*\n\n` +
                                  `*Детали:*\n` +
                                  `• Сумма: ${investment.amount} Bs.\n` +
                                  `• Максимальная прибыль: +3258%\n` +
                                  `• Длительность: 4 часа\n` +
                                  `• Номер: #${index + 1}\n\n` +
                                  `📊 *Следующие уведомления:*\n` +
                                  `• Через 2 часа: Рост +1200%!\n` +
                                  `• Через 4 часа: Максимальная доходность!\n\n` +
                                  `Ваши деньги растут! 🚀`;

                    sendMessageToUser(user.telegramId, message);
                    console.log(`✅ Уведомление о ПОКУПКЕ отправлено ${user.name}`);

                    investment.notifications.purchase = true;
                    sentNotifications.set(notificationKey + '_purchase', now);
                    notificationsSent++;
                    needsSaving = true;
                }

                // Уведомление через 2 часа
                if (hoursElapsed >= 2 && hoursElapsed < 2.166 &&
                    !investment.notifications.twoHours &&
                    !investment.notifications.completed &&
                    user.telegramId) {

                    const growth = calculateInvestmentGrowth(investment);
                    const growthMultiplier = (growth - 1).toFixed(1);
                    const remainingHours = (database.settings.investmentDuration - hoursElapsed).toFixed(1);

                    const message = `📈 *Ваша инвестиция выросла в ${growthMultiplier} раза!*\n\n` +
                                  `*Инвестиция #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Прошло времени:* 2 часа\n` +
                                  `*Текущий рост:* +${((growth - 1) * 100).toFixed(0)}%\n\n` +
                                  `💹 *Через ${remainingHours} часов вы получите +3258%!!*\n` +
                                  `🚀 Поторопитесь и проверьте вашу прибыль!\n\n` +
                                  `👉 *Не упустите максимальную доходность!*`;

                    sendMessageToUser(user.telegramId, message);
                    console.log(`✅ Уведомление 2 ЧАСА отправлено ${user.name}`);

                    investment.notifications.twoHours = true;
                    sentNotifications.set(notificationKey + '_2h', now);
                    notificationsSent++;
                    needsSaving = true;
                }

                // Уведомление о завершении
                if (isCompleted &&
                    !investment.notifications.completed &&
                    user.telegramId) {

                    const totalProfit = (investment.amount * database.settings.profitRate).toFixed(2);

                    const message = `🏆 *ИНВЕСТИЦИЯ ЗАВЕРШЕНА!*\n\n` +
                                  `*Вы достигли максимальной доходности +3258%!*\n\n` +
                                  `*Инвестиция #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Общая прибыль:* ${totalProfit} Bs.\n\n` +
                                  `💰 *СВЯЖИТЕСЬ С АДМИНИСТРАТОРОМ ДЛЯ ВЫВОДА!*\n` +
                                  `📞 Свяжитесь с менеджером инвестиций\n` +
                                  `✍️ "Напишите администратору"\n\n` +
                                  `Поздравляем с успешной инвестицией! 🎊`;

                    sendMessageToUser(user.telegramId, message);
                    console.log(`✅ Уведомление о ЗАВЕРШЕНИИ отправлено ${user.name}`);

                    investment.notifications.completed = true;
                    sentNotifications.set(notificationKey + '_completed', now);
                    notificationsSent++;
                    needsSaving = true;
                }
            });
        }

        if (needsSaving) {
            await saveDatabase();
        }

        if (notificationsSent > 0) {
            console.log(`📨 Всего отправлено уведомлений: ${notificationsSent}`);
        }

        cleanupOldNotifications();
    } catch (error) {
        console.error('❌ Ошибка в системе уведомлений:', error.message);
    }
}

// Отправка сообщения пользователю
function sendMessageToUser(chatId, message) {
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' })
        .then(() => {
            console.log(`✅ Сообщение доставлено ${chatId}`);
        })
        .catch((error) => {
            console.error(`❌ Ошибка отправки ${chatId}:`, error.message);
        });
}

// Очистка старых уведомлений
function cleanupOldNotifications() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [key, timestamp] of sentNotifications.entries()) {
        if (timestamp < oneDayAgo) {
            sentNotifications.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        console.log(`🧹 Очищено ${cleaned} старых уведомлений`);
    }
}

// =============== КОМАНДЫ БОТА ===============

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name || 'Инвестор';
    const userId = msg.from.id.toString();

    console.log(`👋 Новый пользователь: ${username} (ID: ${chatId})`);

    try {
        await initializeDatabase();
        let user = database.users[userId];

        if (user) {
            user.name = username;
            user.telegramId = chatId;
            await saveDatabase();

            const welcomeBackMessage = `👋 *С возвращением, ${username}!*\n\n` +
                                      `Ваш аккаунт уже подключен к этому Telegram.\n\n` +
                                      `Используйте /miperfil для просмотра информации профиля.\n` +
                                      `Используйте /misinversiones для просмотра инвестиций.\n\n` +
                                      `*Ваш Telegram ID:* ${chatId}`;

            bot.sendMessage(chatId, welcomeBackMessage, { parse_mode: 'Markdown' });
            return;
        }

        user = {
            id: userId,
            name: username,
            telegramId: chatId,
            balance: 0,
            investments: [],
            createdAt: new Date().toISOString(),
            isAdmin: chatId === ADMIN_ID
        };

        database.users[userId] = user;
        database.stats.totalUsers++;
        await saveDatabase();

        const welcomeMessage = `👋 Привет, ${username}!\n\n` +
                              `Добро пожаловать в *Бот Уведомлений Inversiones Bolivia* 🇧🇴\n\n` +
                              `*🚀 Что делает этот бот?*\n` +
                              `• Отправляет уведомления при создании инвестиций\n` +
                              `• Сообщает о росте инвестиций (+1200% через 2ч)\n` +
                              `• Уведомляет о завершении (+3258% через 4ч)\n` +
                              `• Напоминает о выводе прибыли\n\n` +
                              `*🔗 Для подключения аккаунта:*\n` +
                              `1. Зайдите на платформу Inversiones Bolivia\n` +
                              `2. Нажмите "Войти через Telegram"\n` +
                              `3. Готово! Вы будете получать автоматические уведомления\n\n` +
                              `*📊 Доступные команды:*\n` +
                              `/misinversiones - Мои активные инвестиции\n` +
                              `/miperfil - Информация профиля\n` +
                              `/soporte - Связаться с администратором\n` +
                              `/ayuda - Все команды\n\n` +
                              `*Ваш Telegram ID:* ${chatId}\n\n` +
                              `💎 *Ваш финансовый успех - наш приоритет!*`;

        bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });

        if (chatId !== ADMIN_ID) {
            bot.sendMessage(ADMIN_ID, `👤 Новый пользователь:\n\nИмя: ${username}\nID: ${chatId}\nВсего пользователей: ${database.stats.totalUsers}`);
        }
    } catch (error) {
        console.error('❌ Ошибка в /start:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка обработки запроса. Попробуйте еще раз.');
    }
});

// Команда /misinversiones
bot.onText(/\/misinversiones/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name || 'Пользователь';
    const userId = msg.from.id.toString();

    try {
        await initializeDatabase();
        const user = database.users[userId];

        if (!user) {
            const notConnectedMessage = `🔗 *Ваш аккаунт не подключен*\n\n` +
                                      `Для просмотра инвестиций нужно:\n\n` +
                                      `1. Зайдите на платформу Inversiones Bolivia\n` +
                                      `2. Нажмите "Войти через Telegram"\n` +
                                      `3. Готово! Вы сможете видеть инвестиции здесь\n\n` +
                                      `💎 *Без подключения вы получите:*\n` +
                                      `• Уведомления при подключении аккаунта\n` +
                                      `• Поддержку 24/7\n` +
                                      `• Персональные консультации`;

            bot.sendMessage(chatId, notConnectedMessage, { parse_mode: 'Markdown' });
            return;
        }

        if (!user.investments || user.investments.length === 0) {
            const noInvestmentsMessage = `📭 *Нет активных инвестиций*\n\n` +
                                       `Идеальное время для начала!\n\n` +
                                       `✨ *Преимущества инвестирования с нами:*\n` +
                                       `• Максимальная прибыль: *+${(database.settings.profitRate - 1) * 100}%*\n` +
                                       `• Длительность: всего *${database.settings.investmentDuration} часа*\n` +
                                       `• Прогрессивный рост\n` +
                                       `• Безопасно и надежно\n\n` +
                                       `💎 *Пример инвестиции:*\n` +
                                       `Инвестиция: *100 Bs.*\n` +
                                       `Прибыль: *${(100 * (database.settings.profitRate - 1)).toFixed(2)} Bs.*\n` +
                                       `Итого: *${(100 * database.settings.profitRate).toFixed(2)} Bs.*\n\n` +
                                       `🚀 *Ваше финансовое будущее ждет вас!*`;

            bot.sendMessage(chatId, noInvestmentsMessage, { parse_mode: 'Markdown' });
            return;
        }

        let message = `📈 *ВАШИ АКТИВНЫЕ ИНВЕСТИЦИИ*\n\n`;
        let totalInvested = 0;
        let totalCurrentProfit = 0;
        let activeInvestments = 0;

        user.investments.forEach((investment, index) => {
            const growth = calculateInvestmentGrowth(investment);
            const startDate = new Date(investment.startDate);
            const hoursElapsed = (new Date() - startDate) / (1000 * 60 * 60);
            const isCompleted = hoursElapsed >= database.settings.investmentDuration;

            const currentProfit = investment.amount * (growth - 1);
            const profitBs = currentProfit.toFixed(2);
            const growthPercent = ((growth - 1) * 100).toFixed(2);

            totalInvested += investment.amount;
            totalCurrentProfit += currentProfit;
            if (!isCompleted) activeInvestments++;

            message += `*🏦 Инвестиция #${index + 1}*\n`;
            message += `💰 *Сумма:* ${investment.amount} Bs.\n`;
            message += `📅 *Начата:* ${startDate.toLocaleDateString('es-ES')} ${startDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}\n`;
            message += `📊 *Рост:* +${growthPercent}%\n`;
            message += `💵 *Текущая прибыль:* ${profitBs} Bs.\n`;

            if (isCompleted) {
                message += `✅ *ЗАВЕРШЕНА! (+${(database.settings.profitRate - 1) * 100}%)\n`;
                message += `📞 *СВЯЖИТЕСЬ С АДМИНИСТРАТОРОМ ДЛЯ ВЫВОДА!*\n`;
                message += `✍️ "Свяжитесь с менеджером инвестиций"\n`;
            } else if (hoursElapsed >= 2) {
                const remainingHours = (database.settings.investmentDuration - hoursElapsed).toFixed(1);
                message += `🔥 *В росте! (${growth.toFixed(1)}x)\n`;
                message += `⏰ *Осталось времени:* ${remainingHours} часов\n`;
                message += `🎯 *Скоро +${(database.settings.profitRate - 1) * 100}%!*\n`;
            } else {
                const remainingHours = (database.settings.investmentDuration - hoursElapsed).toFixed(1);
                message += `⏳ *В процессе...*\n`;
                message += `⏰ *Осталось времени:* ${remainingHours} часов\n`;
                message += `🚀 *Ваша инвестиция растет!*\n`;
            }

            message += `\n`;
        });

        message += `📊 *ОБЩАЯ СТАТИСТИКА*\n`;
        message += `📈 *Активные инвестиции:* ${activeInvestments}\n`;
        message += `💰 *Всего инвестировано:* ${totalInvested.toFixed(2)} Bs.\n`;
        message += `💵 *Общая текущая прибыль:* ${totalCurrentProfit.toFixed(2)} Bs.\n`;

        if (totalInvested > 0) {
            const totalReturn = (totalCurrentProfit / totalInvested * 100).toFixed(2);
            message += `📈 *Общая доходность:* +${totalReturn}%\n\n`;
        } else {
            message += `\n`;
        }

        if (activeInvestments > 0) {
            message += `🎯 *Так держать! Ваши инвестиции приносят прибыль.*\n`;
        }

        message += `💡 *Совет:* Проверяйте чаще для отслеживания прогресса инвестиций.`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log(`✅ Инвестиции отправлены ${user.name}`);
    } catch (error) {
        console.error('❌ Ошибка в /misinversiones:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка загрузки инвестиций. Попробуйте позже.');
    }
});

// Команда /miperfil
bot.onText(/\/miperfil/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    try {
        await initializeDatabase();
        const user = database.users[userId];

        if (!user) {
            const notConnectedMessage = `🔗 *Ваш аккаунт не подключен*\n\n` +
                                      `*Ваш Telegram ID:* ${chatId}\n\n` +
                                      `*Для подключения аккаунта:*\n` +
                                      `1. Войдите на платформу Inversiones Bolivia\n` +
                                      `2. Нажмите "Войти через Telegram"\n` +
                                      `3. Готово! Вы будете получать автоматические уведомления\n\n` +
                                      `💎 *Преимущества подключения:*\n` +
                                      `• Уведомления в реальном времени\n` +
                                      `• Отслеживание инвестиций\n` +
                                      `• Важные напоминания\n` +
                                      `• Приоритетная поддержка`;

            bot.sendMessage(chatId, notConnectedMessage, { parse_mode: 'Markdown' });
            return;
        }

        const joinDate = new Date(user.createdAt);
        const totalInvestments = user.investments ? user.investments.length : 0;

        let totalProfit = 0;
        if (user.investments) {
            user.investments.forEach(investment => {
                const growth = calculateInvestmentGrowth(investment);
                totalProfit += investment.amount * (growth - 1);
            });
        }

        const totalBalance = user.balance + totalProfit;

        const profileMessage = `👤 *ИНФОРМАЦИЯ ПРОФИЛЯ*\n\n` +
                             `*🏷️ Имя пользователя:* ${user.name}\n` +
                             `*📅 Участник с:* ${joinDate.toLocaleDateString('es-ES')}\n` +
                             `*🔗 Telegram ID:* ${user.telegramId}\n` +
                             `*👑 Тип аккаунта:* ${user.isAdmin ? 'Администратор 👑' : 'Стандартный пользователь'}\n\n` +

                             `💰 *ФИНАНСОВОЕ СОСТОЯНИЕ*\n` +
                             `*💵 Доступный баланс:* ${user.balance.toFixed(2)} Bs.\n` +
                             `*📈 Активные инвестиции:* ${totalInvestments}\n` +
                             `*💎 Прибыль в процессе:* ${totalProfit.toFixed(2)} Bs.\n` +
                             `*🏦 Общий баланс:* ${totalBalance.toFixed(2)} Bs.\n\n`;

        let investmentStats = '';
        if (user.investments && user.investments.length > 0) {
            let completedInvestments = 0;
            let activeInvestments = 0;
            let totalInvestedAmount = 0;

            user.investments.forEach(investment => {
                totalInvestedAmount += investment.amount;
                const hoursElapsed = (new Date() - new Date(investment.startDate)) / (1000 * 60 * 60);
                if (hoursElapsed >= database.settings.investmentDuration) {
                    completedInvestments++;
                } else {
                    activeInvestments++;
                }
            });

            investmentStats = `📊 *СТАТИСТИКА ИНВЕСТИЦИЙ*\n` +
                             `*✅ Завершено:* ${completedInvestments}\n` +
                             `*⏳ В процессе:* ${activeInvestments}\n` +
                             `*💰 Всего инвестировано:* ${totalInvestedAmount.toFixed(2)} Bs.\n\n`;
        }

        const adviceMessage = `💡 *РЕКОМЕНДАЦИИ:*\n`;

        if (user.balance >= database.settings.minInvestment && (!user.investments || user.investments.length === 0)) {
            adviceMessage += `🎯 *У вас есть баланс для инвестиций!*\n`;
            adviceMessage += `Вы можете начать всего с ${database.settings.minInvestment} Bs. и получить +${(database.settings.profitRate - 1) * 100}% за ${database.settings.investmentDuration} часа.\n\n`;
        } else if (user.balance < database.settings.minInvestment && (!user.investments || user.investments.length === 0)) {
            adviceMessage += `💸 *Нужны средства!*\n`;
            adviceMessage += `Ваш баланс ниже минимального (${database.settings.minInvestment} Bs.).\n\n`;
        }

        if (user.investments && user.investments.length > 0) {
            adviceMessage += `📈 *Ваши инвестиции активны!*\n`;
            adviceMessage += `Вы получите уведомления когда:\n`;
            adviceMessage += `• Рост составит +1200% (2 часа)\n`;
            adviceMessage += `• Достигнете +${(database.settings.profitRate - 1) * 100}% (${database.settings.investmentDuration} часа)\n\n`;
        }

        adviceMessage += `🔒 *Ваша информация в безопасности с нами*\n\n` +
                        `🚀 *Продолжайте расти!*`;

        const fullMessage = profileMessage + (investmentStats || '') + adviceMessage;
        bot.sendMessage(chatId, fullMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /miperfil:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка загрузки профиля. Попробуйте позже.');
    }
});

// Команда /soporte
bot.onText(/\/soporte/, (msg) => {
    const chatId = msg.chat.id;

    const supportMessage = `📞 *ПОДДЕРЖКА И СВЯЗЬ*\n\n` +
                          `Нужна помощь? Мы здесь для вас!\n\n` +
                          `*🕒 Время работы:*\n` +
                          `• Понедельник-Воскресенье: 24/7\n` +
                          `• Ответ в течение 1 часа\n\n` +
                          `*❓ Причины для связи:*\n` +
                          `• Вопросы об инвестициях\n` +
                          `• Проблемы с депозитами\n` +
                          `• Запросы на вывод\n` +
                          `• Общие вопросы\n` +
                          `• Технические проблемы\n\n` +
                          `*💡 Перед обращением:*\n` +
                          `1. Проверьте /ayuda для быстрых ответов\n` +
                          `2. Имейте под рукой имя пользователя\n` +
                          `3. Если о платеже - имейте чек\n\n` +
                          `*🚀 Вывод инвестиций:*\n` +
                          `Для вывода прибыли от завершенных инвестиций:\n` +
                          `1. Свяжитесь с администратором\n` +
                          `2. Укажите ваше имя пользователя\n` +
                          `3. Укажите инвестицию для вывода\n` +
                          `4. Получите средства быстро\n\n` +
                          `*🔒 Безопасность:*\n` +
                          `• Никогда не делитесь паролем\n` +
                          `• Связывайтесь только с официальным администратором\n` +
                          `• Осторожнее с теми, кто притворяется нами\n\n` +
                          `*❤️ Мы здесь, чтобы помочь вам преуспеть!*`;

    bot.sendMessage(chatId, supportMessage, { parse_mode: 'Markdown' });
});

// Команда /ayuda
bot.onText(/\/ayuda/, (msg) => {
    const chatId = msg.chat.id;

    const helpMessage = `❓ *ЦЕНТР ПОМОЩИ*\n\n` +
                       `*📋 Доступные команды:*\n` +
                       `/start - Приветственное сообщение\n` +
                       `/misinversiones - Мои активные инвестиции\n` +
                       `/miperfil - Информация профиля\n` +
                       `/soporte - Связаться с администратором\n` +
                       `/ayuda - Это сообщение помощи\n\n` +
                       `*💎 Об уведомлениях:*\n\n` +
                       `*Какие уведомления я получу?*\n` +
                       `• При создании новой инвестиции (1 раз)\n` +
                       `• При росте инвестиции +1200% (2 часа, 1 раз)\n` +
                       `• При достижении +${(database.settings.profitRate - 1) * 100}% (4 часа, 1 раз)\n\n` +
                       `*Как подключить аккаунт?*\n` +
                       `1. Зайдите на веб-платформу\n` +
                       `2. Нажмите "Войти через Telegram"\n` +
                       `3. Готово! Вы будете получать автоматические уведомления\n\n` +
                       `*Не получаете уведомления?*\n` +
                       `1. Проверьте что аккаунт подключен\n` +
                       `2. Убедитесь что есть активные инвестиции\n` +
                       `3. Свяжитесь с поддержкой если проблема осталась\n\n` +
                       `*📈 Об инвестициях:*\n` +
                       `• Максимальная прибыль: +${(database.settings.profitRate - 1) * 100}%\n` +
                       `• Длительность: ${database.settings.investmentDuration} часа\n` +
                       `• Минимум: ${database.settings.minInvestment} Bs.\n` +
                       `• Прогрессивный рост\n\n` +
                       `*🔒 Безопасность:*\n` +
                       `• Telegram ID используется только для уведомлений\n` +
                       `• Мы никогда не просим пароли здесь\n` +
                       `• Транзакции только на веб-платформе\n\n` +
                       `*📞 Нужна дополнительная помощь?*\n` +
                       `Используйте команду /soporte.\n\n` +
                       `*❤️ Ваш финансовый успех - наш приоритет!*`;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// =============== АДМИНИСТРАТИВНЫЕ КОМАНДЫ ===============

// Команда /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        let totalInvested = 0;
        let totalUsers = Object.keys(database.users).length;
        let activeInvestments = 0;

        for (const user of Object.values(database.users)) {
            if (user.investments) {
                user.investments.forEach(investment => {
                    totalInvested += investment.amount;
                    const hoursElapsed = (new Date() - new Date(investment.startDate)) / (1000 * 60 * 60);
                    if (hoursElapsed < database.settings.investmentDuration) {
                        activeInvestments++;
                    }
                });
            }
        }

        const adminMessage = `👑 *ПАНЕЛЬ АДМИНИСТРАТОРА*\n\n` +
                            `📊 *Общая статистика:*\n` +
                            `👥 Всего пользователей: ${totalUsers}\n` +
                            `💰 Всего инвестировано: ${totalInvested.toFixed(2)} Bs.\n` +
                            `📈 Активные инвестиции: ${activeInvestments}\n\n` +

                            `⚙️ *Команды администратора:*\n` +
                            `/adduser <telegram_id> <имя> - Добавить пользователя\n` +
                            `/addbalance <user_id> <сумма> - Добавить баланс\n` +
                            `/addinvestment <user_id> <сумма> - Создать инвестицию\n` +
                            `/listusers - Список всех пользователей\n` +
                            `/stats - Детальная статистика\n` +
                            `/backup - Создать резервную копию БД\n\n` +

                            `🔧 *Настройки:*\n` +
                            `Мин. инвестиция: ${database.settings.minInvestment} Bs.\n` +
                            `Макс. инвестиция: ${database.settings.maxInvestment} Bs.\n` +
                            `Ставка прибыли: +${(database.settings.profitRate - 1) * 100}%\n` +
                            `Длительность: ${database.settings.investmentDuration} часов\n\n` +

                            `💡 *Используйте /stats для деталей*`;

        bot.sendMessage(chatId, adminMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /admin:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка загрузки панели администратора.');
    }
});

// Команда /adduser
bot.onText(/\/adduser (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        const telegramId = match[1];
        const name = match[2];

        const newUser = {
            id: telegramId,
            name: name,
            telegramId: parseInt(telegramId),
            balance: 0,
            investments: [],
            createdAt: new Date().toISOString(),
            isAdmin: false
        };

        database.users[telegramId] = newUser;
        database.stats.totalUsers++;
        await saveDatabase();

        bot.sendMessage(chatId, `✅ Пользователь добавлен:\n\nID: ${telegramId}\nИмя: ${name}`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /adduser:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка добавления пользователя.');
    }
});

// Команда /addbalance
bot.onText(/\/addbalance (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        const userId = match[1];
        const amount = parseFloat(match[2]);

        if (!database.users[userId]) {
            bot.sendMessage(chatId, '❌ Пользователь не найден.');
            return;
        }

        database.users[userId].balance += amount;
        await saveDatabase();

        bot.sendMessage(chatId, `✅ Баланс добавлен:\n\nПользователь: ${database.users[userId].name}\nСумма: ${amount} Bs.\nНовый баланс: ${database.users[userId].balance} Bs.`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /addbalance:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка добавления баланса.');
    }
});

// Команда /addinvestment
bot.onText(/\/addinvestment (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        const userId = match[1];
        const amount = parseFloat(match[2]);

        if (!database.users[userId]) {
            bot.sendMessage(chatId, '❌ Пользователь не найден.');
            return;
        }

        const user = database.users[userId];

        const investment = {
            id: Date.now().toString(),
            amount: amount,
            startDate: new Date().toISOString(),
            status: 'active',
            notifications: {
                purchase: false,
                twoHours: false,
                completed: false
            }
        };

        if (!user.investments) user.investments = [];
        user.investments.push(investment);

        await saveDatabase();

        if (user.telegramId) {
            const notification = `💰 *Новая инвестиция создана администратором!*\n\n` +
                               `Сумма: ${amount} Bs.\n` +
                               `Длительность: ${database.settings.investmentDuration} часов\n` +
                               `Ожидаемая прибыль: +${(amount * (database.settings.profitRate - 1)).toFixed(2)} Bs.\n\n` +
                               `🚀 Ваши деньги работают на вас!`;

            bot.sendMessage(user.telegramId, notification, { parse_mode: 'Markdown' });
        }

        bot.sendMessage(chatId, `✅ Инвестиция создана:\n\nПользователь: ${user.name}\nСумма: ${amount} Bs.`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /addinvestment:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка создания инвестиции.');
    }
});

// Команда /listusers
bot.onText(/\/listusers/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        let message = `👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*\n\n`;

        for (const [userId, user] of Object.entries(database.users)) {
            const investmentsCount = user.investments ? user.investments.length : 0;
            message += `👤 ${user.name}\n`;
            message += `ID: ${userId}\n`;
            message += `Telegram: ${user.telegramId || 'Не подключен'}\n`;
            message += `Баланс: ${user.balance.toFixed(2)} Bs.\n`;
            message += `Инвестиции: ${investmentsCount}\n`;
            message += `Админ: ${user.isAdmin ? 'Да' : 'Нет'}\n\n`;
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /listusers:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка получения списка пользователей.');
    }
});

// Команда /stats
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        let totalInvested = 0;
        let totalProfits = 0;
        let activeInvestments = 0;
        let completedInvestments = 0;

        for (const user of Object.values(database.users)) {
            if (user.investments) {
                user.investments.forEach(investment => {
                    totalInvested += investment.amount;
                    const growth = calculateInvestmentGrowth(investment);
                    totalProfits += investment.amount * (growth - 1);

                    const hoursElapsed = (new Date() - new Date(investment.startDate)) / (1000 * 60 * 60);
                    if (hoursElapsed >= database.settings.investmentDuration) {
                        completedInvestments++;
                    } else {
                        activeInvestments++;
                    }
                });
            }
        }

        const statsMessage = `📊 *ДЕТАЛЬНАЯ СТАТИСТИКА*\n\n` +
                           `👥 *Пользователи:*\n` +
                           `Всего: ${Object.keys(database.users).length}\n\n` +

                           `💰 *Инвестиции:*\n` +
                           `Всего инвестировано: ${totalInvested.toFixed(2)} Bs.\n` +
                           `Сгенерировано прибыли: ${totalProfits.toFixed(2)} Bs.\n` +
                           `Активные: ${activeInvestments}\n` +
                           `Завершенные: ${completedInvestments}\n\n` +

                           `📈 *Доходность:*\n` +
                           `Ставка прибыли: +${(database.settings.profitRate - 1) * 100}%\n` +
                           `Длительность: ${database.settings.investmentDuration} часов\n` +
                           `Средний ROI: ${totalInvested > 0 ? ((totalProfits / totalInvested) * 100).toFixed(2) : 0}%\n\n` +

                           `⏰ *Система:*\n` +
                           `Отправлено уведомлений: ${sentNotifications.size}\n` +
                           `Последнее обновление: ${new Date().toLocaleString('es-ES')}`;

        bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('❌ Ошибка в /stats:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка загрузки статистики.');
    }
});

// Команда /backup
bot.onText(/\/backup/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ У вас нет прав администратора.');
        return;
    }

    try {
        await initializeDatabase();

        const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        const backupPath = `./backups/${backupName}`;

        if (!fs.existsSync('./backups')) {
            fs.mkdirSync('./backups');
        }

        fs.writeFileSync(backupPath, JSON.stringify(database, null, 2));

        bot.sendMessage(chatId, `✅ Бэкап создан:\n\nИмя: ${backupName}\nПуть: ${backupPath}\n\nРазмер: ${(fs.statSync(backupPath).size / 1024).toFixed(2)} KB`);
    } catch (error) {
        console.error('❌ Ошибка в /backup:', error.message);
        bot.sendMessage(chatId, '❌ Ошибка создания бэкапа.');
    }
});

// Обработка текстовых сообщений
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.from.username || msg.from.first_name || 'Пользователь';

    if (text && text.startsWith('/')) return;

    console.log(`💬 Сообщение от ${username}: "${text}"`);

    if (text && text.toLowerCase().includes('привет')) {
        const response = `Привет, ${username}! Я бот уведомлений *Inversiones Bolivia* 🇧🇴\n\n` +
                        `Используйте /start чтобы узнать как подключить аккаунт и /ayuda для всех команд.\n\n` +
                        `*Ваш Telegram ID:* ${chatId}`;

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        return;
    }

    if (text && (text.toLowerCase().includes('инвест') || text.toLowerCase().includes('прибыль'))) {
        const response = `💎 *Информация об инвестициях:*\n\n` +
                        `На нашей платформе мы предлагаем доходность до *+${(database.settings.profitRate - 1) * 100}%* всего за *${database.settings.investmentDuration} часа*.\n\n` +
                        `Для инвестиции нужно:\n` +
                        `1. Войти на нашу веб-платформу\n` +
                        `2. Создать аккаунт или войти\n` +
                        `3. Нажать "Инвестировать сейчас"\n\n` +
                        `Используйте /soporte для конкретных вопросов.`;

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        return;
    }

    if (text && text.trim().length > 0) {
        const response = `🤖 *Бот Уведомлений*\n\n` +
                        `Я получил ваше сообщение. Для лучшего обслуживания:\n\n` +
                        `*Хотите подключить аккаунт?*\n` +
                        `Ваш Telegram ID: ${chatId}\n\n` +
                        `*Основные команды:*\n` +
                        `/start - Как подключить аккаунт\n` +
                        `/miperfil - Ваша информация\n` +
                        `/soporte - Связаться с администратором\n` +
                        `/ayuda - Полная помощь\n\n` +
                        `Или напишите "привет" для начала.`;

        bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    }
});

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('❌ Ошибка polling:', error.message);

    if (error.message.includes('EFATAL') || error.message.includes('ETELEGRAM') || error.message.includes('ECONNRESET')) {
        console.log('⚠️ Обнаружена критическая ошибка, попытка восстановления...');
        isPolling = false;
        reconnectBot();
    }
});

bot.on('webhook_error', (error) => {
    console.error('❌ Ошибка webhook:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Необработанный rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Необработанное исключение:', error);
});

// Основная функция запуска
async function startBot() {
    console.log('='.repeat(60));
    console.log('🤖 Бот Inversiones Bolivia - Полная версия с API');
    console.log('👑 Администратор: ' + ADMIN_ID);
    console.log('📊 Система уведомлений: 1 РАЗ НА СОБЫТИЕ');
    console.log('🕐 Уведомления: Покупка → 2ч → Завершение');
    console.log('🚫 Анти-дублирование: АКТИВИРОВАНО (24ч кэш)');
    console.log('💾 Локальная БД и JSONbin активны');
    console.log('🌐 API эндпоинты для сайта: АКТИВИРОВАНЫ');
    console.log('='.repeat(60));

    await loadDatabase();

    try {
        const botInfo = await verifyTokenWithRetry(5);

        if (botInfo) {
            console.log('✅ Токен успешно проверен!');
            console.log(`📱 Имя: ${botInfo.first_name}`);
            console.log(`🆔 Username: @${botInfo.username || 'N/A'}`);
            console.log('📱 Используйте /start в Telegram для начала');
            console.log('='.repeat(60));

            await bot.startPolling();
            isPolling = true;
            console.log('🚀 Бот запущен и работает корректно!');

            bot.sendMessage(ADMIN_ID, '🤖 Бот успешно запущен\n\nСистема уведомлений:\n• Покупка: 1 раз\n• 2 часа: 1 раз\n• Завершение: 1 раз\n\nAPI для сайта: АКТИВНО\n\nИспользуйте /admin для панели');
        } else {
            throw new Error('Не удалось проверить токен');
        }
    } catch (error) {
        console.error('❌ Критическая ошибка запуска бота:', error.message);
        console.log('\n💡 РЕШЕНИЯ:');
        console.log('1. Проверьте правильность токена');
        console.log('2. Проверьте интернет-соединение');
        console.log('3. Проверьте наличие блокирующего firewall');
        console.log('4. Попробуйте VPN если в стране с ограничениями');
        console.log('\n🔄 Бот продолжит попытки запуска...');

        setTimeout(startBot, 30000);
    }
}

// Запуск интервалов
setInterval(sendInvestmentNotifications, 30000);
setInterval(cleanupOldNotifications, 60 * 60 * 1000);
setInterval(() => saveDatabase(), 5 * 60 * 1000);

// Запуск бота
startBot();