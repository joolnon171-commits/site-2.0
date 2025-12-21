const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const https = require('https');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');

// Запуск Express сервера
const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Secret
const API_SECRET = process.env.API_SECRET || 'mySecretKey2024';

function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Жестко заданные переменные
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
const JSONBIN_BIN_ID = '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';

// Логирование всех API запросов
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
    if (req.body) {
        console.log('📤 Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
    res.json({
        status: 'API работает!',
        time: new Date().toISOString(),
        bot_running: !!bot
    });
});

// Эндпоинт для создания новой инвестиции
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        console.log('🔥 ПОЛУЧЕН ЗАПРОС НА СОЗДАНИЕ ИНВЕСТИЦИИ');

        const { userId, amount, userName } = req.body;

        if (!userId || !amount) {
            console.log('❌ Отсутствуют обязательные поля');
            return res.status(400).json({ error: 'userId и amount обязательны' });
        }

        console.log(`✅ Данные валидны: userId=${userId}, amount=${amount}, userName=${userName}`);

        await initializeDatabase();

        // Найти или создать пользователя
        let user = database.users[userId];
        if (!user) {
            console.log(`👤 Создание нового пользователя: ${userId}`);
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
                purchase: false,  // Важно! Не отправлено уведомление о покупке
                twoHours: false,
                completed: false
            }
        };

        if (!user.investments) user.investments = [];
        user.investments.push(investment);
        database.stats.totalInvested += investment.amount;

        await saveDatabase();
        console.log(`💾 Инвестиция сохранена: ${investment.id}`);

        // Отправить немедленное уведомление если у пользователя подключен Telegram
        if (user.telegramId) {
            console.log(`📱 Отправка уведомления пользователю ${user.telegramId}`);

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

            try {
                await bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' });
                console.log(`✅ Уведомление отправлено ${user.name}`);

                // Помечаем что уведомление отправлено
                investment.notifications.purchase = true;
                await saveDatabase();
            } catch (error) {
                console.error(`❌ Ошибка отправки уведомления: ${error.message}`);
            }
        } else {
            console.log(`⚠️ У пользователя ${userId} не подключен Telegram`);
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Инвестиция успешно создана',
            user_telegram_connected: !!user.telegramId
        });

    } catch (error) {
        console.error('❌ Ошибка создания инвестиции:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Эндпоинт для подключения Telegram пользователя
app.post('/api/connect-telegram', verifySecret, async (req, res) => {
    try {
        console.log('🔗 ПОЛУЧЕН ЗАПРОС НА ПОДКЛЮЧЕНИЕ TELEGRAM');

        const { userId, telegramId } = req.body;

        if (!userId || !telegramId) {
            return res.status(400).json({ error: 'userId и telegramId обязательны' });
        }

        await initializeDatabase();

        if (database.users[userId]) {
            database.users[userId].telegramId = parseInt(telegramId);
            await saveDatabase();
            console.log(`✅ Telegram ${telegramId} подключен к пользователю ${userId}`);

            // Отправить приветственное сообщение
            const message = `✅ *Ваш аккаунт подключен!*\n\n` +
                          `Теперь вы будете получать автоматические уведомления о ваших инвестициях.\n\n` +
                          `Используйте /misinversiones для просмотра активных инвестиций.`;

            try {
                await bot.sendMessage(parseInt(telegramId), message, { parse_mode: 'Markdown' });
                console.log(`✅ Приветственное сообщение отправлено на ${telegramId}`);
            } catch (error) {
                console.error(`❌ Ошибка отправки приветствия: ${error.message}`);
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

// Запускаем сервер
app.listen(port, () => {
    console.log(`🌐 Сервер запущен на порту ${port}`);
});

// Конфигурация бота с защитой от конфликтов
const options = {
    polling: {
        interval: 1000,
        autoStart: false,  // Важно! Не стартуем автоматически
        params: {
            timeout: 60
        }
    }
};

let bot = null;

// Функция безопасного запуска бота
async function startBotSafely() {
    try {
        console.log('🔧 Попытка запуска бота...');

        // Сначала пытаемся остановить все вебхуки (если есть)
        await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, {
            timeout: 10000
        });

        bot = new TelegramBot(TOKEN, options);

        // Запускаем polling с обработкой ошибок
        await bot.startPolling({
            restart: true,
            cancel: false
        });

        console.log('✅ Бот успешно запущен!');

        // Отправляем тестовое сообщение админу
        try {
            await bot.sendMessage(ADMIN_ID, '🤖 Бот запущен успешно!\n\nAPI готов принимать запросы.\nТест: https://your-app.railway.app/api/test');
        } catch (error) {
            console.log('⚠️ Не удалось отправить сообщение админу');
        }

    } catch (error) {
        if (error.message.includes('409')) {
            console.log('⚠️ Обнаружен конфликт (409). Пробуем перезапустить через 10 секунд...');
            setTimeout(startBotSafely, 10000);
        } else {
            console.error('❌ Критическая ошибка запуска бота:', error);
            setTimeout(startBotSafely, 30000);
        }
    }
}

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

// Инициализация базы данных
async function initializeDatabase() {
    try {
        if (!database.users) database.users = {};
        if (!database.settings) database.settings = initialDatabase.settings;
        if (!database.stats) database.stats = initialDatabase.stats;
        database.stats.totalUsers = Object.keys(database.users).length;
        database.stats.lastUpdate = new Date().toISOString();
        return true;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        return false;
    }
}

// Загрузка базы данных
async function loadDatabase() {
    try {
        console.log('🔄 Загрузка базы данных...');

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
        const response = await fetch(JSONBIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_MASTER_KEY
            },
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
        if (!bot) {
            console.log('⚠️ Бот не инициализирован, пропускаем проверку уведомлений');
            return;
        }

        console.log('🔍 Проверка уведомлений...');
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

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Уведомление 2 ЧАСА отправлено ${user.name}`);
                            investment.notifications.twoHours = true;
                            needsSaving = true;
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка отправки 2ч уведомления: ${error.message}`);
                        });

                    notificationsSent++;
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

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Уведомление о ЗАВЕРШЕНИИ отправлено ${user.name}`);
                            investment.notifications.completed = true;
                            needsSaving = true;
                        })
                        .catch((error) => {
                            console.error(`❌ Ошибка отправки уведомления о завершении: ${error.message}`);
                        });

                    notificationsSent++;
                }
            });
        }

        if (needsSaving) {
            await saveDatabase();
        }

        if (notificationsSent > 0) {
            console.log(`📨 Всего отправлено уведомлений: ${notificationsSent}`);
        }

    } catch (error) {
        console.error('❌ Ошибка в системе уведомлений:', error.message);
    }
}

// Основные команды бота (только /start для теста)
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
            await saveDatabase();
        } else {
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
        }

        bot.sendMessage(chatId, `👋 Привет, ${username}! Бот работает!`);
    } catch (error) {
        console.error('❌ Ошибка в /start:', error.message);
    }
});

// Запуск системы
async function initialize() {
    console.log('='.repeat(60));
    console.log('🤖 Бот Inversiones Bolivia - ИСПРАВЛЕННАЯ ВЕРСИЯ');
    console.log('👑 Администратор: ' + ADMIN_ID);
    console.log('🌐 API сервер: АКТИВЕН');
    console.log('📊 Система уведомлений: АКТИВНА');
    console.log('='.repeat(60));

    await loadDatabase();

    // Запускаем бота с задержкой
    setTimeout(startBotSafely, 2000);

    // Запускаем проверку уведомлений
    setInterval(sendInvestmentNotifications, 30000);
    setInterval(() => saveDatabase(), 5 * 60 * 1000);
}

// Запускаем всё
initialize();