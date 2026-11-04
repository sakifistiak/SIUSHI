const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let waSocket = null;

async function startWhatsApp(onMessageReceived, onMediaReceived, onAudioReceived, onPairingCode) {
    const authDir = path.join(__dirname, 'baileys_auth_info');
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
        console.log(`\n⏳ Requesting Pairing Code for WhatsApp number: ${botNumber}...`);
        setTimeout(async () => {
            try {
                const code = await waSocket.requestPairingCode(botNumber);
                console.log('\n======================================================');
                console.log(`🔑 YOUR WHATSAPP PAIRING CODE IS:  👉  ${code}  👈`);
                console.log('======================================================');
                console.log('📱 On your phone:');
                console.log('1. Open WhatsApp > Linked Devices > Link a Device');
                console.log('2. Tap "Link with phone number instead" at the bottom');
                console.log(`3. Enter the 8-digit code: ${code}\n`);

                if (onPairingCode) {
                    onPairingCode(code);
                }
            } catch (err) {
                console.error('❌ Error requesting pairing code:', err.message);
            }
        }, 3000);
    }

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !botNumber) {
            console.log('\n======================================================');
            console.log('📲 Scan this QR Code with WhatsApp (Linked Devices):');
            console.log('======================================================\n');
            qrcodeTerminal.generate(qr, { small: true });

            try {
                await QRCode.toFile('./whatsapp-qr.png', qr);
                console.log('🖼️ Also saved QR code image to: whatsapp-qr.png\n');
            } catch (e) {
                // ignore
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('⚠️ WhatsApp connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startWhatsApp(onMessageReceived, onMediaReceived);
            }
        } else if (connection === 'open') {
            console.log('\n✅ WhatsApp is successfully connected and online!\n');
            if (fs.existsSync('./whatsapp-qr.png')) {
                fs.unlinkSync('./whatsapp-qr.png');
            }
        }
    });

    // Handle incoming messages
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

            const from = msg.key.remoteJid;

            // Check if audio / voice message
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

            // Check if media message (image, document, pdf)
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

module.exports = {
    startWhatsApp,
    sendWhatsAppMessage,
    sendWhatsAppFile
};
