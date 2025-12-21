console.log('🚀 Starting Inversiones Bolivia Bot...');

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs');

// ===========================================
// 1. ЗАПУСК EXPRESS СЕРВЕРА (СРАЗУ)
// ===========================================
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

// Health check - отвечает мгновенно
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
    res.json({
        status: 'API работает!',
        time: new Date().toISOString(),
        bot_running: !!bot
    });
});

// ===========================================
// 2. КОНФИГУРАЦИЯ
// ===========================================
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
const JSONBIN_BIN_ID = '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';
const API_SECRET = 'mySecretKey2024';

// ===========================================
// 3. ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ===========================================
let bot = null;
let database = {
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

const sentNotifications = new Map();

// ===========================================
// 4. API ЭНДПОИНТЫ
// ===========================================

// Middleware для проверки API секрета
function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Логирование API запросов
app.use((req, res, next) => {
    if (req.path.startsWith('/api/') && req.method !== 'GET') {
        console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
        if (req.body && Object.keys(req.body).length > 0) {
            console.log('📤 Body:', JSON.stringify(req.body, null, 2));
        }
    }
    next();
}

// Создание инвестиции с уведомлением
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        const { userId, amount, userName } = req.body;

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId и amount обязательны' });
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
                createdAt: new Date().toISOString()
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

        // Отправляем уведомление
        if (user.telegramId && bot) {
            const message = `🎉 *Новая инвестиция создана!*\n\n` +
                          `Вы создали инвестицию на *${investment.amount} Bs.*\n\n` +
                          `*Детали:*\n` +
                          `• Сумма: ${investment.amount} Bs.\n` +
                          `• Максимальная прибыль: +3258%\n` +
                          `• Длительность: 4 часа\n` +
                          `• Номер: #${user.investments.length}\n\n` +
                          `📊 *Следующие уведомления:*\n` +
                          `• Через 2 часа: Рост +1200%!\n` +
                          `• Через 4 часа: Максимальная доходность!\n\n` +
                          `Ваши деньги растут! 🚀`;

            try {
                await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                console.log(`✅ Уведомление отправлено ${user.name}`);
                investment.notifications.purchase = true;
                await saveDatabase();
            } catch (error) {
                console.error(`❌ Ошибка отправки уведомления: ${error.message}`);
            }
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Инвестиция успешно создана',
            telegram_connected: !!user.telegramId
        });

    } catch (error) {
        console.error('❌ Ошибка создания инвестиции:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Подключение Telegram
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

            if (bot) {
                const message = `✅ *Ваш аккаунт подключен!*\n\n` +
                              `Теперь вы будете получать автоматические уведомления о ваших инвестициях.\n\n` +
                              `Используйте /misinversiones для просмотра активных инвестиций.`;

                try {
                    await bot.sendMessage(parseInt(telegramId), message, { parse_mode: 'Markdown' });
                    console.log(`✅ Приветствие отправлено на ${telegramId}`);
                } catch (error) {
                    console.error(`❌ Ошибка отправки приветствия: ${error.message}`);
                }
            }

            res.json({ success: true, message: 'Telegram успешно подключен' });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }

    } catch (error) {
        console.error('❌ Ошибка подключения Telegram:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Добавление баланса
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

            if (database.users[userId].telegramId && bot) {
                const message = `💰 *Баланс пополнен!*\n\n` +
                              `Ваш баланс пополнен на ${amount} Bs.\n` +
                              `Текущий баланс: ${database.users[userId].balance} Bs.\n\n` +
                              `Время инвестировать! 🚀`;

                try {
                    await bot.sendMessage(database.users[userId].telegramId, message, { parse_mode: 'Markdown' });
                } catch (error) {
                    console.error(`❌ Ошибка отправки уведомления о балансе: ${error.message}`);
                }
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

// ===========================================
// 5. ЗАПУСК СЕРВЕРА
// ===========================================
app.listen(port, () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`🌐 Health check доступен`);
});

// ===========================================
// 6. ФУНКЦИИ БАЗЫ ДАННЫХ
// ===========================================

async function initializeDatabase() {
    try {
        if (!database.users) database.users = {};
        if (!database.settings) database.settings = {
            minInvestment: 10,
            maxInvestment: 50000,
            profitRate: 32.58,
            investmentDuration: 4
        };
        if (!database.stats) database.stats = {
            totalUsers: 0,
            totalInvested: 0,
            totalProfits: 0,
            lastUpdate: new Date().toISOString()
        };
        database.stats.totalUsers = Object.keys(database.users).length;
        database.stats.lastUpdate = new Date().toISOString();
        return true;
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error.message);
        return false;
    }
}

async function loadDatabase() {
    try {
        const JSONBIN_URL_LATEST = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

        try {
            const response = await fetch(JSONBIN_URL_LATEST, {
                headers: {
                    'X-Master-Key': JSONBIN_MASTER_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            if (response.ok) {
                const data = await response.json();
                if (data.record) {
                    database = data.record;
                    await initializeDatabase();
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
                await initializeDatabase();
                console.log('✅ База данных загружена локально');
                return;
            } catch (error) {
                console.error('❌ Ошибка локального файла:', error.message);
            }
        }

        console.log('📝 Создана новая база данных');
    } catch (error) {
        console.error('❌ Ошибка загрузки базы данных:', error.message);
    }
}

async function saveDatabase() {
    try {
        await initializeDatabase();
        fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
        console.log('💾 База данных сохранена локально');

        const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;
        try {
            const response = await fetch(JSONBIN_URL, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': JSONBIN_MASTER_KEY
                },
                body: JSON.stringify(database)
            });

            if (response.ok) {
                console.log('✅ База данных сохранена в JSONbin');
            }
        } catch (error) {
            console.error('❌ Ошибка сохранения в JSONbin:', error.message);
        }
    } catch (error) {
        console.error('❌ Ошибка сохранения базы данных:', error.message);
    }
}

// ===========================================
// 7. ФУНКЦИИ УВЕДОМЛЕНИЙ
// ===========================================

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

async function sendInvestmentNotifications() {
    try {
        if (!bot) return;

        let notificationsSent = 0;
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

                // Уведомление через 2 часа
                if (hoursElapsed >= 2 && hoursElapsed < 2.166 &&
                    !investment.notifications.twoHours &&
                    !investment.notifications.completed) {

                    const growth = calculateInvestmentGrowth(investment);
                    const remainingHours = (database.settings.investmentDuration - hoursElapsed).toFixed(1);

                    const message = `📈 *Ваша инвестиция растет!*\n\n` +
                                  `*Инвестиция #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Прошло:* 2 часа\n` +
                                  `*Рост:* +${((growth - 1) * 100).toFixed(0)}%\n\n` +
                                  `💹 *Через ${remainingHours} часов: +3258%!*\n` +
                                  `🚀 Скоро максимальная прибыль!\n\n` +
                                  `👉 *Не упустите!*`;

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Уведомление 2ч отправлено ${user.name}`);
                            investment.notifications.twoHours = true;
                            needsSaving = true;
                            notificationsSent++;
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка 2ч уведомления: ${error.message}`);
                        });
                }

                // Уведомление о завершении
                if (isCompleted && !investment.notifications.completed) {
                    const totalProfit = (investment.amount * database.settings.profitRate).toFixed(2);

                    const message = `🏆 *ИНВЕСТИЦИЯ ЗАВЕРШЕНА!*\n\n` +
                                  `*Максимальная прибыль +3258%!*\n\n` +
                                  `*Инвестиция #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Общая прибыль:* ${totalProfit} Bs.\n\n` +
                                  `💰 *СВЯЖИТЕСЬ С АДМИНОМ ДЛЯ ВЫВОДА!*\n` +
                                  `📞 Напишите администратору\n\n` +
                                  `🎊 Поздравляем!`;

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Уведомление о завершении отправлено ${user.name}`);
                            investment.notifications.completed = true;
                            needsSaving = true;
                            notificationsSent++;
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка уведомления о завершении: ${error.message}`);
                        });
                }
            });
        }

        if (needsSaving) {
            await saveDatabase();
        }

        if (notificationsSent > 0) {
            console.log(`📨 Отправлено уведомлений: ${notificationsSent}`);
        }

    } catch (error) {
        console.error('❌ Ошибка системы уведомлений:', error.message);
    }
}

// ===========================================
// 8. ЗАПУСК БОТА
// ===========================================

async function startBot() {
    try {
        console.log('🔧 Запуск бота...');

        // Останавливаем вебхуки
        await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, {
            timeout: 10000
        });

        bot = new TelegramBot(TOKEN, {
            polling: true
        });

        // Команда /start
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name || 'Пользователь';
            const userId = msg.from.id.toString();

            try {
                await initializeDatabase();
                let user = database.users[userId];

                if (user) {
                    user.name = username;
                    user.telegramId = chatId;
                } else {
                    user = {
                        id: userId,
                        name: username,
                        telegramId: chatId,
                        balance: 0,
                        investments: [],
                        createdAt: new Date().toISOString()
                    };
                    database.users[userId] = user;
                    database.stats.totalUsers++;
                }

                await saveDatabase();

                const welcomeMessage = `👋 Привет, ${username}!\n\n` +
                                      `Добро пожаловать в *Inversiones Bolivia* 🇧🇴\n\n` +
                                      `*🚀 Что делает бот:*\n` +
                                      `• Уведомляет о создании инвестиций\n` +
                                      `• Сообщает о росте (+1200% через 2ч)\n` +
                                      `• Уведомляет о завершении (+3258% через 4ч)\n\n` +
                                      `*📊 Команды:*\n` +
                                      `/misinversiones - Мои инвестиции\n` +
                                      `/miperfil - Мой профиль\n` +
                                      `/soporte - Поддержка\n` +
                                      `/ayuda - Помощь\n\n` +
                                      `💎 *Ваш финансовый успех - наш приоритет!*`;

                bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /start:', error.message);
            }
        });

        // Команда /misinversiones
        bot.onText(/\/misinversiones/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();

            try {
                await initializeDatabase();
                const user = database.users[userId];

                if (!user) {
                    bot.sendMessage(chatId, '🔗 Ваш аккаунт не подключен. Используйте /start.');
                    return;
                }

                if (!user.investments || user.investments.length === 0) {
                    bot.sendMessage(chatId, '📭 У вас нет активных инвестиций.');
                    return;
                }

                let message = `📈 *ВАШИ ИНВЕСТИЦИИ*\n\n`;
                let totalInvested = 0;
                let activeCount = 0;

                user.investments.forEach((investment, index) => {
                    const growth = calculateInvestmentGrowth(investment);
                    const startDate = new Date(investment.startDate);
                    const hoursElapsed = (new Date() - startDate) / (1000 * 60 * 60);
                    const isCompleted = hoursElapsed >= database.settings.investmentDuration;

                    totalInvested += investment.amount;
                    if (!isCompleted) activeCount++;

                    message += `*#${index + 1}* ${investment.amount} Bs.\n`;
                    message += `📊 Рост: +${((growth - 1) * 100).toFixed(1)}%\n`;

                    if (isCompleted) {
                        message += `✅ ЗАВЕРШЕНА\n`;
                        message += `📞 Свяжитесь с админом для вывода\n`;
                    } else {
                        const remaining = (database.settings.investmentDuration - hoursElapsed).toFixed(1);
                        message += `⏳ Осталось: ${remaining}ч\n`;
                    }
                    message += `\n`;
                });

                message += `📊 *Статистика:*\n` +
                          `Активные: ${activeCount}\n` +
                          `Всего: ${totalInvested.toFixed(2)} Bs.`;

                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /misinversiones:', error.message);
                bot.sendMessage(chatId, '❌ Ошибка загрузки инвестиций.');
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
                    bot.sendMessage(chatId, '🔗 Ваш аккаунт не подключен. Используйте /start.');
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

                const message = `👤 *ПРОФИЛЬ*\n\n` +
                              `*Имя:* ${user.name}\n` +
                              `*Участник с:* ${joinDate.toLocaleDateString('es-ES')}\n` +
                              `*Telegram ID:* ${user.telegramId}\n\n` +
                              `💰 *ФИНАНСЫ:*\n` +
                              `*Баланс:* ${user.balance.toFixed(2)} Bs.\n` +
                              `*Инвестиции:* ${totalInvestments}\n` +
                              `*Прибыль в процессе:* ${totalProfit.toFixed(2)} Bs.\n` +
                              `*Общий баланс:* ${(user.balance + totalProfit).toFixed(2)} Bs.`;

                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /miperfil:', error.message);
                bot.sendMessage(chatId, '❌ Ошибка загрузки профиля.');
            }
        });

        // Команда /soporte
        bot.onText(/\/soporte/, (msg) => {
            const message = `📞 *ПОДДЕРЖКА*\n\n` +
                          `Нужна помощь? Мы здесь 24/7!\n\n` +
                          `*🕒 Время работы:* 24/7\n` +
                          `*⏱ Ответ:* в течение часа\n\n` +
                          `*❓ Вопросы:*\n` +
                          `• Об инвестициях\n` +
                          `• О платежах\n` +
                          `• О выводе средств\n` +
                          `• Технические проблемы\n\n` +
                          `*💡 Перед обращением:*\n` +
                          `1. Проверьте /ayuda\n` +
                          `2. Имейте ID пользователя\n` +
                          `3. Для платежей - чек\n\n` +
                          `*🚀 Вывод:*\n` +
                          `1. Свяжитесь с администратором\n` +
                          `2. Укажите ID пользователя\n` +
                              `3. Укажите инвестицию\n` +
                              `4. Получите средства\n\n` +
                              `*❤️ Мы поможем вам преуспеть!*`;

            bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
        });

        // Команда /ayuda
        bot.onText(/\/ayuda/, (msg) => {
            const message = `❓ *ПОМОЩЬ*\n\n` +
                          `*📋 Команды:*\n` +
                          `/start - Начать\n` +
                          `/misinversiones - Мои инвестиции\n` +
                          `/miperfil - Мой профиль\n` +
                          `/soporte - Поддержка\n` +
                          `/ayuda - Это сообщение\n\n` +
                          `*💎 Уведомления:*\n\n` +
                          `*Что получу?*\n` +
                          `• При создании инвестиции (1 раз)\n` +
                          `• При росте +1200% (2 часа, 1 раз)\n` +
                          `• При +3258% (4 часа, 1 раз)\n\n` +
                          `*Как подключить?*\n` +
                          `1. Зайдите на платформу\n` +
                          `2. Нажмите "Войти через Telegram"\n` +
                          `3. Готово!\n\n` +
                          `*📈 Об инвестициях:*\n` +
                          `• Макс. прибыль: +3258%\n` +
                          `• Длительность: 4 часа\n` +
                          `• Минимум: 10 Bs.\n` +
                          `• Прогрессивный рост\n\n` +
                          `*🔒 Безопасность:*\n` +
                          `• Telegram ID только для уведомлений\n` +
                          `• Мы не просим пароли\n` +
                              `• Транзакции только на сайте\n\n` +
                              `*📞 Нужна помощь?*\n` +
                              `Используйте /soporte.\n\n` +
                              `*❤️ Ваш успех - наш приоритет!*`;

            bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
        });

        // Админ команды
        bot.onText(/\/admin/, async (msg) => {
            if (msg.chat.id !== ADMIN_ID) {
                bot.sendMessage(msg.chat.id, '❌ Нет прав администратора.');
                return;
            }

            try {
                await initializeDatabase();
                let totalInvested = 0;
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

                const message = `👑 *АДМИН ПАНЕЛЬ*\n\n` +
                              `📊 *Статистика:*\n` +
                              `👥 Пользователей: ${Object.keys(database.users).length}\n` +
                              `💰 Инвестировано: ${totalInvested.toFixed(2)} Bs.\n` +
                              `📈 Активные: ${activeInvestments}\n\n` +
                              `⚙️ *Команды:*\n` +
                              `/adduser <id> <имя>\n` +
                              `/addbalance <id> <сумма>\n` +
                              `/addinvestment <id> <сумма>\n` +
                              `/listusers\n` +
                              `/stats\n` +
                              `/backup`;

                bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /admin:', error.message);
            }
        });

        bot.onText(/\/adduser (.+) (.+)/, async (msg, match) => {
            if (msg.chat.id !== ADMIN_ID) return;

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
                    createdAt: new Date().toISOString()
                };

                database.users[telegramId] = newUser;
                database.stats.totalUsers++;
                await saveDatabase();

                bot.sendMessage(msg.chat.id, `✅ Пользователь добавлен:\nID: ${telegramId}\nИмя: ${name}`);
            } catch (error) {
                console.error('❌ Ошибка в /adduser:', error.message);
            }
        });

        bot.onText(/\/addbalance (.+) (.+)/, async (msg, match) => {
            if (msg.chat.id !== ADMIN_ID) return;

            try {
                await initializeDatabase();
                const userId = match[1];
                const amount = parseFloat(match[2]);

                if (database.users[userId]) {
                    database.users[userId].balance += amount;
                    await saveDatabase();
                    bot.sendMessage(msg.chat.id, `✅ Баланс добавлен: ${amount} Bs.`);
                } else {
                    bot.sendMessage(msg.chat.id, '❌ Пользователь не найден.');
                }
            } catch (error) {
                console.error('❌ Ошибка в /addbalance:', error.message);
            }
        });

        bot.onText(/\/addinvestment (.+) (.+)/, async (msg, match) => {
            if (msg.chat.id !== ADMIN_ID) return;

            try {
                await initializeDatabase();
                const userId = match[1];
                const amount = parseFloat(match[2]);

                if (database.users[userId]) {
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
                        const notification = `💰 *Новая инвестиция!*\n\n` +
                                           `Сумма: ${amount} Bs.\n` +
                                           `Длительность: 4 часа\n` +
                                           `Ожидаемая прибыль: +${(amount * (database.settings.profitRate - 1)).toFixed(2)} Bs.\n\n` +
                                           `🚀 Ваши деньги работают!`;

                        bot.sendMessage(user.telegramId, notification, { parse_mode: 'Markdown' });
                    }

                    bot.sendMessage(msg.chat.id, `✅ Инвестиция создана: ${amount} Bs.`);
                } else {
                    bot.sendMessage(msg.chat.id, '❌ Пользователь не найден.');
                }
            } catch (error) {
                console.error('❌ Ошибка в /addinvestment:', error.message);
            }
        });

        bot.onText(/\/listusers/, async (msg) => {
            if (msg.chat.id !== ADMIN_ID) return;

            try {
                await initializeDatabase();
                let message = `👥 *ПОЛЬЗОВАТЕЛИ*\n\n`;

                for (const [userId, user] of Object.entries(database.users)) {
                    const investmentsCount = user.investments ? user.investments.length : 0;
                    message += `👤 ${user.name}\n`;
                    message += `ID: ${userId}\n`;
                    message += `Telegram: ${user.telegramId || 'Не подключен'}\n`;
                    message += `Баланс: ${user.balance.toFixed(2)} Bs.\n`;
                    message += `Инвестиции: ${investmentsCount}\n\n`;
                }

                bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /listusers:', error.message);
            }
        });

        bot.onText(/\/stats/, async (msg) => {
            if (msg.chat.id !== ADMIN_ID) return;

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

                const message = `📊 *СТАТИСТИКА*\n\n` +
                              `👥 Пользователи: ${Object.keys(database.users).length}\n\n` +
                              `💰 Инвестиции:\n` +
                              `Всего: ${totalInvested.toFixed(2)} Bs.\n` +
                              `Прибыль: ${totalProfits.toFixed(2)} Bs.\n` +
                              `Активные: ${activeInvestments}\n` +
                              `Завершенные: ${completedInvestments}\n\n` +
                              `📈 Доходность:\n` +
                              `Ставка: +3258%\n` +
                              `Длительность: 4 часа\n` +
                              `ROI: ${totalInvested > 0 ? ((totalProfits / totalInvested) * 100).toFixed(2) : 0}%`;

                bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
            } catch (error) {
                console.error('❌ Ошибка в /stats:', error.message);
            }
        });

        bot.onText(/\/backup/, async (msg) => {
            if (msg.chat.id !== ADMIN_ID) return;

            try {
                await initializeDatabase();
                const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                const backupPath = `./backups/${backupName}`;

                if (!fs.existsSync('./backups')) {
                    fs.mkdirSync('./backups');
                }

                fs.writeFileSync(backupPath, JSON.stringify(database, null, 2));

                bot.sendMessage(msg.chat.id, `✅ Бэкап создан:\nИмя: ${backupName}`);
            } catch (error) {
                console.error('❌ Ошибка в /backup:', error.message);
            }
        });

        bot.on('polling_error', (error) => {
            console.error('❌ Ошибка бота:', error.message);
        });

        console.log('✅ Бот запущен успешно!');

        bot.sendMessage(ADMIN_ID, '🤖 Бот Inversiones Bolivia запущен!\n\n' +
            '✅ Все системы активны:\n' +
            '• API эндпоинты\n' +
            '• Уведомления\n' +
            '• База данных\n' +
            '• Команды бота\n\n' +
            'Используйте /admin для панели управления')
            .catch(err => console.log('⚠️ Не удалось отправить сообщение админу'));

    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error.message);
        console.log('⚠️ Сервер продолжает работать без бота');
    }
}

// ===========================================
// 9. ИНИЦИАЛИЗАЦИЯ ВСЕЙ СИСТЕМЫ
// ===========================================

async function initialize() {
    console.log('='.repeat(60));
    console.log('🤖 Inversiones Bolivia Bot - ПОЛНАЯ ВЕРСИЯ');
    console.log('👑 Администратор: ' + ADMIN_ID);
    console.log('🌐 Express сервер: АКТИВЕН');
    console.log('📊 Система уведомлений: АКТИВНА');
    console.log('💾 База данных: JSONbin + Локальная');
    console.log('🔐 API с защитой: АКТИВЕН');
    console.log('='.repeat(60));

    // Загружаем базу данных
    await loadDatabase();

    // Запускаем бота через 3 секунды
    setTimeout(startBot, 3000);

    // Запускаем проверку уведомлений каждые 30 секунд
    setInterval(sendInvestmentNotifications, 30000);

    // Сохраняем базу каждые 5 минут
    setInterval(saveDatabase, 5 * 60 * 1000);
}

// ===========================================
// 10. ЗАПУСК ПРИЛОЖЕНИЯ
// ===========================================

initialize();

// Обработка критических ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Критическая ошибка:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Необработанный rejection:', reason);
});