const chrono = require('chrono-node');

// Convert Bengali digits (০-৯) to English digits (0-9)
function bengaliToEnglishDigits(str) {
    const bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return str.replace(/[০-৯]/g, d => bn.indexOf(d));
}

// Check if message is a friendly greeting or status check
function isGreeting(text) {
    const clean = text.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF\s]/g, '').trim();
    const greetings = [
        'hi', 'hello', 'hey', 'hei', 'salam', 'assalamu alaikum', 'assalamualikum',
        'acho', 'achis', 'achho', 'kemon acho', 'kemon achis', 'ki obostha', 'ki khobor',
        'আছো', 'আছিস', 'কেমন আছো', 'কেমন আছিস', 'সালাম', 'আসসালামু আলাইকুম', 'কি অবস্থা', 'কি খবর'
    ];
    return greetings.includes(clean);
}

function getFormattedDhakaTime() {
    const d = new Date();
    const offset = 6 * 60; // UTC+6
    const dhakaTime = new Date(d.getTime() + (offset + d.getTimezoneOffset()) * 60000);
    const y = dhakaTime.getFullYear();
    const m = String(dhakaTime.getMonth() + 1).padStart(2, '0');
    const day = String(dhakaTime.getDate()).padStart(2, '0');
    const h = String(dhakaTime.getHours()).padStart(2, '0');
    const min = String(dhakaTime.getMinutes()).padStart(2, '0');
    const s = String(dhakaTime.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}:${s} (${y}-${m}-${day}, Month: ${m}, Year: ${y})`;
}

/**
 * Smart Rule-based parser for quick durations
 */
function parseRuleBased(input) {
    let text = bengaliToEnglishDigits(input.trim());

    // Clean common prefixes
    text = text.replace(/^\/(?:remind|reminder)\s+/i, '');
    text = text.replace(/^(?:remind|reminder)\s+(?:me\s+)?/i, '');
    text = text.replace(/^(?:আমাকে|amake)\s+/i, '');

    // Pattern 1: Relative duration in Bangla / Banglish / English
    // Notice: "pore" before "por", "পরে" before "পর"
    const relRegex = /^(\d+)\s*(seconds|second|secs|sec|সেকেন্ড|s|minutes|minute|mins|min|মিনিট|m|hours|hour|hrs|hr|ঘণ্টা|ঘন্টা|ghonta|h|days|day|দিন|din|d)\s*(?:pore|por|পরে|পর|after|later)?\s*(.*)$/i;
    const relMatch = text.match(relRegex);

    if (relMatch) {
        const amount = parseInt(relMatch[1], 10);
        const unitRaw = relMatch[2].toLowerCase();
        let taskText = relMatch[3].trim() || 'Reminder';

        taskText = taskText.replace(/(?:মনে\s*করায়\s*দিও|মনে\s*করিয়ে\s*দিও|mone\s*koriye\s*dio|mone\s*koraio|remind\s*me)$/i, '').trim();

        let ms = 0;
        if (/^(seconds|second|secs|sec|সেকেন্ড|s)$/i.test(unitRaw)) ms = amount * 1000;
        else if (/^(minutes|minute|mins|min|মিনিট|m)$/i.test(unitRaw)) ms = amount * 60 * 1000;
        else if (/^(hours|hour|hrs|hr|ঘণ্টা|ঘন্টা|ghonta|h)$/i.test(unitRaw)) ms = amount * 60 * 60 * 1000;
        else if (/^(days|day|দিন|din|d)$/i.test(unitRaw)) ms = amount * 24 * 60 * 60 * 1000;

        const targetDate = new Date(Date.now() + ms);
        return {
            targetDate,
            taskText: taskText || 'Reminder',
            repeatCount: 1,
            repeatIntervalSeconds: 0,
            humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })
        };
    }

    // Pattern 2: Natural English with chrono-node
    const chronoResults = chrono.parse(text, new Date(), { forwardDate: true });
    if (chronoResults && chronoResults.length > 0) {
        const result = chronoResults[0];
        const targetDate = result.start.date();
        let taskText = text.replace(result.text, '').trim();
        taskText = taskText.replace(/^(to|for|about)\s+/i, '').trim();

        if (targetDate.getTime() > Date.now()) {
            return {
                targetDate,
                taskText: taskText || 'Reminder',
                repeatCount: 1,
                repeatIntervalSeconds: 0,
                humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })
            };
        }
    }

    return null;
}

/**
 * Multi-model Gemini AI Parser with repeated reminder support
 */
async function parseWithGemini(input) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.8-flash'
    ];

    const formattedDhaka = getFormattedDhakaTime();
    const prompt = `You are an intelligent reminder assistant. Current date & time in Dhaka timezone (+06:00) is: ${formattedDhaka}.
Analyze the user's input (can be Bengali, Banglish, or English).
The user might ask for a single reminder OR repeated reminders (e.g. "5 min pore 3 bar 10 sec por por reminder diba", "remind me 3 times every 1 minute", "কাল সকালে মনে করাইস").

Extract:
1. taskText: the exact task description in the user's language (use 'Reminder' if no specific task is specified).
2. targetISO: exact ISO-8601 timestamp with offset (+06:00) for the FIRST reminder. If the user mentions morning without an hour, default to 08:00:00.
3. repeatCount: integer, total times to remind (default 1, max 10).
4. repeatIntervalSeconds: integer, gap in seconds between repeated reminders (default 0).

User input: "${input}"

Respond ONLY with valid JSON in this format:
{"success": true, "taskText": "...", "targetISO": "YYYY-MM-DDTHH:mm:ss+06:00", "repeatCount": 1, "repeatIntervalSeconds": 0}
If not a reminder or time cannot be determined, respond:
{"success": false}`;

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!res.ok) {
                console.warn(`[AI Parser] Model ${model} returned status ${res.status}, trying fallback...`);
                continue;
            }

            const data = await res.json();
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) continue;

            const parsed = JSON.parse(jsonText);
            if (parsed.success && parsed.targetISO) {
                const targetDate = new Date(parsed.targetISO);
                if (targetDate.getTime() > Date.now()) {
                    return {
                        targetDate,
                        taskText: parsed.taskText || 'Reminder',
                        repeatCount: Math.min(Math.max(parseInt(parsed.repeatCount, 10) || 1, 1), 10),
                        repeatIntervalSeconds: Math.max(parseInt(parsed.repeatIntervalSeconds, 10) || 0, 0),
                        humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })
                    };
                }
            }
        } catch (e) {
            console.error(`[AI Parser] Error with ${model}:`, e.message);
        }
    }

    return null;
}

/**
 * Master parser
 */
async function parseReminder(rawInput) {
    if (!rawInput) return null;

    let clean = rawInput.trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();

    // Check if input contains repeat or conversational words (e.g. "bar", "বার", "por por", "পর পর", "okay", "দিবা")
    const isComplex = /\b(bar|বার|por\s*por|পর\s*পর|repeat|every|times|okay|দিবা|দিও|diba|dio)\b/i.test(clean);

    // If it's a complex or repeating sentence, prioritize Gemini AI
    if (isComplex && process.env.GEMINI_API_KEY) {
        const aiResult = await parseWithGemini(clean);
        if (aiResult) return aiResult;
    }

    // Otherwise try fast rule-based parser
    const ruleResult = parseRuleBased(clean);
    if (ruleResult) return ruleResult;

    // Fallback to Gemini AI
    const aiResult = await parseWithGemini(clean);
    if (aiResult) return aiResult;

    return null;
}

module.exports = {
    parseReminder,
    isGreeting
};
