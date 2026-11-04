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

async function classifyIntent(input, recentHistory = []) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { intent: 'UNKNOWN', data: {} };

    const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.5-flash'
    ];

    const formattedDhaka = getFormattedDhakaTime();

    let historyText = '';
    if (recentHistory && recentHistory.length > 0) {
        historyText = '\nRecent Conversation History:\n' + 
            recentHistory.map(h => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.text}`).join('\n') + '\n';
    }

    const systemPrompt = `You are the master brain of a personal AI executive assistant bot. Current Dhaka time (+06:00) is: ${formattedDhaka}.
Analyze the user's input with conversation history and classify into EXACTLY ONE of these intents:

1. FINANCE_ADD: User recording a NEW income or expense with an amount (e.g. "লাঞ্চে ১৫০ টাকা খরচ", "Client theke 5000 tk pelam", "রিকশা ভাড়া ৩০ টাকা").
   data: { "type": "income"|"expense", "amount": number, "category": string, "note": string }

2. FINANCE_UPDATE_LAST: User correcting, updating, or adding details/category to the PREVIOUS transaction (e.g. "এই খরচ টা হয়েছে হোস্টিং কিনতে", "এটা খাবারের খরচ", "আগেরটা ৫০০ টাকা হবে").
   data: { "category": string, "amount": number, "note": string }

3. FINANCE_DELETE_LAST: User asking to undo/delete the previous transaction or mistake (e.g. "ভুল হয়েছে বাদ দাও", "আগের এন্ট্রি মুছে ফেলো", "undo", "ডিলিট করো").
   data: {}

4. FINANCE_REPORT: User asking for financial summary (e.g. "আজকের খরচের হিসাব দাও", "monthly report", "masher hisab", "আজকের হিসাব", "আমার এই মাসের সারসংক্ষেপ দেও তো").
   data: { "period": "today"|"month" }

5. DUE_ADD: Recording a loan or due money (e.g. "আলামিনের কাছে ৫০০০ টাকা পাবো", "রহিম ভাইয়ের বাকি আছে ২০০ টাকা", "কাউসার ভাইকে ৫০০ টাকা দিতে হবে", "বাকি ২০০ টাকা").
   data: { "type": "receivable"|"payable", "personName": string, "amount": number, "note": string }
   (Note: 'receivable' if user will GET money / পাওনা; 'payable' if user OWES money / দেনা)

6. DUE_LIST: Viewing dues and loans (e.g. "দেনা পাওনার হিসাব দেখাও", "কার কাছে কত পাবো", "কার কার দেনা আছে", "dues list").
   data: {}

7. DUE_SETTLE: Clearing/settling a due (e.g. "আলামিন টাকা পরিশোধ করেছে", "রহিম ভাইয়ের বাকি ক্লিয়ার", "পরিশোধ কাউসার").
   data: { "personName": string }

8. CLIENT_ADD: Adding client project delivery deadline (e.g. "রহিম ভাইয়ের ওয়েবসাইট ১৫ তারিখে দিতে হবে", "Client Tanvir app deadline 20th Nov").
   data: { "clientName": string, "projectTask": string, "deadlineISO": "YYYY-MM-DDTHH:mm:ss+06:00" }

9. CLIENT_LIST: Viewing pending client projects (e.g. "ক্লায়েন্টদের কাজগুলো দেখাও", "pending projects", "client list").
   data: {}

10. CLIENT_DONE: Marking a client project as finished (e.g. "রহিম ভাইয়ের কাজ শেষ", "Tanvir project completed").
    data: { "clientName": string }

11. URGENT_ADD: Exam, viva, class test, or critical task that needs repeated nagging until confirmed (e.g. "১০ তারিখে সিএসই ল্যাব ভাইভা আছে", "কাল সকাল ১০টায় ক্লাসটেস্ট", "জরুরি ওষুধ খাওয়ার রিমাইন্ডার").
    data: { "title": string, "firstAlertISO": "YYYY-MM-DDTHH:mm:ss+06:00", "repeatIntervalMins": number }

12. URGENT_CONFIRM: User confirming exam or urgent task is done (e.g. "done", "ভাইভা শেষ", "কাজ শেষ", "completed", "হয়ে গেছে").
    data: { "keyword": string }

13. VAULT_SEARCH: User asking for a stored document/file (e.g. "আমার পাসপোর্ট কপি পাঠাও", "বিদ্যুৎ বিলের রসিদ দাও", "routine dao").
    data: { "query": string }

14. VAULT_LIST: User asking to see all vault documents (e.g. "ভল্টের সব ফাইল দেখাও", "vault list", "document list").
    data: {}

15. REMINDER: Regular or multi-shot timer/reminder (e.g. "১০ মিনিট পর চা খাবো", "5 min pore 3 bar reminder diba").
    data: { "raw": string }

16. AUTH_NUMBER_ADD: Adding or authorizing a secondary phone number (e.g. "আমার এই নাম্বার অ্যাড করে দাও 017xxxxxxxx", "নম্বর যোগ করো 018xxxxxxxx", "add number 015xxxxxx", "second number 019...").
    data: { "phone": string }

17. AUTH_NUMBER_LIST: Viewing authorized phone numbers (e.g. "অনুমোদিত নম্বরগুলো দেখাও", "কোন কোন নাম্বার এড আছে", "number list", "authorized numbers").
    data: {}

18. AUTH_NUMBER_REMOVE: Removing an authorized phone number (e.g. "017xxxx নম্বর মুছে দাও", "remove number 018xxxx").
    data: { "phone": string }

19. GREETING: Casual greeting or checking if bot is online (e.g. "acho?", "কেমন আছো", "hello").
    data: {}
${historyText}
Current User input: "${input}"

Respond ONLY with valid JSON in this format:
{"intent": "INTENT_NAME", "data": { ... }}`;

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!res.ok) continue;

            const data = await res.json();
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) continue;

            return JSON.parse(jsonText);
        } catch (e) {
            // try next model
        }
    }

    return { intent: 'UNKNOWN', data: {} };
}

module.exports = {
    classifyIntent
};
