# Dual Reminder Bot (Telegram & WhatsApp) 🤖📱

An automated cross-platform reminder bot that syncs **Telegram** and **WhatsApp**. Send a reminder from either platform, and get notified on **both**!

---

## ✨ Features
- **No Complex API Approval**: Uses standard WhatsApp Web QR-code linking (free, no Meta Business verification).
- **Dual Notification**: Whether you set a reminder on WhatsApp or Telegram, both apps will alert you when the time arrives.
- **Natural & Quick Parsing**: Supports both quick durations (`10s`, `15m`, `2h`, `1d`) and natural language (`in 10 minutes`, `tomorrow at 5pm`).
- **Persistent Storage**: Saved in `data.json` so reminders aren't lost if the server/script restarts.

---

## 🚀 Setup & Running

### 1. Configure Telegram Bot Token
Create a `.env` file in the project root:
```env
TELEGRAM_BOT_TOKEN=your_token_from_botfather
```

### 2. Start the Bot
```bash
npm start
```

### 3. Link Your Accounts (One-Time)
1. **WhatsApp**: Scan the QR code shown in your terminal using WhatsApp on your phone (**Settings > Linked Devices > Link a Device**).
2. **Telegram**: Open your bot on Telegram and send `/start`.

---

## 📝 Usage Examples

Send any of these messages on **Telegram** or **WhatsApp**:
- `10m tea break`
- `remind 30m team meeting`
- `2h review pull request`
- `in 45 minutes check oven`
- `tomorrow at 10am doctor appointment`

When the time arrives, **both** Telegram and WhatsApp will ping you simultaneously!
