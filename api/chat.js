// In-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10; // 10 requests per minute per IP

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ===== RATE LIMITING =====
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, startTime: now });
    } else {
        const data = rateLimitMap.get(ip);

        if (now - data.startTime < RATE_LIMIT_WINDOW) {
            if (data.count >= MAX_REQUESTS) {
                return res.status(429).json({
                    error: "Too many requests. Please slow down."
                });
            }
            data.count++;
        } else {
            rateLimitMap.set(ip, { count: 1, startTime: now });
        }
    }

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const { messages } = req.body;

    // ===== INPUT VALIDATION =====
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Invalid message format" });
    }

    // Limit to last 8 messages to control token cost
    const limitedMessages = messages.slice(-8);

    for (const msg of limitedMessages) {
        if (!msg.content || typeof msg.content !== "string") {
            return res.status(400).json({ error: "Invalid message content" });
        }

        msg.content = msg.content.trim();

        if (msg.content.length > 500) {
            return res.status(400).json({
                error: "Message too long. Maximum 500 characters."
            });
        }
    }

    try {
        const response = await fetch(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: limitedMessages,
                    temperature: 0.7,
                    max_tokens: 512
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || 'Groq API failed');
        }

        // Return simplified format
        return res.status(200).json({
            reply: data.choices?.[0]?.message?.content || ""
        });

    } catch (error) {
        console.error('Groq API Error:', error.message);
        return res.status(500).json({
            error: 'Internal Server Error'
        });
    }
}
