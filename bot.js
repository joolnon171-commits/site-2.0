const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// 配置常量
const BOT_TOKEN = process.env.BOT_TOKEN || '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '8382571809';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;

// 投资参数
const INVESTMENT_DURATION = 4 * 60 * 60 * 1000; // 4小时
const MAX_PROFIT_PERCENTAGE = 3258; // +3258%

// 初始化Bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 已发送通知缓存（防止重复发送）
const sentNotificationsCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24小时

// 加载数据库
async function loadDatabase() {
    try {
        console.log('📦 Loading database from JSONbin...');
        const response = await axios.get(JSONBIN_URL, {
            headers: {
                'X-Master-Key': JSONBIN_MASTER_KEY,
                'Content-Type': 'application/json'
            }
        });

        if (!response.data || !response.data.record) {
            console.error('❌ Invalid database response');
            return { users: {} };
        }

        const database = response.data.record;

        // 确保数据结构正确
        if (!database.users) database.users = {};
        if (!database.settings) database.settings = { admins: ['Admin'] };

        console.log('✅ Database loaded successfully');
        return database;
    } catch (error) {
        console.error('❌ Error loading database:', error.message);
        return { users: {} };
    }
}

// 保存数据库
async function saveDatabase(database) {
    try {
        const response = await axios.put(
            `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
            database,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': JSONBIN_MASTER_KEY,
                    'X-Bin-Versioning': 'false'
                }
            }
        );
        console.log('✅ Database saved successfully');
        return true;
    } catch (error) {
        console.error('❌ Error saving database:', error.message);
        return false;
    }
}

// 计算当前投资利润
function calculateCurrentProfit(investment) {
    const now = Date.now();
    const startTime = new Date(investment.startDate).getTime();
    const elapsed = now - startTime;

    if (elapsed >= INVESTMENT_DURATION) {
        return MAX_PROFIT_PERCENTAGE; // 达到最大利润
    }

    // 几何级数增长
    const progress = elapsed / INVESTMENT_DURATION;
    const profitPercentage = MAX_PROFIT_PERCENTAGE * (1 - Math.pow(0.5, progress * 2));
    return Math.min(profitPercentage, MAX_PROFIT_PERCENTAGE);
}

// 发送Telegram消息（带防重复检查）
async function sendNotification(chatId, message) {
    try {
        // 检查是否已发送过相同消息
        const cacheKey = `${chatId}_${message.substring(0, 50)}`;
        const lastSent = sentNotificationsCache.get(cacheKey);

        if (lastSent && (Date.now() - lastSent) < CACHE_DURATION) {
            console.log(`⏭️ Skipping duplicate notification for user ${chatId}`);
            return false;
        }

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });

        // 更新缓存
        sentNotificationsCache.set(cacheKey, Date.now());
        console.log(`📨 Notification sent to ${chatId}`);
        return true;
    } catch (error) {
        console.error(`❌ Error sending notification to ${chatId}:`, error.message);
        return false;
    }
}

// 检查并发送投资通知
async function checkAndSendInvestmentNotifications() {
    try {
        console.log('🔍 Checking investment notifications...');
        const database = await loadDatabase();
        const users = database.users;
        let notificationsSent = 0;

        for (const userId in users) {
            const user = users[userId];

            // 用户必须有Telegram ID和投资
            if (!user.telegramId || !user.investments || user.investments.length === 0) {
                continue;
            }

            for (const investment of user.investments) {
                // 确保notifications对象存在
                if (!investment.notifications) {
                    investment.notifications = {
                        purchase: false,
                        twoHours: false,
                        completed: false
                    };
                }

                // 计算投资数据
                const now = Date.now();
                const startTime = new Date(investment.startDate).getTime();
                const elapsed = now - startTime;
                const isCompleted = elapsed >= INVESTMENT_DURATION;
                const profitPercentage = calculateCurrentProfit(investment);
                const hoursElapsed = elapsed / (1000 * 60 * 60);

                // 1. 购买通知（仅一次）
                if (!investment.notifications.purchase && investment.status === 'active') {
                    const purchaseMessage = `🎉 *¡Nueva inversión creada!*\n\n` +
                                          `*Monto:* Bs. ${investment.amount.toFixed(2)}\n` +
                                          `*Retorno máximo:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                                          `*Duración:* 4 horas\n\n` +
                                          `¡Tu inversión ha comenzado a crecer! 🚀`;

                    await sendNotification(user.telegramId, purchaseMessage);
                    investment.notifications.purchase = true;
                    notificationsSent++;
                }

                // 2. 2小时通知（仅一次）
                if (!investment.notifications.twoHours && hoursElapsed >= 2 && !isCompleted) {
                    const twoHourMessage = `📈 *¡Tu inversión está creciendo!*\n\n` +
                                          `*Han pasado:* 2 horas\n` +
                                          `*Crecimiento actual:* +${profitPercentage.toFixed(2)}%\n` +
                                          `*Ganancia actual:* Bs. ${(investment.amount * profitPercentage / 100).toFixed(2)}\n\n` +
                                          `¡Sigue creciendo hasta +${MAX_PROFIT_PERCENTAGE}% en 2 horas más! 💪`;

                    await sendNotification(user.telegramId, twoHourMessage);
                    investment.notifications.twoHours = true;
                    notificationsSent++;
                }

                // 3. 完成通知（仅一次）
                if (!investment.notifications.completed && isCompleted) {
                    const finalProfit = investment.amount * MAX_PROFIT_PERCENTAGE / 100;
                    const totalAmount = investment.amount + finalProfit;

                    const completedMessage = `🏆 *¡INVERSIÓN COMPLETADA!*\n\n` +
                                            `*Inversión inicial:* Bs. ${investment.amount.toFixed(2)}\n` +
                                            `*Ganancia final:* +${MAX_PROFIT_PERCENTAGE}%\n` +
                                            `*Ganancia:* Bs. ${finalProfit.toFixed(2)}\n` +
                                            `*Total:* Bs. ${totalAmount.toFixed(2)}\n\n` +
                                            `*¡ESCRIBE AL ADMINISTRADOR PARA RETIRAR!*\n` +
                                            `Contacta al gestor de inversiones para retirar tus ganancias. 📞`;

                    await sendNotification(user.telegramId, completedMessage);
                    investment.notifications.completed = true;
                    notificationsSent++;
                }
            }
        }

        // 保存更新后的数据库
        if (notificationsSent > 0) {
            await saveDatabase(database);
            console.log(`✅ ${notificationsSent} notifications sent and saved`);
        } else {
            console.log('ℹ️ No notifications to send');
        }

    } catch (error) {
        console.error('❌ Error in notification check:', error.message);
    }
}

// Bot命令处理
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name || 'Usuario';

    const welcomeMessage = `👋 *¡Hola ${firstName}!*\n\n` +
                          `Soy el bot de *Inversiones Bolivia*.\n\n` +
                          `*Funciones:*\n` +
                          `• 📊 Seguimiento de inversiones\n` +
                          `• 🔔 Notificaciones automáticas\n` +
                          `• 📈 Actualizaciones de crecimiento\n` +
                          `• 🏆 Alertas de finalización\n\n` +
                          `Para usar el sistema completo, visita nuestra web a través de Telegram.`;

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// 用户绑定命令
bot.onText(/\/bind (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = match[1];

    // 这里可以添加用户绑定逻辑
    const bindMessage = `🔗 *Vinculación de cuenta*\n\n` +
                       `Tu Telegram ID: \`${telegramId}\`\n\n` +
                       `Para vincular tu cuenta, ingresa a través de la web de Inversiones Bolivia y haz clic en "Conectar Telegram".`;

    await bot.sendMessage(chatId, bindMessage, { parse_mode: 'Markdown' });
});

// 管理员命令
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;

    // 检查是否是管理员
    if (chatId.toString() !== ADMIN_TELEGRAM_ID) {
        await bot.sendMessage(chatId, '❌ No tienes permisos de administrador.');
        return;
    }

    const adminMessage = `👑 *Panel de Administrador*\n\n` +
                        `*Comandos disponibles:*\n` +
                        `/stats - Ver estadísticas del sistema\n` +
                        `/users - Listar todos los usuarios\n` +
                        `/investments - Ver todas las inversiones\n` +
                        `/test - Enviar notificación de prueba`;

    await bot.sendMessage(chatId, adminMessage, { parse_mode: 'Markdown' });
});

// 管理员：系统统计
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId.toString() !== ADMIN_TELEGRAM_ID) {
        return;
    }

    try {
        const database = await loadDatabase();
        const users = Object.values(database.users);
        const totalUsers = users.length;
        const activeUsers = users.filter(u => u.telegramId).length;

        let totalInvestments = 0;
        let totalInvested = 0;
        let activeInvestments = 0;

        users.forEach(user => {
            if (user.investments) {
                totalInvestments += user.investments.length;
                activeInvestments += user.investments.filter(inv =>
                    new Date(inv.startDate).getTime() + INVESTMENT_DURATION > Date.now()
                ).length;
                totalInvested += user.investments.reduce((sum, inv) => sum + inv.amount, 0);
            }
        });

        const statsMessage = `📊 *Estadísticas del Sistema*\n\n` +
                            `*Usuarios totales:* ${totalUsers}\n` +
                            `*Usuarios activos (Telegram):* ${activeUsers}\n` +
                            `*Inversiones totales:* ${totalInvestments}\n` +
                            `*Inversiones activas:* ${activeInvestments}\n` +
                            `*Total invertido:* Bs. ${totalInvested.toFixed(2)}\n` +
                            `*Cache de notificaciones:* ${sentNotificationsCache.size}`;

        await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// 测试通知
bot.onText(/\/test/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId.toString() !== ADMIN_TELEGRAM_ID) {
        return;
    }

    const testMessage = `🧪 *Notificación de prueba*\n\n` +
                       `Hora: ${new Date().toLocaleString()}\n` +
                       `Este es un mensaje de prueba del bot.\n\n` +
                       `✅ Sistema funcionando correctamente.`;

    await sendNotification(chatId, testMessage);
    await bot.sendMessage(chatId, '✅ Notificación de prueba enviada.');
});

// 设置定时任务
cron.schedule('*/10 * * * *', async () => { // 每10分钟检查一次
    console.log('⏰ Running scheduled notification check...');
    await checkAndSendInvestmentNotifications();
});

// 清理缓存定时任务（每天一次）
cron.schedule('0 0 * * *', () => {
    const oneDayAgo = Date.now() - CACHE_DURATION;
    let clearedCount = 0;

    for (const [key, timestamp] of sentNotificationsCache.entries()) {
        if (timestamp < oneDayAgo) {
            sentNotificationsCache.delete(key);
            clearedCount++;
        }
    }

    console.log(`🧹 Cleared ${clearedCount} old cache entries`);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
if (process.env.RAILWAY_ENVIRONMENT) {
    require('http').createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Inversiones Bolivia Bot is running!\n');
    }).listen(PORT, () => {
        console.log(`🚀 Bot running on Railway, port ${PORT}`);
        console.log(`🤖 Bot username: @${bot.options.username}`);
        console.log(`👑 Admin ID: ${ADMIN_TELEGRAM_ID}`);
    });
} else {
    console.log('🤖 Bot started in polling mode');
    console.log(`🤖 Bot username: @${bot.options.username}`);
    console.log(`👑 Admin ID: ${ADMIN_TELEGRAM_ID}`);
    console.log('⏰ Scheduled tasks activated');
}

// 错误处理
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.message);
});

bot.on('webhook_error', (error) => {
    console.error('❌ Webhook error:', error.message);
});

// 处理退出信号
process.on('SIGINT', () => {
    console.log('👋 Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('👋 Terminating bot...');
    bot.stopPolling();
    process.exit(0);
});