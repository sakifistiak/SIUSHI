const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

let waSocket = null;
let currentPairingCode = null;
let isConnected = false;
let lastPairingError = null;

async function requestNewPairingCode(botNumber, onPairingCode) {
    if (!waSocket) {
        lastPairingError = 'Socket not ready yet';
        return null;
    }
    if (isConnected) {
        lastPairingError = 'Already connected';
        return null;
    }
    const cleanNumber = (botNumber || process.env.BOT_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
    if (!cleanNumber) {
        lastPairingError = 'No phone number provided';
        return null;
    }

    try {
        console.log(`\n⏳ Requesting fresh Pairing Code for: ${cleanNumber}...`);
        const code = await waSocket.requestPairingCode(cleanNumber);
        currentPairingCode = code;
        lastPairingError = null;
        console.log(`\n🔑 FRESH PAIRING CODE: 👉  ${code}  👈\n`);
        if (onPairingCode) {
            onPairingCode(code);
        }
        return code;
    } catch (err) {
        console.error('❌ Error requesting pairing code:', err.message);
        lastPairingError = err.message;
        return null;
    }
}

async function startWhatsApp(onMessageReceived, onMediaReceived, onAudioReceived, onPairingCode) {
    const authDir = path.join(__dirname, 'baileys_auth_info');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const botNumber = process.env.BOT_PHONE_NUMBER ? process.env.BOT_PHONE_NUMBER.replace(/[^0-9]/g, '') : null;

    waSocket = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        keepAliveIntervalMs: 15000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    waSocket.ev.on('creds.update', saveCreds);

    // If pairing code mode is requested and not registered yet
    if (botNumber && !waSocket.authState.creds.registered) {
        setTimeout(() => {
            requestNewPairingCode(botNumber, onPairingCode);
        }, 5000);
    }

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ WhatsApp connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startWhatsApp(onMessageReceived, onMediaReceived, onAudioReceived, onPairingCode);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentPairingCode = null;
            console.log('\n✅ WhatsApp is successfully connected and online!\n');
        }
    });

    // Handle incoming messages
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

            const from = msg.key.remoteJid;

            // Audio message
            const isAudio = Boolean(msg.message?.audioMessage);
            if (isAudio && onAudioReceived) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const mimeType = msg.message?.audioMessage?.mimetype || 'audio/ogg';
                    console.log(`🎙️ [WhatsApp Voice] From: ${from} | Mime: ${mimeType}`);
                    await onAudioReceived(from, buffer, mimeType);
                    continue;
                } catch (e) {
                    console.error('Failed to download WhatsApp audio:', e.message);
                }
            }

            // Image or Document
            const isMedia = Boolean(msg.message?.imageMessage || msg.message?.documentMessage);
            if (isMedia && onMediaReceived) {
                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const caption = msg.message?.imageMessage?.caption || msg.message?.documentMessage?.caption || '';
                    const originalName = msg.message?.documentMessage?.fileName || (msg.message?.imageMessage ? 'photo.jpg' : 'file.bin');
                    const mimeType = msg.message?.imageMessage?.mimetype || msg.message?.documentMessage?.mimetype || 'application/octet-stream';
                    
                    console.log(`📎 [WhatsApp Media] From: ${from} | File: ${originalName} | Caption: "${caption}"`);
                    await onMediaReceived(from, buffer, originalName, caption, mimeType);
                    continue;
                } catch (e) {
                    console.error('Failed to download media:', e.message);
                }
            }

            const text = msg.message?.conversation || 
                         msg.message?.extendedTextMessage?.text || 
                         '';

            if (text && onMessageReceived) {
                console.log(`📩 [WhatsApp Incoming] From: ${from} | Text: "${text}"`);
                await onMessageReceived(from, text.trim(), msg);
            }
        }
    });

    return waSocket;
}

async function sendWhatsAppMessage(jid, text) {
    if (!waSocket) {
        console.error('❌ WhatsApp socket is not initialized');
        return false;
    }
    try {
        await waSocket.sendMessage(jid, { text });
        return true;
    } catch (err) {
        console.error('❌ Error sending WhatsApp message:', err.message);
        return false;
    }
}

async function sendWhatsAppFile(jid, filePath, caption, mimeType) {
    if (!waSocket) return false;
    try {
        const buffer = fs.readFileSync(filePath);
        if (mimeType && mimeType.startsWith('image/')) {
            await waSocket.sendMessage(jid, { image: buffer, caption: caption || '' });
        } else {
            const fileName = path.basename(filePath);
            await waSocket.sendMessage(jid, { 
                document: buffer, 
                mimetype: mimeType || 'application/octet-stream', 
                fileName: fileName.replace(/^\d+_/, ''), 
                caption: caption || '' 
            });
        }
        return true;
    } catch (err) {
        console.error('❌ Error sending WhatsApp file:', err.message);
        return false;
    }
}

function getWhatsAppStatus() {
    return {
        isConnected,
        currentPairingCode,
        lastPairingError
    };
}

module.exports = {
    startWhatsApp,
    sendWhatsAppMessage,
    sendWhatsAppFile,
    requestNewPairingCode,
    getWhatsAppStatus
};
