const axios = require('axios');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN) {
    console.error('❌ Faltan variable de entorno: BOT_TOKEN');
    process.exit(1);
}

if (!WEBHOOK_URL) {
    console.error('❌ Faltan variable de entorno: WEBHOOK_URL');
    console.log('ℹ️ Para configurar webhook, añade WEBHOOK_URL en .env');
    process.exit(1);
}

async function setupWebhook() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

        const response = await axios.post(url, {
            url: `${WEBHOOK_URL}/bot-webhook/${BOT_TOKEN}`,
            max_connections: 40,
            allowed_updates: ["message", "callback_query"]
        });

        console.log('✅ Webhook configurado:', response.data);

        if (response.data.ok) {
            console.log('🌐 Webhook URL:', WEBHOOK_URL);
            console.log('📊 Descripción:', response.data.description);
            console.log('✅ Webhook configurado correctamente');
            
            // Получаем информацию о вебхуке
            const infoResponse = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
            console.log('📋 Información del webhook:', infoResponse.data.result);
        } else {
            console.error('❌ Error al configurar webhook:', response.data);
        }
    } catch (error) {
        console.error('❌ Error configurando webhook:', error.message);
        if (error.response) {
            console.error('📋 Detalles del error:', error.response.data);
        }
    }
}

// Удаление вебхука (опционально)
async function deleteWebhook() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
        const response = await axios.get(url);
        console.log('🗑️ Webhook eliminado:', response.data);
    } catch (error) {
        console.error('❌ Error eliminando webhook:', error.message);
    }
}

// Получение информации о вебхуке
async function getWebhookInfo() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
        const response = await axios.get(url);
        console.log('📋 Información del webhook:', response.data.result);
    } catch (error) {
        console.error('❌ Error obteniendo información:', error.message);
    }
}

// Обработка аргументов командной строки
const command = process.argv[2];

switch (command) {
    case 'delete':
        console.log('🗑️ Eliminando webhook...');
        deleteWebhook();
        break;
    case 'info':
        console.log('📋 Obteniendo información del webhook...');
        getWebhookInfo();
        break;
    case 'setup':
    default:
        console.log('⚙️ Configurando webhook...');
        setupWebhook();
        break;
}