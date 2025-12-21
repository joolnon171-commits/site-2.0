const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

// Загрузка переменных окружения
require('dotenv').config();

// Запуск Express сервера немедленно (до инициализации бота)
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Health check endpoint - должен работать всегда
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Запускаем сервер сразу
app.listen(port, () => {
    console.log(`🌐 Сервер запущен на порту ${port}`);
});

// Конфигурация с проверкой переменных
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const API_SECRET = process.env.API_SECRET || 'mySuperSecretKey2024ForBotAPI12345';

// Middleware для проверки API секрета
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

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId и amount обязательны' });
        }

        // Проверяем, что бот инициализирован
        if (!database || !bot) {
            return res.status(503).json({ error: 'Сервис временно недоступен' });
        }

        await initializeDatabase();

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

app.post('/api/connect-telegram', verifySecret, async (req, res) => {
    try {
        const { userId, telegramId } = req.body;

        if (!userId || !telegramId) {
            return res.status(400).json({ error: 'userId и telegramId обязательны' });
        }

        if (!database || !bot) {
            return res.status(503).json({ error: 'Сервис временно недоступен' });
        }

        await initializeDatabase();

        if (database.users[userId]) {
            database.users[userId].telegramId = parseInt(telegramId);
            await saveDatabase();

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

// Проверяем, есть ли все необходимые переменные для запуска бота
let bot = null;
let database = null;

if (TOKEN && ADMIN_ID && JSONBIN_BIN_ID && JSONBIN_MASTER_KEY) {
    console.log('✅ Все переменные окружения найдены, запускаем бота...');
    initializeBot();
} else {
    console.log('⚠️ Некоторые переменные окружения отсутствуют, бот не будет запущен');
    console.log('Отсутствующие переменные:', {
        TOKEN: !TOKEN,
        ADMIN_ID: !ADMIN_ID,
        JSONBIN_BIN_ID: !JSONBIN_BIN_ID,
        JSONBIN_MASTER_KEY: !JSONBIN_MASTER_KEY
    });
}

function initializeBot() {
    try {
        // Конфигурация бота
        const options = {
            polling: {
                interval: 1000,
                autoStart: false,
                params: {
                    timeout: 60
                }
            }
        };

        bot = new TelegramBot(TOKEN, options);

        // Инициализация базы данных
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

        database = JSON.parse(JSON.stringify(initialDatabase));
        const sentNotifications = new Map();
        let isPolling = false;

        // Загрузка базы данных
        async function loadDatabase() {
            try {
                const JSONBIN_URL_LATEST = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

                try {
                    const response = await fetch(JSONBIN_URL_LATEST, {
                        headers: {
                            'X-Master-Key': JSONBIN_MASTER_KEY,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.record) {
                            database = data.record;
                            console.log('✅ База данных загружена из JSONbin');
                            return;
                        }
                    }
                } catch (error) {
                    console.error('❌ Ошибка загрузки из JSONbin:', error.message);
                }

                if (fs.existsSync('./database.json')) {
                    try {
                        const localData = fs.readFileSync('./database.json', 'utf8');
                        database = JSON.parse(localData);
                        console.log('✅ База данных загружена из локального файла');
                        return;
                    } catch (error) {
                        console.error('❌ Ошибка с локальным файлом:', error.message);
                    }
                }

                database = JSON.parse(JSON.stringify(initialDatabase));
                console.log('📝 Создана новая база данных');
            } catch (error) {
                console.error('❌ Ошибка загрузки базы данных:', error.message);
                database = JSON.parse(JSON.stringify(initialDatabase));
            }
        }

        // Сохранение базы данных
        async function saveDatabase() {
            try {
                fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
                console.log('💾 База данных сохранена локально');
            } catch (error) {
                console.error('❌ Ошибка сохранения:', error.message);
            }
        }

        // Инициализация базы данных
        async function initializeDatabase() {
            if (!database.users) database.users = {};
            if (!database.settings) database.settings = initialDatabase.settings;
            if (!database.stats) database.stats = initialDatabase.stats;
            database.stats.totalUsers = Object.keys(database.users).length;
            database.stats.lastUpdate = new Date().toISOString();
        }

        // Команда /start
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name || 'Инвестор';
            const userId = msg.from.id.toString();

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

        // Остальные команды бота...
        bot.onText(/\/misinversiones/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();

            try {
                await initializeDatabase();
                const user = database.users[userId];

                if (!user) {
                    bot.sendMessage(chatId, '🔗 Ваш аккаунт не подключен. Используйте /start для подключения.');
                    return;
                }

                if (!user.investments || user.investments.length === 0) {
                    bot.sendMessage(chatId, '📭 У вас нет активных инвестиций.');
                    return;
                }

                let message = `📈 *ВАШИ ИНВЕСТИЦИИ*\n\n`;
                user.investments.forEach((investment, index) => {
                    message += `#${index + 1}: ${investment.amount} Bs.\n`;
                });

                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /misinversiones:', error.message);
                bot.sendMessage(chatId, '❌ Ошибка загрузки инвестиций.');
            }
        });

        // Запуск бота
        loadDatabase().then(() => {
            bot.startPolling();
            console.log('🤖 Бот успешно запущен!');

            if (ADMIN_ID) {
                bot.sendMessage(ADMIN_ID, '🤖 Бот запущен и готов к работе!');
            }
        }).catch(error => {
            console.error('❌ Ошибка запуска бота:', error);
        });

    } catch (error) {
        console.error('❌ Критическая ошибка инициализации бота:', error);
    }
}

// Экспорт для использования в API
module.exports = { bot, database };