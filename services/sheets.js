const fs = require('fs');

/**
 * Google Sheets and Excel Export Service for SIUSHO
 * Supports real-time webhook sync to Google Sheets and one-click UTF-8 CSV exports.
 */

const APPS_SCRIPT_TEMPLATE = `// Google Apps Script for SIUSHO Real-Time Accounting Sync
// Instructions:
// 1. In Google Sheets, go to Extensions > Apps Script
// 2. Replace all code with this snippet and click Save
// 3. Click 'Deploy' > 'New deployment'
// 4. Select type: 'Web app', Execute as: 'Me', Who has access: 'Anyone'
// 5. Click 'Deploy', copy the Web App URL, and paste it into SIUSHO Settings!

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Auto initialize headers if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Transaction ID",
        "Timestamp",
        "Date",
        "User / Account",
        "Type",
        "Category",
        "Amount (BDT)",
        "Reference Note"
      ]);
      sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#f1f5f9");
    }

    if (data.action === "batch_sync" && Array.isArray(data.items)) {
      data.items.forEach(function(item) {
        sheet.appendRow([
          item.id,
          item.createdAt || new Date(),
          item.date,
          item.userName || "User",
          item.type === "income" ? "Income" : "Expense",
          item.category,
          item.amount,
          item.note || ""
        ]);
      });
      return ContentService.createTextOutput(JSON.stringify({ status: "success", count: data.items.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    sheet.appendRow([
      data.id || "",
      new Date(),
      data.date || "",
      data.userName || "User",
      data.type === "income" ? "Income" : "Expense",
      data.category || "",
      data.amount || 0,
      data.note || ""
    ]);

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
`;

/**
 * Dispatches a transaction event to Google Sheets via Webhook
 */
async function syncTransactionToSheet(transaction, user, webhookUrl) {
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
        return { success: false, reason: 'No valid webhook URL' };
    }

    try {
        const payload = {
            action: 'add_transaction',
            id: transaction.id,
            date: transaction.date,
            userName: user ? user.name : 'Unknown User',
            userPhone: user ? (user.phone || '') : '',
            type: transaction.type,
            category: transaction.category,
            amount: transaction.amount,
            note: transaction.note || '',
            createdAt: transaction.createdAt || new Date().toISOString()
        };

        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        return { success: res.ok, response: text };
    } catch (err) {
        console.error('[Google Sheets Sync Error]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Batch syncs an array of transactions to Google Sheets
 */
async function syncBatchToSheet(transactions, usersMap, webhookUrl) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) {
        return { success: false, reason: 'No valid webhook URL' };
    }

    try {
        const items = transactions.map(t => {
            const user = usersMap[t.userId];
            return {
                id: t.id,
                date: t.date,
                userName: user ? user.name : 'User',
                type: t.type,
                category: t.category,
                amount: t.amount,
                note: t.note || '',
                createdAt: t.createdAt
            };
        });

        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'batch_sync', items })
        });

        const text = await res.text();
        return { success: res.ok, response: text };
    } catch (err) {
        console.error('[Google Sheets Batch Sync Error]:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Generates an Excel-ready CSV string with UTF-8 BOM so Bengali text renders cleanly in Microsoft Excel & Google Sheets
 */
function generateCSV(transactions, usersMap = {}) {
    const BOM = '\uFEFF'; // UTF-8 Byte Order Mark for Excel
    const header = ['Transaction ID', 'Date', 'User / Account', 'Type', 'Category', 'Amount (BDT)', 'Reference Note'];

    const rows = transactions.map(t => {
        const user = usersMap[t.userId];
        const userName = user ? user.name : 'User';
        const typeStr = t.type === 'income' ? 'Income' : 'Expense';
        const escapeCSV = (val) => `"${String(val || '').replace(/"/g, '""')}"`;

        return [
            escapeCSV(t.id),
            escapeCSV(t.date),
            escapeCSV(userName),
            escapeCSV(typeStr),
            escapeCSV(t.category),
            t.amount,
            escapeCSV(t.note)
        ].join(',');
    });

    return BOM + [header.join(','), ...rows].join('\r\n');
}

module.exports = {
    APPS_SCRIPT_TEMPLATE,
    syncTransactionToSheet,
    syncBatchToSheet,
    generateCSV
};
