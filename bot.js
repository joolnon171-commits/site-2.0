console.log('🚀 Starting minimal bot test...');

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const port = process.env.PORT || 8080;
const TOKEN = '8272381619:AAGy9netoupQboX1WgI5I59fQvZkz_4OlLs';
const ADMIN_ID = 8382571809;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Test bot token
app.get('/test-token', async (req, res) => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`);
        const data = await response.json();

        console.log('Token test result:', data);

        res.json({
            valid: data.ok,
            bot_info: data.ok ? data.result : null,
            error: data.ok ? null : data.description
        });
    } catch (error) {
        console.error('Token test error:', error);
        res.json({ valid: false, error: error.message });
    }
});

// Send test message
app.get('/send-message', async (req, res) => {
    try {
        console.log('Creating bot instance...');
        const bot = new TelegramBot(TOKEN);

        console.log('Sending message to admin...');
        const result = await bot.sendMessage(ADMIN_ID, '🧪 TEST MESSAGE\n\nIf you see this, the bot works!');

        console.log('Message sent successfully:', result);
        res.json({
            success: true,
            message_id: result.message_id,
            text: 'Message sent successfully!'
        });

    } catch (error) {
        console.error('Send message error:', error);
        console.error('Full error:', error.response?.body);
        res.json({
            success: false,
            error: error.message,
            details: error.response?.body
        });
    }
});

// Simple login endpoint
app.post('/login', express.json(), async (req, res) => {
    try {
        const { telegramId, userName } = req.body;
        console.log('Login request:', { telegramId, userName });

        if (!telegramId) {
            return res.status(400).json({ error: 'telegramId required' });
        }

        console.log('Creating bot instance...');
        const bot = new TelegramBot(TOKEN);

        const message = `✅ Login successful!\n\nWelcome ${userName || 'User'}!`;

        console.log('Sending login message to:', telegramId);
        const result = await bot.sendMessage(parseInt(telegramId), message);

        console.log('Login message sent:', result.message_id);
        res.json({
            success: true,
            message_id: result.message_id,
            text: 'Login notification sent!'
        });

    } catch (error) {
        console.error('Login error:', error);
        console.error('Full error:', error.response?.body);
        res.json({
            success: false,
            error: error.message,
            details: error.response?.body
        });
    }
});

app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`🧪 Test token: /test-token`);
    console.log(`📧 Send message: /send-message`);
});