
const
axios = require('axios');
require('dotenv').config();

const
BOT_TOKEN = process.env.BOT_TOKEN;
const
WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!BOT_TOKEN | | !WEBHOOK_URL)
{
console.error('❌ Faltan variables de entorno: BOT_TOKEN y WEBHOOK_URL');
process.exit(1);
}

async function
setupWebhook()
{
try {
const url = `https://
    api.telegram.org / bot${BOT_TOKEN} / setWebhook
`;

const
response = await axios.post(url, {
    url: `${WEBHOOK_URL} / bot - webhook /${BOT_TOKEN}
`,
max_connections: 40,
allowed_updates: ["message", "callback_query"]
});

console.log('✅ Webhook configurado:', response.data);

if (response.data.ok)
{
    console.log('🌐 Webhook URL:', WEBHOOK_URL);
console.log('📊 Descripción:', response.data.description);
} else {
    console.error('❌ Error:', response.data);
}
} catch(error)
{
    console.error('❌ Error configurando webhook:', error.message);
}
}

setupWebhook();
