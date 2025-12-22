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

// Test endpoint con más info
app.get('/api/test', (req, res) => {
    res.json({
        status: 'API funcionando!',
        time: new Date().toISOString(),
        bot_running: !!bot,
        bot_info: bot ? 'Bot inicializado' : 'Bot no inicializado',
        users_count: Object.keys(database.users).length,
        last_check: new Date().toISOString()
    });
});

// Endpoint para probar envío directo
app.get('/api/send-test', async (req, res) => {
    try {
        if (!bot) {
            return res.status(500).json({ error: 'Bot no inicializado' });
        }

        const testMessage = `🧪 *Mensaje de prueba*\n\n` +
                            `Este es un mensaje de prueba para verificar que el bot funciona.\n\n` +
                            `🕐 Enviado: ${new Date().toLocaleString()}\n` +
                            `🤖 Bot status: Activo`;

        console.log('🧪 Enviando mensaje de prueba al admin...');

        const result = await bot.sendMessage(ADMIN_ID, testMessage, { parse_mode: 'Markdown' });

        console.log('✅ Mensaje de prueba enviado:', result.message_id);

        res.json({
            success: true,
            message: 'Mensaje de prueba enviado',
            message_id: result.message_id
        });

    } catch (error) {
        console.error('❌ Error enviando mensaje de prueba:', error);
        res.status(500).json({ error: error.message });
    }
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

// Login de usuario con debugging mejorado
app.post('/api/login', verifySecret, async (req, res) => {
    try {
        console.log('🔥 LOGIN REQUEST RECIBIDO:', req.body);
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

        // Verificar que el bot esté disponible
        if (!bot) {
            console.log('❌ BOT NO DISPONIBLE para enviar login');
            return res.json({ success: true, message: 'Login exitoso (bot no disponible)' });
        }

        console.log('📱 Intentando enviar notificación de login...');
        console.log('📱 Para telegramId:', user.telegramId);
        console.log('📱 Bot status:', !!bot);

        const loginMessage = `✅ *¡Inicio de sesión exitoso!*\n\n` +
                             `¡Bienvenido a ClapsEarn, ${user.name}!\n\n` +
                             `Tu cuenta ha sido conectada correctamente.\n` +
                             `Ahora recibirás notificaciones de tus inversiones.\n\n` +
                             `🌐 *Abre el sitio web y empieza a invertir!*\n\n` +
                             `💰 *¡Tu éxito financiero comienza ahora!*`;

        try {
            // Verificar que el usuario puede recibir mensajes
            const chatInfo = await bot.getChat(user.telegramId);
            console.log('ℹ️ Chat info:', chatInfo);

            const result = await bot.sendMessage(user.telegramId, loginMessage, { parse_mode: 'Markdown' });
            console.log(`✅ Notificación de login enviada a ${user.name}`);
            console.log('✅ Message ID:', result.message_id);

        } catch (telegramError) {
            console.error('❌ Error específico de Telegram:', telegramError.response?.body || telegramError.message);

            // Si es error de que el usuario no ha iniciado chat con el bot
            if (telegramError.code === 403) {
                console.log('⚠️ El usuario no ha iniciado chat con el bot');
                return res.json({
                    success: true,
                    message: 'Login exitoso (usuario debe iniciar chat con el bot)',
                    requires_chat_start: true
                });
            }

            throw telegramError;
        }

        res.json({ success: true, message: 'Login exitoso y notificación enviada' });

    } catch (error) {
        console.error('❌ Error en login:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// Crear inversión con debugging mejorado
app.post('/api/investment', verifySecret, async (req, res) => {
    try {
        console.log('🔥 INVESTMENT REQUEST RECIBIDO:', req.body);
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

        // Verificar bot y telegramId
        if (!bot) {
            console.log('❌ BOT NO DISPONIBLE para enviar notificación de inversión');
            return res.json({
                success: true,
                investmentId: investment.id,
                message: 'Inversión creada (bot no disponible)'
            });
        }

        if (!user.telegramId) {
            console.log('❌ USUARIO SIN TELEGRAM ID');
            return res.json({
                success: true,
                investmentId: investment.id,
                message: 'Inversión creada (sin Telegram)'
            });
        }

        console.log('📱 Intentando enviar notificación de inversión...');
        console.log('📱 Para telegramId:', user.telegramId);

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
            const result = await bot.sendMessage(user.telegramId, purchaseMessage, { parse_mode: 'Markdown' });
            console.log(`✅ Notificación de compra enviada a ${user.name}`);
            console.log('✅ Message ID:', result.message_id);
            investment.notifications.purchase = true;
            await saveDatabase();

        } catch (telegramError) {
            console.error('❌ Error específico de Telegram:', telegramError.response?.body || telegramError.message);

            if (telegramError.code === 403) {
                console.log('⚠️ El usuario no ha iniciado chat con el bot');
                return res.json({
                    success: true,
                    investmentId: investment.id,
                    message: 'Inversión creada (usuario debe iniciar chat)',
                    requires_chat_start: true
                });
            }

            throw telegramError;
        }

        res.json({
            success: true,
            investmentId: investment.id,
            message: 'Inversión creada y notificación enviada'
        });

    } catch (error) {
        console.error('❌ Error creando inversión:', error);
        res.status(500).json({ error: 'Error del servidor: ' + error.message });
    }
});

// ===========================================
// 5. INICIAR SERVIDOR
// ===========================================
app.listen(port, () => {
    console.log(`✅ Servidor iniciado en puerto ${port}`);
    console.log(`🌐 Health check: http://localhost:${port}/health`);
    console.log(`🧪 Test endpoint: http://localhost:${port}/api/test`);
    console.log(`📧 Test envío: http://localhost:${port}/api/send-test`);
});

// ===========================================
// 6. INICIAR BOT CON MÁXIMA DEPURACIÓN
// ===========================================

async function startBot() {
    try {
        console.log('🔧 Iniciando bot de Telegram...');
        console.log('🔧 Token:', TOKEN.substring(0, 10) + '...');

        // Verificar token primero
        try {
            const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`);
            const data = await response.json();

            if (data.ok) {
                console.log('✅ Token válido');
                console.log('🤖 Bot info:', data.result.first_name, '@' + data.result.username);
            } else {
                throw new Error('Token inválido: ' + data.description);
            }
        } catch (error) {
            console.error('❌ Error verificando token:', error.message);
            throw error;
        }

        // Eliminar webhooks
        try {
            await fetch(`https://api.telegram.org/bot${TOKEN}/deleteWebhook`, {
                timeout: 10000
            });
            console.log('✅ Webhooks eliminados');
        } catch (error) {
            console.log('⚠️ Error eliminando webhooks:', error.message);
        }

        // Iniciar bot
        bot = new TelegramBot(TOKEN, {
            polling: {
                interval: 1000,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });

        // Evento de polling exitoso
        bot.on('polling_error', (error) => {
            console.error('❌ Error de polling:', error.message);
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

        // Comando /test
        bot.onText(/\/test/, (msg) => {
            bot.sendMessage(msg.chat.id, '✅ ¡El bot está funcionando correctamente!');
        });

        // Esperar a que el bot esté listo
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('✅ Bot de Telegram iniciado exitosamente!');

        // Enviar mensaje al admin
        try {
            const result = await bot.sendMessage(ADMIN_ID, '🤖 ¡Bot ClapsEarn iniciado!\n\n' +
                '✅ Sistema funcionando:\n' +
                '• API de login/logout\n' +
                '• Creación de inversiones\n' +
                '• Notificaciones automáticas\n' +
                '• Base de datos JSONbin\n\n' +
                '🧪 Prueba: /test');
            console.log('✅ Mensaje al admin enviado, ID:', result.message_id);
        } catch (error) {
            console.error('❌ Error enviando mensaje al admin:', error.message);
        }

    } catch (error) {
        console.error('❌ Error crítico iniciando bot:', error.message);
        console.log('⚠️ El servidor continuará sin el bot');
    }
}

// ===========================================
// 7. FUNCIONES DE BASE DE DATOS (simplificadas)
// ===========================================

async function initializeDatabase() {
    try {
        if (!database.users) database.users = {};
        database.stats.totalUsers = Object.keys(database.users).length;
        database.stats.lastUpdate = new Date().toISOString();
        return true;
    } catch (error) {
        console.error('❌ Error inicializando BD:', error.message);
        return false;
    }
}

async function saveDatabase() {
    try {
        await initializeDatabase();
        fs.writeFileSync('./database.json', JSON.stringify(database, null, 2));
        console.log('💾 Base de datos guardada localmente');
    } catch (error) {
        console.error('❌ Error guardando base de datos:', error.message);
    }
}

// ===========================================
// 8. INICIALIZACIÓN
// ===========================================

async function initialize() {
    console.log('='.repeat(60));
    console.log('🤖 ClapsEarn Bot - VERSIÓN MÁXIMA DEPURACIÓN');
    console.log('🌐 Servidor Express: ACTIVO');
    console.log('📊 Sistema de notificaciones: ACTIVO');
    console.log('🔍 Depuración máxima: ACTIVA');
    console.log('='.repeat(60));

    // Iniciar bot inmediatamente
    await startBot();
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