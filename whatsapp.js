const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const db = require('./services/db');

let waSocket = null;
let currentPairingCode = null;
let currentQRCodeDataUrl = null;
let isConnected = false;
let lastPairingError = null;

const SESSION_FILE = path.join(__dirname, 'data', 'wa_session.json');

function isEssentialAuthFile(filename) {
    return filename === 'creds.json' || filename.startsWith('app-state-sync-key-');
}

function getSessionBase64() {
    const authDir = path.join(__dirname, 'baileys_auth_info');
    if (!fs.existsSync(authDir)) return null;
    const credsPath = path.join(authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) return null;

    try {
        const files = fs.readdirSync(authDir);
        const bundle = {};
        for (const file of files) {
            if (!isEssentialAuthFile(file)) continue;
            const filePath = path.join(authDir, file);
            if (fs.statSync(filePath).isFile()) {
                bundle[file] = fs.readFileSync(filePath, 'utf-8');
            }
        }
        return Buffer.from(JSON.stringify(bundle)).toString('base64');
    } catch (e) {
        console.error('Error generating session base64:', e.message);
        return null;
    }
}

function restoreSessionFromBase64(base64Str) {
    if (!base64Str || typeof base64Str !== 'string') return false;
    try {
        const cleanStr = base64Str.trim().replace(/^['"]|['"]$/g, '');
        const rawBuf = Buffer.from(cleanStr, 'base64');
        let jsonStr;
        // Support both plain base64 JSON and gzip-compressed base64 payloads
        if (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
            jsonStr = zlib.gunzipSync(rawBuf).toString('utf-8');
        } else {
            jsonStr = rawBuf.toString('utf-8');
        }
        const bundle = JSON.parse(jsonStr);
        if (!bundle || !bundle['creds.json']) return false;

        const authDir = path.join(__dirname, 'baileys_auth_info');
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        let restoredCount = 0;
        for (const [filename, content] of Object.entries(bundle)) {
            const safeName = path.basename(filename);
            if (!safeName) continue;
            fs.writeFileSync(path.join(authDir, safeName), content, 'utf-8');
            restoredCount++;
        }
        console.log(`[WhatsApp Auth] Restored ${restoredCount} auth files from session token.`);
        return true;
    } catch (err) {
        console.error('[WhatsApp Auth] Failed to restore session from base64:', err.message);
        return false;
    }
}

function persistSessionLocally() {
    try {
        const token = getSessionBase64();
        if (token) {
            const payload = { token, updatedAt: new Date().toISOString() };
            const dir = path.dirname(SESSION_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2));
            if (db.isMongoConnected()) {
                db.saveCollection('wa_session', payload).catch(() => {});
            }
        }
    } catch (e) {
        // ignore
    }
}

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

    // Auto-restore session from MongoDB, environment variable, or local persistent store if auth dir is empty
    const credsPath = path.join(authDir, 'creds.json');
    if (!fs.existsSync(credsPath)) {
        let restored = false;
        const envToken = process.env.WA_SESSION_DATA || process.env.WA_SESSION_BASE64;
        if (envToken) {
            console.log('[WhatsApp Auth] Restoring session from WA_SESSION_DATA environment variable...');
            restored = restoreSessionFromBase64(envToken);
        }
        if (!restored && fs.existsSync(SESSION_FILE)) {
            try {
                const saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
                if (saved.token) {
                    console.log('[WhatsApp Auth] Restoring session from persistent session file...');
                    restored = restoreSessionFromBase64(saved.token);
                }
            } catch (e) {
                // ignore
            }
        }
        if (!restored) {
            await db.waitForDatabase();
            if (db.isMongoConnected()) {
                try {
                    const dbSession = await db.loadCollection('wa_session', null);
                    if (dbSession && dbSession.token) {
                        console.log('[WhatsApp Auth] Restoring session from MongoDB...');
                        restoreSessionFromBase64(dbSession.token);
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
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

    waSocket.ev.on('creds.update', async () => {
        await saveCreds();
        persistSessionLocally();
    });

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
                if (fs.existsSync(SESSION_FILE)) {
                    fs.unlinkSync(SESSION_FILE);
                }
                if (db.isMongoConnected()) {
                    db.saveCollection('wa_session', { token: null, updatedAt: new Date().toISOString() }).catch(() => {});
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
            persistSessionLocally();
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
        lastPairingError,
        sessionBase64: getSessionBase64()
    };
}

module.exports = {
    startWhatsApp,
    sendWhatsAppMessage,
    sendWhatsAppFile,
    requestNewPairingCode,
    getWhatsAppStatus,
    getSessionBase64,
    restoreSessionFromBase64,
    normalizeJid
};
