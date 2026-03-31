const { JSONFilePreset } = require('lowdb/node');
// This creates a file called db.json automatically
const db = await JSONFilePreset('db.json', { logs: [] });
require('dotenv').config();
const express = require('express');
const { Redactor, DefaultMatchers } = require('pii-redact');
const axios = require('axios');
const helmet = require('helmet');

const app = express();
app.use(express.json());
app.use(helmet()); // Protects against common web vulnerabilities

// 1. Setup the Redactor (The filter)
const redactor = new Redactor({ matchers: DefaultMatchers });

const customShield = (text) => {
    // This looks for things like "password: 123" or "SECRET_KEY = xyz"
    const secretPattern = /(password|secret|key|token|authorization)\s*[:=]\s*[a-zA-Z0-9_-]{4,}/gi;
    
    if (secretPattern.test(text)) {
        return text.replace(secretPattern, "[BLOCK: SENSITIVE_CREDENTIAL]");
    }
    return text;
};

app.post('/ask-ai', async (req, res) => {
    const { prompt } = req.body;

    // 2. Redaction Step (The "Wash" before the "Send")
    const safePrompt = redactor.redact(prompt);
    // Use it in your route
    const filteredPrompt = customShield(safePrompt);

    console.log("Original:", prompt);
    console.log("Cleaned:", filteredPrompt);

    await db.update(({ logs }) => logs.push({
        timestamp: new Date().toISOString(),
        original: prompt,
        was_redacted: prompt !== filteredPrompt
    }));

    try {
        // 3. Send the CLEANED prompt to OpenAI
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: filteredPrompt }]
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
        });

        res.json({
            status: "Success",
            redacted_version: filteredPrompt,
            ai_answer: response.data.choices[0].message.content
        });

    } catch (error) {
        res.status(500).json({ error: "Communication failed" });
    }
});

app.listen(3000, () => console.log("Gateway running on http://localhost:3000"));