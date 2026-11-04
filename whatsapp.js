const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

let waSocket = null;
let currentPairingCode = null;
let currentQRCodeDataUrl = null;
let isConnected = false;
let lastPairingError = null;

// Track message IDs sent by the bot to avoid self-reply loops
const botSentMessageIds = new Set();

function normalizeJid(jid) {
    if (!jid) return jid;
    let clean = jid;
    if (clean.includes(':') && clean.includes('@')) {
        clean = clean.split(':')[0] + '@' + clean.split('@')[1];
    }
    // If it's the bot's own LID or self-chat, redirect to the bot's phone JID so self-chat messages appear in Message Yourself!
    if (waSocket && waSocket.user) {
        const userLid = waSocket.user.lid ? waSocket.user.lid.split(':')[0] : '';
        const userPhone = waSocket.user.id ? waSocket.user.id.split(':')[0] : '';
        if (userLid && clean.startsWith(userLid) && userPhone) {
            clean = userPhone + '@s.whatsapp.net';
        }
    }
    return clean;
}

function isSelfChat(msg, socketUser) {
    if (!msg || !msg.key) return false;
    const remote = msg.key.remoteJid || '';
    const cleanRemote = remote.split('@')[0].split(':')[0];

    const envBotNum = (process.env.BOT_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
    if (envBotNum && cleanRemote === envBotNum) return true;

    if (socketUser) {
        const userNum = socketUser.id ? socketUser.id.split('@')[0].split(':')[0] : '';
        const userLid = socketUser.lid ? socketUser.lid.split('@')[0].split(':')[0] : '';
        if (userNum && cleanRemote === userNum) return true;
        if (userLid && cleanRemote === userLid) return true;
        if (remote === socketUser.id || remote === socketUser.lid) return true;
    }

    return false;
}

function extractMessageContent(msg) {
    if (!msg || !msg.message) return { text: '', isAudio: false, isMedia: false, raw: null };

    let m = msg.message;
    // Unwrap nested message wrappers (ephemeral, view-once, forwarded, edited)
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
    if (m.editedMessage?.message) m = m.editedMessage.message;

    const isAudio = Boolean(m.audioMessage);
    const isMedia = Boolean(m.imageMessage || m.documentMessage);
    const text = m.conversation || 
                 m.extendedTextMessage?.text || 
                 m.imageMessage?.caption || 
                 m.documentMessage?.caption || 
                 '';

    return { text: text.trim(), isAudio, isMedia, raw: m };
}

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

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                currentQRCodeDataUrl = await QRCode.toDataURL(qr, { scale: 8, margin: 2 });
                console.log('📲 Live QR Code updated for Web Dashboard');
            } catch (e) {
                // ignore
            }
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ WhatsApp connection closed (Code: ${statusCode || 'unknown'}). Reconnecting: ${shouldReconnect}`);

            if (statusCode === DisconnectReason.loggedOut) {
                console.log('🚪 WhatsApp session logged out. Clearing auth dir...');
                if (fs.existsSync(authDir)) {
                    fs.rmSync(authDir, { recursive: true, force: true });
                }
                setTimeout(() => {
                    startWhatsApp(onMessageReceived, onMediaReceived, onAudioReceived, onPairingCode);
                }, 2000);
            } else if (shouldReconnect) {
                setTimeout(() => {
                    startWhatsApp(onMessageReceived, onMediaReceived, onAudioReceived, onPairingCode);
                }, 3000);
            }
        } else if (connection === 'open') {
            isConnected = true;
            currentPairingCode = null;
            currentQRCodeDataUrl = null;
            lastPairingError = null;
            console.log('\n✅ WhatsApp is successfully connected and online!\n');
            console.log(`📱 Account ID: ${waSocket.user?.id} | LID: ${waSocket.user?.lid || 'N/A'}`);
        }
    });

    // Handle incoming messages
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
        // Accept both external incoming ('notify') and self-appended sync ('append')
        if (type !== 'notify' && type !== 'append') return;

        for (const msg of messages) {
            if (!msg.message) continue;
            if (msg.key.remoteJid === 'status@broadcast') continue;
            if (msg.key.remoteJid?.endsWith('@g.us')) continue; // Ignore groups

            // Avoid bot responding to messages it sent
            if (botSentMessageIds.has(msg.key.id)) continue;

            const from = msg.key.remoteJid;
            const selfChat = isSelfChat(msg, waSocket.user);

            // If message is fromMe, ONLY process if it's a self-chat ("Message yourself")
            // If fromMe is true and chatting with a contact, ignore it
            if (msg.key.fromMe && !selfChat) {
                continue;
            }

            const { text, isAudio, isMedia, raw } = extractMessageContent(msg);
            const mediaSource = raw ? { key: msg.key, message: raw } : msg;

            // Audio message
            if (isAudio && onAudioReceived) {
                try {
                    const buffer = await downloadMediaMessage(mediaSource, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const mimeType = raw?.audioMessage?.mimetype || 'audio/ogg';
                    console.log(`🎙️ [WhatsApp Voice] From: ${from} (self: ${selfChat}) | Mime: ${mimeType}`);
                    await onAudioReceived(from, buffer, mimeType, msg);
                    continue;
                } catch (e) {
                    console.error('Failed to download WhatsApp audio:', e.message);
                }
            }

            // Image or Document
            if (isMedia && onMediaReceived) {
                try {
                    const buffer = await downloadMediaMessage(mediaSource, 'buffer', {}, { logger: pino({ level: 'silent' }) });
                    const caption = raw?.imageMessage?.caption || raw?.documentMessage?.caption || '';
                    const originalName = raw?.documentMessage?.fileName || (raw?.imageMessage ? 'photo.jpg' : 'file.bin');
                    const mimeType = raw?.imageMessage?.mimetype || raw?.documentMessage?.mimetype || 'application/octet-stream';

                    console.log(`📎 [WhatsApp Media] From: ${from} (self: ${selfChat}) | File: ${originalName} | Caption: "${caption}"`);
                    await onMediaReceived(from, buffer, originalName, caption, mimeType, msg);
                    continue;
                } catch (e) {
                    console.error('Failed to download media:', e.message);
                }
            }

            // Text message
            if (text && onMessageReceived) {
                console.log(`📩 [WhatsApp Incoming] From: ${from} (self: ${selfChat}) | Text: "${text}"`);
                await onMessageReceived(from, text, msg);
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
    const targetJid = normalizeJid(jid);
    try {
        const sent = await waSocket.sendMessage(targetJid, { text });
        if (sent?.key?.id) {
            botSentMessageIds.add(sent.key.id);
            setTimeout(() => botSentMessageIds.delete(sent.key.id), 5 * 60 * 1000);
        }
        return true;
    } catch (err) {
        console.error('❌ Error sending WhatsApp message:', err.message);
        return false;
    }
}

async function sendWhatsAppFile(jid, filePath, caption, mimeType) {
    if (!waSocket) return false;
    const targetJid = normalizeJid(jid);
    try {
        const buffer = fs.readFileSync(filePath);
        let sent;
        if (mimeType && mimeType.startsWith('image/')) {
            sent = await waSocket.sendMessage(targetJid, { image: buffer, caption: caption || '' });
        } else {
            const fileName = path.basename(filePath);
            sent = await waSocket.sendMessage(targetJid, { 
                document: buffer, 
                mimetype: mimeType || 'application/octet-stream', 
                fileName: fileName.replace(/^\d+_/, ''), 
                caption: caption || '' 
            });
        }
        if (sent?.key?.id) {
            botSentMessageIds.add(sent.key.id);
            setTimeout(() => botSentMessageIds.delete(sent.key.id), 5 * 60 * 1000);
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
        currentQRCodeDataUrl,
        lastPairingError
    };
}

module.exports = {
    startWhatsApp,
    sendWhatsAppMessage,
    sendWhatsAppFile,
    requestNewPairingCode,
    getWhatsAppStatus,
    normalizeJid
};
