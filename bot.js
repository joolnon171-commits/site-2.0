const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs');

// Запуск Express сервера ПЕРВЫМ
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

// Health check - всегда работает
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
    res.json({
        status: 'Server работает!',
        time: new Date().toISOString(),
        bot_running: !!bot
    });
});

// API Secret
const API_SECRET = 'mySecretKey2024';

function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Логирование API запросов
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
        if (req.body && Object.keys(req.body).length > 0) {
            console.log('📤 Body:', JSON.stringify(req.body, null, 2));
        }
    }
    next();
});

// Эндпоинт для создания инвестиции с уведомлениями
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
                createdAt: new Date().toISOString()
            };
            database.users[userId] = user;
            database.stats.totalUsers++;
        }

        // Создать инвестицию
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

        // Отправить уведомление если у пользователя есть Telegram
        if (user.telegramId && bot) {
            const message = `🎉 *Новая инвестиция создана!*\n\n` +
                          `Вы создали инвестицию на *${investment.amount} Bs.*\n\n` +
                          `*Детали:*\n` +
                          `• Сумма: ${investment.amount} Bs.\n` +
                          `• Прибыль: +3258%\n` +
                          `• Длительность: 4 часа\n` +
                          `• Номер: #${user.investments.length}\n\n` +
                          `📊 *Уведомления:*\n` +
                          `• Через 2 часа: +1200%\n` +
                          `• Через 4 часа: +3258%\n\n` +
                          `Ваши деньги растут! 🚀`;

            try {
                await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                console.log(`✅ Уведомление отправлено ${user.name}`);
                investment.notifications.purchase = true;
                await saveDatabase();
            } catch (error) {
                console.error(`❌ Ошибка отправки: ${error.message}`);
            }
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Инвестиция создана',
            telegram_connected: !!user.telegramId
        });

    } catch (error) {
        console.error('❌ Ошибка создания инвестиции:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Эндпоинт подключения Telegram
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
                              `Теперь вы будете получать уведомления о инвестициях.\n\n` +
                              `Используйте /misinversiones для просмотра.`;

                try {
                    await bot.sendMessage(parseInt(telegramId), message, { parse_mode: 'Markdown' });
                    console.log(`✅ Приветствие отправлено на ${telegramId}`);
                } catch (error) {
                    console.error(`❌ Ошибка приветствия: ${error.message}`);
                }
            }

            res.json({ success: true, message: 'Telegram подключен' });
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }

    } catch (error) {
        console.error('❌ Ошибка подключения Telegram:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Запускаем сервер СРАЗУ
app.listen(port, () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
});

// Конфигурация бота
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
const JSONBIN_BIN_ID = '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';

let bot = null;

// База данных
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

// Инициализация базы данных
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

// Загрузка базы данных
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

// Сохранение базы данных
async function saveDatabase() {
    try {
        await initializeDatabase();
        fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
        console.log('💾 База данных сохранена');

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

// Отправка уведомлений
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

// Запуск бота
async function startBot() {
    try {
        console.log('🔧 Запуск бота...');

        // Останавливаем вебхуки если есть
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

                bot.sendMessage(chatId, `👋 Привет, ${username}! Бот работает!\n\n` +
                    `Используйте /misinversiones для просмотра инвестиций.`);
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

        bot.on('polling_error', (error) => {
            console.error('❌ Ошибка бота:', error.message);
        });

        console.log('✅ Бот запущен успешно!');

        // Отправляем сообщение админу
        bot.sendMessage(ADMIN_ID, '🤖 Бот с уведомлениями запущен!')
            .catch(err => console.log('⚠️ Не удалось отправить сообщение админу'));

    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error.message);
    }
}

// Инициализация
async function initialize() {
    console.log('='.repeat(50));
    console.log('🤖 Бот с уведомлениями');
    console.log('🌐 Сервер: АКТИВЕН');
    console.log('📊 Уведомления: АКТИВНЫ');
    console.log('='.repeat(50));

    await loadDatabase();

    // Запускаем бота через 3 секунды
    setTimeout(startBot, 3000);

    // Запускаем проверку уведомлений каждые 30 секунд
    setInterval(sendInvestmentNotifications, 30000);

    // Сохраняем базу каждые 5 минут
    setInterval(saveDatabase, 5 * 60 * 1000);
}

// Запускаем всё
initialize();

// Обработка ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});