const chrono = require('chrono-node');

// Convert Bengali digits (০-৯) to English digits (0-9)
function bengaliToEnglishDigits(str) {
    if (!str) return '';
    const bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return str.replace(/[০-৯]/g, d => bn.indexOf(d));
}

// Check if message is a friendly greeting or status check
function isGreeting(text) {
    if (!text) return false;
    const clean = text.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF\s]/g, '').trim();
    const greetings = [
        'hi', 'hello', 'hey', 'hei', 'salam', 'assalamu alaikum', 'assalamualikum',
        'acho', 'achis', 'achho', 'kemon acho', 'kemon achis', 'ki obostha', 'ki khobor',
        'আছো', 'আছিস', 'কেমন আছো', 'কেমন আছিস', 'সালাম', 'আসসালামু আলাইকুম', 'কি অবস্থা', 'কি খবর'
    ];
    return greetings.includes(clean);
}

function getDhakaNow() {
    const d = new Date();
    const offset = 6 * 60; // UTC+6
    return new Date(d.getTime() + (offset + d.getTimezoneOffset()) * 60000);
}

function getFormattedDhakaTime() {
    const dhakaTime = getDhakaNow();
    const y = dhakaTime.getFullYear();
    const m = String(dhakaTime.getMonth() + 1).padStart(2, '0');
    const day = String(dhakaTime.getDate()).padStart(2, '0');
    const h = String(dhakaTime.getHours()).padStart(2, '0');
    const min = String(dhakaTime.getMinutes()).padStart(2, '0');
    const s = String(dhakaTime.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}:${s} (${y}-${m}-${day}, Month: ${m}, Year: ${y})`;
}

/**
 * High-Speed Rule-based Parser for Bengali & English
 * Supports relative duration anywhere in text and absolute Bengali/English times
 */
function parseRuleBased(input) {
    if (!input) return null;
    let text = bengaliToEnglishDigits(input.trim());

    // Clean common prefixes
    text = text.replace(/^\/(?:remind|reminder)\s+/i, '')
               .replace(/^(?:remind|reminder)\s+(?:me\s+)?/i, '')
               .replace(/^(?:আমাকে|amake)\s+/i, '');

    const nowDhaka = getDhakaNow();

    // 1. Relative Duration anywhere in the string
    // Matches: '10 মিনিট পর ওষুধ খাব', 'ওষুধ খাব ১০ মিনিট পর', 'in 15 minutes call boss'
    const relRegex = /(?:in\s+)?(\d+)\s*(seconds|second|secs|sec|সেকেন্ড|s|minutes|minute|mins|min|মিনিট|m|hours|hour|hrs|hr|ঘণ্টা|ঘন্টা|ghonta|h|days|day|দিন|din|d)\s*(?:pore|por|পরে|পর|after|later)?/i;
    const relMatch = text.match(relRegex);

    if (relMatch) {
        const amount = parseInt(relMatch[1], 10);
        const unit = relMatch[2].toLowerCase();

        let ms = 0;
        if (/^(seconds|second|secs|sec|সেকেন্ড|s)$/i.test(unit)) ms = amount * 1000;
        else if (/^(minutes|minute|mins|min|মিনিট|m)$/i.test(unit)) ms = amount * 60 * 1000;
        else if (/^(hours|hour|hrs|hr|ঘণ্টা|ঘন্টা|ghonta|h)$/i.test(unit)) ms = amount * 60 * 60 * 1000;
        else if (/^(days|day|দিন|din|d)$/i.test(unit)) ms = amount * 24 * 60 * 60 * 1000;

        let task = text.replace(relMatch[0], '')
                       .replace(/(?:মনে\s*করায়\s*দিও|মনে\s*করিয়ে\s*দিও|mone\s*koriye\s*dio|mone\s*koraio|remind\s*me|dak\s*dio|ডাক\s*দিও|call\s*dio|কল\s*দিও)$/i, '')
                       .replace(/^(?:to|for|about)\s+/i, '')
                       .trim();

        const targetDate = new Date(Date.now() + ms);
        return {
            targetDate,
            taskText: task || 'Reminder',
            repeatCount: 1,
            repeatIntervalSeconds: 0,
            humanReadableTime: targetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })
        };
    }

    // 2. Absolute Bengali Expressions:
    // e.g. 'কাল সকাল ১০টায় মিটিং', 'আজ রাত ৯টায় কল দিও', 'আগামীকাল দুপুর ২টা ৩০ এ ডাক্তারের কাছে যাওয়া'
    const dayMatch = text.match(/(?:^|[\s,।])(আজকে|আজ|আজকের|কালকে|কাল|আগামীকাল|পরশু|পরশুকে|today|tomorrow)(?:[\s,।]|$)/i);
    const timeMatch = text.match(/(?:(সকাল|ভোর|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)\s*)?(\d{1,2})(?::(\d{2})|\s*টা\s*(\d{2})?|\s*টায়)?\s*(?:am|pm|এ|e|টায়|টা)?/i);

    if (dayMatch || (timeMatch && (timeMatch[1] || text.includes('টা')))) {
        let dayOffset = 0;
        if (dayMatch) {
            const dayStr = dayMatch[1].toLowerCase();
            if (/^(কালকে|কাল|আগামীকাল|tomorrow)$/i.test(dayStr)) dayOffset = 1;
            else if (/^(পরশু|পরশুকে)$/i.test(dayStr)) dayOffset = 2;
        }

        const modifier = (timeMatch && timeMatch[1]) ? timeMatch[1].toLowerCase() : (text.match(/(সকাল|ভোর|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)/i)?.[1]?.toLowerCase() || '');
        let hours = (timeMatch && timeMatch[2]) ? parseInt(timeMatch[2], 10) : (modifier === 'রাত' ? 20 : (modifier === 'দুপুর' ? 13 : 8));
        let minutes = (timeMatch && (timeMatch[3] || timeMatch[4])) ? parseInt(timeMatch[3] || timeMatch[4], 10) : 0;

        if (/^(দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)$/i.test(modifier)) {
            if (hours < 12) hours += 12;
        } else if (/^(সকাল|ভোর)$/i.test(modifier)) {
            if (hours === 12) hours = 0;
        }

        // Construct target date in Dhaka Timezone
        const targetDhaka = new Date(nowDhaka);
        targetDhaka.setDate(targetDhaka.getDate() + dayOffset);
        targetDhaka.setHours(hours, minutes, 0, 0);

        // If target time has already passed, push to next day
        if (targetDhaka.getTime() <= nowDhaka.getTime()) {
            targetDhaka.setDate(targetDhaka.getDate() + 1);
        }

        const msDiff = targetDhaka.getTime() - nowDhaka.getTime();
        if (msDiff > 0) {
            const finalTargetDate = new Date(Date.now() + msDiff);
            let task = text;
            if (dayMatch) task = task.replace(dayMatch[1], '');
            if (timeMatch && timeMatch[0]) task = task.replace(timeMatch[0], '');

            // Clean leftover prefixes, suffixes, and reminder words
            task = task.replace(/(?:সকাল|ভোর|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)(?:ে|এ)?/gi, '')
                       .replace(/(?:মনে\s*করায়\s*দিও|মনে\s*করিয়ে\s*দিও|মনে\s*করাইস|mone\s*koriye\s*dio|mone\s*koraio|remind\s*me|dak\s*dio|ডাক\s*দিও|call\s*dio|কল\s*দিও|dio|দিও|diba|দিবা|করাইস|করিস)$/i, '')
                       .replace(/(?:^|[\s,।])(আজকে|আজ|কালকে|কাল|আগামীকাল|পরশু)(?:[\s,।]|$)/gi, ' ')
                       .replace(/(?:\s|^)(?:এ|e|টায়|টা|য়|য়)(?:\s|$)/gi, ' ')
                       .replace(/^[,\s।\-–—:]+|[,\s।\-–—:]+$/g, '')
                       .trim();

            return {
                targetDate: finalTargetDate,
                taskText: task || 'Reminder',
                repeatCount: 1,
                repeatIntervalSeconds: 0,
                humanReadableTime: finalTargetDate.toLocaleString('en-US', { timeZone: 'Asia/Dhaka', hour12: true })
            };
        }
    }

    // 3. Natural English with chrono-node
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
 * Gemini AI Parser with verified models
 */
async function parseWithGemini(input) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.5-flash'
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

            if (!res.ok) continue;

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
            // continue to next model
        }
    }

    return null;
}

/**
 * Master Reminder Parser
 */
async function parseReminder(rawInput) {
    if (!rawInput) return null;

    let clean = rawInput.trim().replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();

    // Check if input contains repeat instructions (e.g. "3 bar", "৩ বার", "por por", "repeat")
    const isRepeat = /\b(bar|বার|por\s*por|পর\s*পর|repeat|every|times)\b/i.test(clean);

    // If it's a multi-shot repeat instruction, use Gemini AI
    if (isRepeat && process.env.GEMINI_API_KEY) {
        const aiResult = await parseWithGemini(clean);
        if (aiResult) return aiResult;
    }

    // Try high-speed rule-based parser first (0ms latency)
    const ruleResult = parseRuleBased(clean);
    if (ruleResult) return ruleResult;

    // Fallback to Gemini AI
    const aiResult = await parseWithGemini(clean);
    if (aiResult) return aiResult;

    return null;
}

module.exports = {
    parseReminder,
    parseRuleBased,
    isGreeting
};
