console.log('🚀 Starting application...');

const express = require('express');

// ===========================================
// 1. ЗАПУСК EXPRESS СЕРВЕРА (СРАЗУ)
// ===========================================
const app = express();
const port = process.env.PORT || 8080;

// Базовые middleware
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
});

// Создание инвестиции
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        const { userId, amount, userName } = req.body;

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId и amount обязательны' });
        }

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

        // Отправить уведомление
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

        if (database.users[userId]) {
            database.users[userId].telegramId = parseInt(telegramId);

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

// ===========================================
// 5. ЗАПУСК СЕРВЕРА
// ===========================================
app.listen(port, () => {
    console.log(`✅ Сервер запущен на порту ${port}`);
    console.log(`🌐 Health check: http://localhost:${port}/health`);
});

// ===========================================
// 6. ЗАПУСК БОТА (отдельно)
// ===========================================
setTimeout(() => {
    try {
        console.log('🔧 Запуск бота...');

        const TelegramBot = require('node-telegram-bot-api');

        bot = new TelegramBot(TOKEN, {
            polling: true
        });

        // Команда /start
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name || 'Пользователь';
            const userId = msg.from.id.toString();

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

            bot.sendMessage(chatId, `👋 Привет, ${username}! Бот работает!\n\n` +
                `Используйте /misinversiones для просмотра инвестиций.`);
        });

        // Команда /misinversiones
        bot.onText(/\/misinversiones/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
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
            user.investments.forEach((investment, index) => {
                message += `*#${index + 1}* ${investment.amount} Bs.\n`;
                message += `📊 Рост: рассчитывается...\n`;
                message += `⏳ В процессе\n\n`;
            });

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });

        bot.on('polling_error', (error) => {
            console.error('❌ Ошибка бота:', error.message);
        });

        console.log('✅ Бот запущен успешно!');

        bot.sendMessage(ADMIN_ID, '🤖 Бот запущен и работает!')
            .catch(err => console.log('⚠️ Не удалось отправить сообщение админу'));

    } catch (error) {
        console.error('❌ Ошибка запуска бота:', error.message);
        console.log('⚠️ Сервер продолжает работать без бота');
    }
}, 3000);

// ===========================================
// 7. СИСТЕМА УВЕДОМЛЕНИЙ
// ===========================================
setInterval(() => {
    if (!bot) return;

    try {
        for (const [userId, user] of Object.entries(database.users)) {
            if (!user.investments || user.investments.length === 0) continue;
            if (!user.telegramId) continue;

            user.investments.forEach((investment, index) => {
                const startTime = new Date(investment.startDate).getTime();
                const elapsed = Date.now() - startTime;
                const hoursElapsed = elapsed / (1000 * 60 * 60);

                if (!investment.notifications) {
                    investment.notifications = {
                        purchase: false,
                        twoHours: false,
                        completed: false
                    };
                }

                // Уведомление через 2 часа
                if (hoursElapsed >= 2 && hoursElapsed < 2.166 &&
                    !investment.notifications.twoHours &&
                    !investment.notifications.completed) {

                    const message = `📈 *Ваша инвестиция растет!*\n\n` +
                                  `*Инвестиция #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Прошло:* 2 часа\n` +
                                  `*Рост:* +1200%\n\n` +
                                  `💹 *Через 2 часа: +3258%!*\n` +
                                  `🚀 Скоро максимальная прибыль!\n\n` +
                                  `👉 *Не упустите!*`;

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Уведомление 2ч отправлено ${user.name}`);
                            investment.notifications.twoHours = true;
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка 2ч уведомления: ${error.message}`);
                        });
                }

                // Уведомление о завершении
                if (hoursElapsed >= 4 && !investment.notifications.completed) {
                    const totalProfit = (investment.amount * 32.58).toFixed(2);

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
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка уведомления о завершении: ${error.message}`);
                        });
                }
            });
        }
    } catch (error) {
        console.error('❌ Ошибка системы уведомлений:', error.message);
    }
}, 30000);

// ===========================================
// 8. ОБРАБОТКА ОШИБОК
// ===========================================
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});