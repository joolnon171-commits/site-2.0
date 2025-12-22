console.log('🚀 Iniciando ClapsEarn Bot...');

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs');

// ===========================================
// 1. CONFIGURACIÓN
// ===========================================
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;
const JSONBIN_BIN_ID = '69468d57d0ea881f40361a98';
const JSONBIN_MASTER_KEY = '$2a$10$eCHhQtmSAhD8XqkrlFgE1O6N6OKwgmHrIg.G9hlrkDKIaex3GMuiW';
const API_SECRET = 'clapsearn2024secret';

// ===========================================
// 2. INICIAR EXPRESS SERVIDOR
// ===========================================
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        status: 'API funcionando!',
        time: new Date().toISOString(),
        bot_running: !!bot,
        users_count: Object.keys(database.users).length
    });
});

// ===========================================
// 3. VARIABLES GLOBALES
// ===========================================
let bot = null;
let database = {
    users: {},
    settings: {
        profitRate: 32.58,
        investmentDuration: 4
    },
    stats: {
        totalUsers: 0,
        totalInvested: 0,
        lastUpdate: new Date().toISOString()
    }
};

// ===========================================
// 4. ENDPOINTS DE API
// ===========================================

function verifySecret(req, res, next) {
    const secret = req.headers['x-api-secret'];
    if (secret !== API_SECRET) {
        console.log('❌ Secret incorrecto:', secret);
        return res.status(401).json({ error: 'No autorizado' });
    }
    next();
}

// Login de usuario
app.post('/api/login', verifySecret, async (req, res) => {
    try {
        console.log('🔥 LOGIN REQUEST:', req.body);
        const { userId, userName, telegramId } = req.body;

        if (!userId || !telegramId) {
            return res.status(400).json({ error: 'userId y telegramId son obligatorios' });
        }

        await initializeDatabase();

        let user = database.users[userId];
        if (!user) {
            user = {
                id: userId,
                name: userName || 'Usuario',
                telegramId: parseInt(telegramId),
                balance: 0,
                investments: [],
                createdAt: new Date().toISOString()
            };
            database.users[userId] = user;
            database.stats.totalUsers++;
        } else {
            user.telegramId = parseInt(telegramId);
        }

        await saveDatabase();

        // Enviar notificación de login inmediatamente
        if (bot) {
            console.log('📱 Enviando notificación de login a:', user.telegramId);
            const loginMessage = `✅ *¡Inicio de sesión exitoso!*\n\n` +
                                 `¡Bienvenido a ClapsEarn, ${user.name}!\n\n` +
                                 `Tu cuenta ha sido conectada correctamente.\n` +
                                 `Ahora recibirás notificaciones de tus inversiones.\n\n` +
                                 `🌐 *Abre el sitio web y empieza a invertir!*\n\n` +
                                 `💰 *¡Tu éxito financiero comienza ahora!*`;

            try {
                await bot.sendMessage(user.telegramId, loginMessage, { parse_mode: 'Markdown' });
                console.log(`✅ Notificación de login enviada a ${user.name}`);
            } catch (error) {
                console.error(`❌ Error enviando login: ${error.message}`);
            }
        } else {
            console.log('❌ Bot no disponible para enviar login');
        }

        res.json({ success: true, message: 'Login exitoso' });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Logout de usuario
app.post('/api/logout', verifySecret, async (req, res) => {
    try {
        console.log('🔥 LOGOUT REQUEST:', req.body);
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId es obligatorio' });
        }

        if (database.users[userId] && bot) {
            const user = database.users[userId];

            console.log('📱 Enviando notificación de logout a:', user.telegramId);
            const logoutMessage = `👋 *¡Sesión cerrada exitosamente!*\n\n` +
                                  `Has cerrado tu cuenta en ClapsEarn.\n\n` +
                                  `¡Esperamos verte pronto!\n\n` +
                                  `🌐 *Visítanos nuevamente cuando quieras invertir!*`;

            try {
                await bot.sendMessage(user.telegramId, logoutMessage, { parse_mode: 'Markdown' });
                console.log(`✅ Notificación de logout enviada a ${user.name}`);
            } catch (error) {
                console.error(`❌ Error enviando logout: ${error.message}`);
            }
        }

        res.json({ success: true, message: 'Logout exitoso' });

    } catch (error) {
        console.error('❌ Error en logout:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// Crear inversión
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        console.log('🔥 INVESTMENT REQUEST:', req.body);
        const { userId, amount, userName } = req.body;

        if (!userId || !amount) {
            return res.status(400).json({ error: 'userId y amount son obligatorios' });
        }

        await initializeDatabase();

        let user = database.users[userId];
        if (!user) {
            user = {
                id: userId,
                name: userName || 'Usuario',
                telegramId: null,
                balance: 0,
                investments: [],
                createdAt: new Date().toISOString()
            };
            database.users[userId] = user;
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

        // Enviar notificación de compra inmediatamente
        if (user.telegramId && bot) {
            console.log('📱 Enviando notificación de compra a:', user.telegramId);
            const purchaseMessage = `🎉 *¡Nueva inversión creada!*\n\n` +
                                   `¡Felicidades ${user.name}!\n\n` +
                                   `Has invertido *${investment.amount} Bs.*\n\n` +
                                   `*Detalles:*\n` +
                                   `💰 Monto: ${investment.amount} Bs.\n` +
                                   `📈 Ganancia máxima: +3258%\n` +
                                   `⏰ Duración: 4 horas\n` +
                                   `🔢 Número: #${user.investments.length}\n\n` +
                                   `📊 *Próximas notificaciones:*\n` +
                                   `• En 2 horas: ¡Crecimiento!\n` +
                                   `• En 4 horas: ¡Ganancia máxima!\n\n` +
                                   `🚀 *¡Tu dinero está trabajando!*`;

            try {
                await bot.sendMessage(user.telegramId, purchaseMessage, { parse_mode: 'Markdown' });
                console.log(`✅ Notificación de compra enviada a ${user.name}`);
                investment.notifications.purchase = true;
                await saveDatabase();
            } catch (error) {
                console.error(`❌ Error enviando compra: ${error.message}`);
            }
        } else {
            console.log('❌ Bot no disponible o usuario sin Telegram');
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Inversión creada exitosamente'
        });

    } catch (error) {
        console.error('❌ Error creando inversión:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// ===========================================
// 5. INICIAR SERVIDOR
// ===========================================
app.listen(port, () => {
    console.log(`✅ Servidor iniciado en puerto ${port}`);
    console.log(`🌐 Health check: http://localhost:${port}/health`);
    console.log(`🧪 Test endpoint: http://localhost:${port}/api/test`);
});

// ===========================================
// 6. FUNCIONES DE BASE DE DATOS
// ===========================================

async function initializeDatabase() {
    try {
        if (!database.users) database.users = {};
        if (!database.settings) database.settings = {
            profitRate: 32.58,
            investmentDuration: 4
        };
        if (!database.stats) database.stats = {
            totalUsers: 0,
            totalInvested: 0,
            lastUpdate: new Date().toISOString()
        };
        database.stats.totalUsers = Object.keys(database.users).length;
        database.stats.lastUpdate = new Date().toISOString();
        return true;
    } catch (error) {
        console.error('❌ Error inicializando BD:', error.message);
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
                    console.log('✅ Base de datos cargada desde JSONbin');
                    return;
                }
            }
        } catch (error) {
            console.error('❌ Error cargando desde JSONbin:', error.message);
        }

        if (fs.existsSync('./database.json')) {
            try {
                const localData = fs.readFileSync('./database.json', 'utf8');
                database = JSON.parse(localData);
                await initializeDatabase();
                console.log('✅ Base de datos cargada localmente');
                return;
            } catch (error) {
                console.error('❌ Error con archivo local:', error.message);
            }
        }

        console.log('📝 Creando nueva base de datos');
    } catch (error) {
        console.error('❌ Error crítico cargando BD:', error.message);
    }
}

async function saveDatabase() {
    try {
        await initializeDatabase();
        fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
        console.log('💾 Base de datos guardada localmente');

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
                console.log('✅ Base de datos guardada en JSONbin');
            }
        } catch (error) {
            console.error('❌ Error guardando en JSONbin:', error.message);
        }
    } catch (error) {
        console.error('❌ Error guardando base de datos:', error.message);
    }
}

// ===========================================
// 7. INICIAR BOT DE TELEGRAM
// ===========================================

async function startBot() {
    try {
        console.log('🔧 Iniciando bot de Telegram...');

        // Primero eliminar webhooks si existen
        try {
            await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, {
                timeout: 10000
            });
            console.log('✅ Webhooks eliminados');
        } catch (error) {
            console.log('⚠️ Error eliminando webhooks:', error.message);
        }

        bot = new TelegramBot(TOKEN, {
            polling: true
        });

        // Comando /start
        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username || msg.from.first_name || 'Usuario';

            const welcomeMessage = `¡Bienvenido a ClapsEarn! 🎉\n\n` +
                                  `¡Abre el sitio web e invierte ahora! 🚀\n\n` +
                                  `💰 *Invierte y gana hasta +3258%*\n` +
                                  `⏰ *En solo 4 horas*\n` +
                                  `🔒 *Seguro y confiable*\n\n` +
                                  `🌐 *Visita nuestro sitio web para empezar*\n\n` +
                                  `💎 *¡Tu éxito financiero te espera!*`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '👨‍💼 Contactar al gerente', url: 'https://t.me/tu_manager' }
                ]]
            };

            bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        });

        // Comando de prueba
        bot.onText(/\/test/, (msg) => {
            bot.sendMessage(msg.chat.id, '✅ ¡El bot está funcionando correctamente!');
        });

        bot.on('polling_error', (error) => {
            console.error('❌ Error del bot:', error.message);
        });

        console.log('✅ Bot de Telegram iniciado exitosamente!');

        // Enviar mensaje al admin
        bot.sendMessage(ADMIN_ID, '🤖 ¡Bot ClapsEarn iniciado!\n\n' +
            '✅ Sistema funcionando:\n' +
            '• API de login/logout\n' +
            '• Creación de inversiones\n' +
            '• Notificaciones automáticas\n' +
            '• Base de datos JSONbin\n\n' +
            '🧪 Prueba: /test')
            .catch(err => console.log('⚠️ No se pudo enviar mensaje al admin'));

    } catch (error) {
        console.error('❌ Error iniciando bot:', error.message);
        console.log('⚠️ El servidor continúa sin el bot');
    }
}

// ===========================================
// 8. SISTEMA DE NOTIFICACIONES
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
        if (!bot) {
            console.log('⚠️ Bot no disponible para notificaciones');
            return;
        }

        console.log('🔍 Verificando notificaciones de inversiones...');

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
                }

                // Notificación a las 2 horas
                if (hoursElapsed >= 2 && hoursElapsed < 2.166 &&
                    !investment.notifications.twoHours &&
                    !investment.notifications.completed) {

                    const growth = calculateInvestmentGrowth(investment);
                    const growthMultiplier = growth.toFixed(1);

                    const message = `📈 *¡Tu inversión ha crecido!*\n\n` +
                                  `*Inversión #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Tiempo transcurrido:* 2 horas\n` +
                                  `*Crecimiento actual:* ${growthMultiplier}x\n\n` +
                                  `💹 *¡En 2 horas podrás retirar tu ganancia!*\n` +
                                  `🚀 ¡No esperes más!\n\n` +
                                  `👉 *¡Tu inversión está funcionando!*`;

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Notificación 2h enviada a ${user.name}`);
                            investment.notifications.twoHours = true;
                            saveDatabase();
                        })
                        .catch((error) => {
                            console.error(`❌ Error notificación 2h: ${error.message}`);
                        });
                }

                // Notificación de finalización
                if (isCompleted && !investment.notifications.completed) {
                    const totalProfit = (investment.amount * database.settings.profitRate).toFixed(2);

                    const message = `🏆 *¡Tu inversión alcanzó el límite!*\n\n` +
                                  `*¡Felicidades! Has obtenido el máximo rendimiento*\n\n` +
                                  `*Inversión #${index + 1}:* ${investment.amount} Bs.\n` +
                                  `*Ganancia total:* ${totalProfit} Bs.\n\n` +
                                  `💰 *¡Retira tu ganancia ahora!*\n` +
                                  `📞 Contacta a tu gerente\n` +
                                  `⚡ ¡No esperes más!\n\n` +
                                  `🎊 *¡Felicitaciones por tu éxito!*`;

                    bot.sendMessage(user.telegramId, message, { parse_mode: 'Markdown' })
                        .then(() => {
                            console.log(`✅ Notificación final enviada a ${user.name}`);
                            investment.notifications.completed = true;
                            saveDatabase();
                        })
                        .catch((error) => {
                            console.error(`❌ Error notificación final: ${error.message}`);
                        });
                }
            });
        }

    } catch (error) {
        console.error('❌ Error en sistema de notificaciones:', error.message);
    }
}

// ===========================================
// 9. INICIALIZACIÓN DEL SISTEMA
// ===========================================

async function initialize() {
    console.log('='.repeat(60));
    console.log('🤖 ClapsEarn Bot - Versión con Depuración');
    console.log('🌐 Servidor Express: ACTIVO');
    console.log('📊 Sistema de notificaciones: ACTIVO');
    console.log('💾 Base de datos JSONbin: ACTIVA');
    console.log('🔐 API con seguridad: ACTIVO');
    console.log('='.repeat(60));

    await loadDatabase();

    // Iniciar bot inmediatamente
    await startBot();

    // Iniciar verificación de notificaciones cada 30 segundos
    setInterval(sendInvestmentNotifications, 30000);

    // Guardar base de datos cada 5 minutos
    setInterval(saveDatabase, 5 * 60 * 1000);
}

// Iniciar sistema
initialize();

// Manejo de errores
process.on('uncaughtException', (error) => {
    console.error('❌ Excepción no capturada:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Rechazo no manejado:', reason);
});