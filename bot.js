const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const BOT_TOKEN = '8941809628:AAEaLRwYTQLGsxdaidOeD3-StKpaiSYFdMI';
const ADMIN_ID = 8941809628; 
const LINK4M_API_TOKEN = '6a8105012004f1159849220d'; 

const REWARD_PER_LINK = 350; 
const REWARD_PER_REF = 100; 
const MIN_WITHDRAW_VN = 10000; 
const MAX_WITHDRAW_VN = 50000; 
const USDT_RATE = 25000; 
const MIN_WITHDRAW_USDT_VND = 10000; 
const COOLDOWN_TIME = 10 * 60 * 1000; 
const DB_FILE = './data.json';

function loadData() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = { users: {}, redeemed_codes: [], custom_codes: {}, withdraw_requests: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.custom_codes) data.custom_codes = {};
    return data;
  } catch (err) {
    return { users: {}, redeemed_codes: [], custom_codes: {}, withdraw_requests: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {}
}

function getUser(data, userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      userId,
      accountCode: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
      balance: 0,
      lastBypassTime: 0,
      waitingForCode: false,
      expectedCode: null,
      waitingForGiftcode: false,
      referredBy: null,
      refRewarded: false,
      refCount: 0,
      withdrawStep: null,
      tempWithdraw: {},
      usedCustomCodes: []
    };
    saveData(data);
  }
  if (!data.users[userId].usedCustomCodes) {
    data.users[userId].usedCustomCodes = [];
  }
  return data.users[userId];
}

function sendTelegram(method, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

function createDynamicLink(code, callback) {
  const postData = 'content=' + encodeURIComponent(`MÃ XÁC NHẬN CỦA BẠN LÀ:\n\n${code}`) + '&expiry=1';
  const req = https.request({
    hostname: 'dpaste.com',
    port: 443,
    path: '/api/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      const rawNoteUrl = body.trim() + '.txt';
      const apiUrl = `https://link4m.co/api-shorten/v2?api=${LINK4M_API_TOKEN}&url=${encodeURIComponent(rawNoteUrl)}`;
      
      https.get(apiUrl, (linkRes) => {
        let linkBody = '';
        linkRes.on('data', chunk => linkBody += chunk);
        linkRes.on('end', () => {
          try {
            const json = JSON.parse(linkBody);
            if (json && json.status === 'success') callback(json.shortenedUrl);
            else callback(null);
          } catch (e) { callback(null); }
        });
      }).on('error', () => callback(null));
    });
  });
  req.on('error', () => callback(null));
  req.write(postData);
  req.end();
}

let lastUpdateId = 0;

function pollTelegram() {
  sendTelegram('getUpdates', { offset: lastUpdateId + 1, timeout: 30 })
    .then(res => {
      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          handleUpdate(update);
        }
      }
    })
    .catch(err => {})
    .finally(() => {
      setTimeout(pollTelegram, 1000);
    });
}

function handleUpdate(update) {
  const db = loadData();

  if (update.message && update.message.text) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim();
    const user = getUser(db, userId);

    // Lệnh tạo code dành riêng cho Admin: /taocode <MÃ> <số_tiền> <số_lượt>
    if (text.startsWith('/taocode')) {
      if (userId !== ADMIN_ID) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Bạn không có quyền sử dụng lệnh này!' });
        return;
      }
      const parts = text.split(' ');
      if (parts.length < 4) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Sai cú pháp! Dùng: `/taocode MÃ_CODE SỐ_TIỀN SỐ_LƯỢT`', parse_mode: 'Markdown' });
        return;
      }
      const codeName = parts[1].toUpperCase();
      const amount = Number(parts[2]);
      const maxUses = Number(parts[3]);

      if (isNaN(amount) || isNaN(maxUses)) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Số tiền hoặc số lượt phải là số hợp lệ!' });
        return;
      }

      db.custom_codes[codeName] = {
        amount: amount,
        maxUses: maxUses,
        usedCount: 0
      };
      saveData(db);

      sendTelegram('sendMessage', { 
        chat_id: chatId, 
        text: `✅ **Tạo Giftcode thành công!**\n- Mã: \`${codeName}\`\n- Thưởng: **${amount.toLocaleString('vi-VN')} VNĐ**\n- Giới hạn: **${maxUses} lượt**`,
        parse_mode: 'Markdown'
      });
      return;
    }

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      if (parts[1] && !user.referredBy && Number(parts[1]) !== userId) {
        const refId = Number(parts[1]);
        if (db.users[refId]) user.referredBy = refId;
      }
      saveData(db);

      sendTelegram('sendMessage', {
        chat_id: chatId,
        text: `👋 Chào mừng ${msg.from.first_name}!\n\n🆔 ID: \`${user.accountCode}\`\n💰 Số dư: ${user.balance.toLocaleString('vi-VN')} VNĐ\n🎁 Thưởng link: +${REWARD_PER_LINK} VNĐ`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 PHẦN 1: LẤY LINK VƯỢT', callback_data: 'MENU_HOME' }],
            [{ text: '🎁 Nhập Giftcode Nhận Thưởng', callback_data: 'MENU_GIFTCODE' }],
            [{ text: '👥 Giới Thiệu (Ref)', callback_data: 'MENU_REF' }],
            [{ text: '🏦 RÚT VN (10k-50k)', callback_data: 'MENU_WITHDRAW_VN' }, { text: '🌐 RÚT USDT', callback_data: 'MENU_WITHDRAW_USDT' }]
          ]
        }
      });
      return;
    }

    if (text === '/huy') {
      user.waitingForCode = false;
      user.waitingForGiftcode = false;
      user.withdrawStep = null;
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: '🏠 Đã hủy thao tác.' });
      return;
    }

    if (user.waitingForGiftcode) {
      const codeInput = text.toUpperCase();
      const gift = db.custom_codes[codeInput];

      if (!gift) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Mã Giftcode không tồn tại! Vui lòng kiểm tra lại hoặc gõ `/huy`.' });
        return;
      }

      if (user.usedCustomCodes.includes(codeInput)) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Bạn đã sử dụng mã Giftcode này rồi!' });
        return;
      }

      if (gift.usedCount >= gift.maxUses) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Mã Giftcode này đã hết lượt sử dụng!' });
        return;
      }

      // Thực hiện cộng tiền
      user.balance += gift.amount;
      user.usedCustomCodes.push(codeInput);
      gift.usedCount += 1;
      user.waitingForGiftcode = false;
      saveData(db);

      sendTelegram('sendMessage', { 
        chat_id: chatId, 
        text: `🎉 **NHẬP GIFTCODE THÀNH CÔNG!**\n\n💰 Cộng: **+${gift.amount.toLocaleString('vi-VN')} VNĐ**\n💵 Số dư mới: **${user.balance.toLocaleString('vi-VN')} VNĐ**`,
        parse_mode: 'Markdown'
      });
      return;
    }

    if (user.withdrawStep === 'WAITING_ATM_INFO') {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 3) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Sai cú pháp! Dạng: `MBBank | STK | Tên`', parse_mode: 'Markdown' });
        return;
      }
      user.tempWithdraw = { type: 'ATM', bankName: parts[0].toUpperCase(), accountNo: parts[1], accountName: parts[2].toUpperCase() };
      user.withdrawStep = 'WAITING_AMOUNT';
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: `💰 Nhập số tiền muốn rút (Từ ${MIN_WITHDRAW_VN.toLocaleString()} VNĐ đến ${MAX_WITHDRAW_VN.toLocaleString()} VNĐ):` });
      return;
    }

    if (user.withdrawStep === 'WAITING_USDT_WALLET') {
      if (!text.startsWith('0x') || text.length < 30) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Ví BEP-20 không hợp lệ!' });
        return;
      }
      user.tempWithdraw = { type: 'USDT', usdtWallet: text };
      user.withdrawStep = 'WAITING_AMOUNT';
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: `💰 Nhập số tiền VNĐ muốn quy đổi rút USDT (Từ ${MIN_WITHDRAW_VN.toLocaleString()} VNĐ đến ${MAX_WITHDRAW_VN.toLocaleString()} VNĐ):` });
      return;
    }

    if (user.withdrawStep === 'WAITING_AMOUNT') {
      const amount = Number(text);
      if (isNaN(amount) || amount < MIN_WITHDRAW_VN || amount > MAX_WITHDRAW_VN || amount > user.balance) {
        sendTelegram('sendMessage', { chat_id: chatId, text: `❌ Số tiền không hợp lệ! Mức rút phải từ ${MIN_WITHDRAW_VN.toLocaleString()} đến ${MAX_WITHDRAW_VN.toLocaleString()} VNĐ và không vượt số dư. Nhập lại:` });
        return;
      }

      user.balance -= amount;
      const reqId = Date.now();
      const info = user.tempWithdraw;
      db.withdraw_requests.push({ id: reqId, userId, amount, type: info.type, status: 'PENDING' });
      user.withdrawStep = null;
      saveData(db);

      sendTelegram('sendMessage', { chat_id: chatId, text: `✅ Đã gửi yêu cầu rút tiền thành công!` });

      const transferContent = `tra thuong vuot link ${user.accountCode}`;
      if (info.type === 'ATM') {
        sendTelegram('sendMessage', {
          chat_id: ADMIN_ID,
          text: `🚨 **RÚT ATM (#${reqId})**\n- ID: \`${user.accountCode}\`\n- Tiền: **${amount.toLocaleString()} VNĐ**\n- Bank: ${info.bankName} | ${info.accountNo} | ${info.accountName}\n- Nội dung: \`${transferContent}\``,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Đã Chuyển', callback_data: `APPROVE_${reqId}` }, { text: '❌ Hoàn Tiền', callback_data: `REFUND_${reqId}` }]
            ]
          }
        });
      } else {
        const usdtVal = (amount / USDT_RATE).toFixed(2);
        sendTelegram('sendMessage', {
          chat_id: ADMIN_ID,
          text: `🚨 **RÚT USDT (#${reqId})**\n- ID: \`${user.accountCode}\`\n- Tiền: **${usdtVal} USDT**\n- Ví: \`${info.usdtWallet}\``,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Đã Chuyển', callback_data: `APPROVE_${reqId}` }, { text: '❌ Hoàn Tiền', callback_data: `REFUND_${reqId}` }]
            ]
          }
        });
      }
      return;
    }

    if (user.waitingForCode) {
      if (text !== user.expectedCode) {
        sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Sai mã xác nhận! Thử lại hoặc gõ `/huy`.' });
        return;
      }

      db.redeemed_codes.push(text);
      user.balance += REWARD_PER_LINK;
      user.lastBypassTime = Date.now();
      user.waitingForCode = false;
      user.expectedCode = null;

      if (user.referredBy && !user.refRewarded) {
        const ref = db.users[user.referredBy];
        if (ref) {
          ref.balance += REWARD_PER_REF;
          ref.refCount = (ref.refCount || 0) + 1;
          sendTelegram('sendMessage', { chat_id: user.referredBy, text: `🎉 Thưởng giới thiệu +${REWARD_PER_REF} VNĐ!` });
        }
        user.refRewarded = true;
      }
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: `🎉 Chính xác! Cộng +${REWARD_PER_LINK} VNĐ. Số dư: ${user.balance.toLocaleString()} VNĐ` });
      return;
    }
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const userId = cb.from.id;
    const dataKey = cb.data;
    const db = loadData();
    const user = getUser(db, userId);

    if (dataKey === 'MENU_HOME') {
      const now = Date.now();
      if (now - user.lastBypassTime < COOLDOWN_TIME) {
        const rem = Math.ceil((COOLDOWN_TIME - (now - user.lastBypassTime)) / 1000);
        sendTelegram('sendMessage', { chat_id: chatId, text: `⏳ Vui lòng đợi ${Math.ceil(rem/60)} phút nữa!` });
        return;
      }

      const code = 'UQ' + crypto.randomBytes(16).toString('hex').toUpperCase();
      createDynamicLink(code, (link) => {
        if (!link) {
          sendTelegram('sendMessage', { chat_id: chatId, text: '❌ Lỗi tạo link, thử lại sau!' });
          return;
        }
        user.waitingForCode = true;
        user.expectedCode = code;
        saveData(db);

        sendTelegram('sendMessage', {
          chat_id: chatId,
          text: `🔗 **Link của bạn:**\n${link}\n\nVượt link lấy mã dán vào đây!`,
          parse_mode: 'Markdown'
        });
      });
    } else if (dataKey === 'MENU_GIFTCODE') {
      user.waitingForGiftcode = true;
      saveData(db);
      sendTelegram('sendMessage', {
        chat_id: chatId,
        text: `🎁 **NHẬP MÃ GIFTCODE**\n\nVui lòng gửi mã giftcode của bạn vào khung chat:\n*(Gõ `/huy` nếu muốn thoát)*`,
        parse_mode: 'Markdown'
      });
    } else if (dataKey === 'MENU_REF') {
      sendTelegram('sendMessage', {
        chat_id: chatId,
        text: `👥 **Giới thiệu bạn bè**\n- Thưởng: +${REWARD_PER_REF} VNĐ/ref\n- Đã mời: ${user.refCount || 0} người`,
        parse_mode: 'Markdown'
      });
    } else if (dataKey === 'MENU_WITHDRAW_VN') {
      if (user.balance < MIN_WITHDRAW_VN) {
        sendTelegram('sendMessage', { chat_id: chatId, text: `❌ Cần tối thiểu ${MIN_WITHDRAW_VN.toLocaleString()} VNĐ để rút.` });
        return;
      }
      user.withdrawStep = 'WAITING_ATM_INFO';
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: `🏦 Nhập thông tin:\n\`TênBank | STK | ChủTàiKhoản\``, parse_mode: 'Markdown' });
    } else if (dataKey === 'MENU_WITHDRAW_USDT') {
      if (user.balance < MIN_WITHDRAW_VN) {
        sendTelegram('sendMessage', { chat_id: chatId, text: `❌ Số dư chưa đủ rút (Tối thiểu ${MIN_WITHDRAW_VN.toLocaleString()} VNĐ).` });
        return;
      }
      user.withdrawStep = 'WAITING_USDT_WALLET';
      saveData(db);
      sendTelegram('sendMessage', { chat_id: chatId, text: `🌐 Nhập địa chỉ ví BEP-20 (USDT):` });
    } else if (dataKey.startsWith('APPROVE_') || dataKey.startsWith('REFUND_')) {
      if (userId !== ADMIN_ID) return;
      const parts = dataKey.split('_');
      const action = parts[0];
      const reqId = Number(parts[1]);
      const req = db.withdraw_requests.find(r => r.id === reqId);

      if (!req || req.status !== 'PENDING') return;

      if (action === 'APPROVE') {
        req.status = 'APPROVED';
        saveData(db);
        sendTelegram('sendMessage', { chat_id: req.userId, text: `🎉 Yêu cầu rút tiền của bạn đã được duyệt thành công!` });
        sendTelegram('sendMessage', { chat_id: chatId, text: `✅ Đã duyệt lệnh rút #${reqId}` });
      } else {
        const targetUser = getUser(db, req.userId);
        targetUser.balance += req.amount;
        req.status = 'REFUNDED';
        saveData(db);
        sendTelegram('sendMessage', { chat_id: req.userId, text: `❌ Lệnh rút tiền bị hủy, tiền đã hoàn về tài khoản.` });
        sendTelegram('sendMessage', { chat_id: chatId, text: `❌ Đã hoàn tiền lệnh #${reqId}` });
      }
    }
  }
}

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running 24/7!');
}).listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  pollTelegram();
});
