async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.8-flash'
    ];

    const base64Data = audioBuffer.toString('base64');
    // Normalize mimeType (e.g. audio/ogg; codecs=opus -> audio/ogg)
    let cleanMime = (mimeType || 'audio/ogg').split(';')[0].trim();
    if (!cleanMime.startsWith('audio/')) cleanMime = 'audio/ogg';

    for (const model of models) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                inlineData: {
                                    mimeType: cleanMime,
                                    data: base64Data
                                }
                            },
                            {
                                text: 'Accurately transcribe this voice recording into plain text in Bengali or English exactly as spoken. Return ONLY the transcribed text, without any explanation, markdown or quotes.'
                            }
                        ]
                    }]
                })
            });

            if (!res.ok) continue;

            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text && text.trim()) {
                return text.trim();
            }
        } catch (e) {
            console.error(`[Voice Transcribe] Error with ${model}:`, e.message);
        }
    }

    return null;
}

module.exports = {
    transcribeAudio
};
