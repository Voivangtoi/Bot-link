const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const BOT_TOKEN = '8941809628:AAEaLRwYTQLGsxdaidOeD3-StKpaiSYFdMI';
const ADMIN_ID = 8941809628; 
const LINK4M_API_TOKEN = '6a8105012004f1159849220d'; 

const REWARD_PER_LINK = 350; 
const REWARD_PER_REF = 100; 

const MIN_WITHDRAW_VN = 10000; 
const USDT_RATE = 25000; 
const MIN_WITHDRAW_USDT_VND = 10000; 

const COOLDOWN_TIME = 10 * 60 * 1000; 
const DB_FILE = './data.json';

function loadData() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialData = { users: {}, redeemed_codes: [], withdraw_requests: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
      return initialData;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Lỗi đọc database, khởi tạo lại:', err);
    return { users: {}, redeemed_codes: [], withdraw_requests: [] };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Lỗi ghi database:', err);
  }
}

function generateTenDigitId() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

function getUser(data, userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      userId,
      accountCode: generateTenDigitId(),
      balance: 0,
      lastBypassTime: 0,
      waitingForCode: false,
      expectedCode: null,
      referredBy: null,
      refRewarded: false,
      refCount: 0,
      withdrawStep: null,
      tempWithdraw: {}
    };
    saveData(data);
  } else if (!data.users[userId].accountCode) {
    data.users[userId].accountCode = generateTenDigitId();
    saveData(data);
  }
  return data.users[userId];
}

const bot = new Telegraf(BOT_TOKEN);

function generateDynamicCode() {
  const randomStr = crypto.randomBytes(24).toString('hex').toUpperCase();
  return `UQ${randomStr}`;
}

async function createDynamicLink(code) {
  try {
    const noteRes = await axios.post('https://dpaste.com/api/', 
      new URLSearchParams({
        'content': `MÃ XÁC NHẬN CỦA BẠN LÀ:\n\n${code}\n\nSao chép mã trên và dán vào Bot để nhận tiền!`,
        'expiry': '1'
      })
    );
    const rawNoteUrl = noteRes.data.trim() + '.txt';
    const apiUrl = `https://link4m.co/api-shorten/v2?api=${LINK4M_API_TOKEN}&url=${encodeURIComponent(rawNoteUrl)}`;
    const linkRes = await axios.get(apiUrl);

    if (linkRes.data && linkRes.data.status === 'success' && linkRes.data.shortenedUrl) {
      return linkRes.data.shortenedUrl;
    }
  } catch (err) {
    console.error('Lỗi tạo link tự động:', err.message);
  }
  return null;
}

function getMainKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏠 PHẦN 1: LẤY LINK VƯỢT', 'MENU_HOME')],
    [Markup.button.callback('👥 Giới Thiệu (Ref)', 'MENU_REF')],
    [Markup.button.callback('🏦 RÚT VN (ATM)', 'MENU_WITHDRAW_VN'), Markup.button.callback('🌐 RÚT BEP 20 (USDT)', 'MENU_WITHDRAW_USDT')]
  ]);
}

bot.start((ctx) => {
  try {
    const db = loadData();
    const userId = ctx.from.id;
    const user = getUser(db, userId);
    user.lastBypassTime = 0;
    user.waitingForCode = false;
    user.withdrawStep = null;
    user.tempWithdraw = {};

    const startPayload = ctx.message.text.split(' ')[1];
    if (startPayload && !user.referredBy && Number(startPayload) !== userId) {
      const referrerId = Number(startPayload);
      if (db.users[referrerId]) {
        user.referredBy = referrerId;
      }
    }
    saveData(db);

    ctx.reply(
      `👋 Chào mừng **${ctx.from.first_name}** đến với Bot Kiếm Tiền!\n\n` +
      `🆔 **Mã ID Tài Khoản:** \`${user.accountCode}\`\n` +
      `💰 **Số dư:** ${user.balance.toLocaleString('vi-VN')} VNĐ\n` +
      `🎁 **Thưởng vượt link:** +${REWARD_PER_LINK} VNĐ / mã.\n\n` +
      `Chọn chức năng phía dưới:`,
      getMainKeyboard()
    );
  } catch (err) {
    console.error('Lỗi ở lệnh start:', err);
  }
});

bot.action('MENU_HOME', async (ctx) => {
  try {
    const db = loadData();
    const user = getUser(db, ctx.from.id);
    const now = Date.now();
    const timePassed = now - user.lastBypassTime;
    
    if (COOLDOWN_TIME > 0 && timePassed < COOLDOWN_TIME) {
      const remainingSec = Math.ceil((COOLDOWN_TIME - timePassed) / 1000);
      const min = Math.floor(remainingSec / 60);
      const sec = remainingSec % 60;
      return ctx.reply(`⏳ **Đang trong thời gian chờ:** Vui lòng đợi **${min} phút ${sec} giây** nữa!`, getMainKeyboard());
    }

    const generatedCode = generateDynamicCode();
    await ctx.reply('⏳ Đang khởi tạo link chứa mã xác nhận...');

    const shortLink = await createDynamicLink(generatedCode);

    if (!shortLink) {
      return ctx.reply('❌ Có lỗi xảy ra khi tạo link. Vui lòng bấm thử lại!');
    }

    user.waitingForCode = true;
    user.expectedCode = generatedCode;
    user.withdrawStep = null;
    saveData(db);

    ctx.reply(
      `🏠 **PHẦN 1: LẤY LINK VƯỢT KIẾM TIỀN**\n\n` +
      `🔗 **Link Vượt Dành Riêng Cho Bạn:**\n${shortLink}\n\n` +
      `👉 **Bước 1:** Bấm vào link và vượt link.\n` +
      `👉 **Bước 2:** Nhận mã dán vào đây để nhận **+${REWARD_PER_LINK} VNĐ**.\n\n` +
      `⚠️ Gõ lệnh \`/huy\` để hủy.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('❌ Hủy & Về Trang Chủ', 'CANCEL_ACTION')]
      ])
    );
  } catch (err) {
    console.error('Lỗi ở MENU_HOME:', err);
  }
});

bot.action('MENU_REF', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;

  let msg = `👥 **CHƯƠNG TRÌNH GIỚI THIỆU (REFERRAL)**\n\n`;
  msg += `🔗 **Link Của Bạn:**\n\`${refLink}\`\n\n`;
  msg += `🎁 **Thưởng:** **+${REWARD_PER_REF} VNĐ** cho mỗi người giới thiệu thành công.\n`;
  msg += `📊 Số ref thành công: **${user.refCount || 0} người**`;

  ctx.reply(msg, Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Quay Lại Menu', 'BACK_MAIN')]
  ]));
});

bot.action('CANCEL_ACTION', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  user.expectedCode = null;
  user.withdrawStep = null;
  saveData(db);

  ctx.deleteMessage().catch(() => {});
  ctx.reply('🏠 Đã hủy. Quay lại trang chủ:', getMainKeyboard());
});

bot.hears(/^\/huy$/i, (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  user.expectedCode = null;
  user.withdrawStep = null;
  saveData(db);

  ctx.reply('🏠 Đã hủy thao tác. Quay lại trang chủ:', getMainKeyboard());
});

bot.action('MENU_WITHDRAW_VN', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  
  if (user.balance < MIN_WITHDRAW_VN) {
    return ctx.reply(`❌ Số dư không đủ! Cần tối thiểu **${MIN_WITHDRAW_VN.toLocaleString('vi-VN')} VNĐ** để rút.`);
  }

  user.withdrawStep = 'WAITING_ATM_INFO';
  user.waitingForCode = false;
  saveData(db);

  ctx.reply(
    `🏦 **BƯỚC 1: NHẬP THÔNG TIN NGÂN HÀNG**\n\n` +
    `Dán theo định dạng:\n\`Tên_Bank | STK | Tên_Chủ_Tài_Khoản\`\n\n` +
    `*VD:* \`MBBank | 0987654321 | NGUYEN VAN A\``,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Hủy', 'CANCEL_ACTION')]])
  );
});

bot.action('MENU_WITHDRAW_USDT', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  
  if (user.balance < MIN_WITHDRAW_USDT_VND) {
    return ctx.reply(`❌ Số dư không đủ! Cần tối thiểu **${MIN_WITHDRAW_USDT_VND.toLocaleString('vi-VN')} VNĐ**.`);
  }

  user.withdrawStep = 'WAITING_USDT_WALLET';
  user.waitingForCode = false;
  saveData(db);

  ctx.reply(
    `🌐 **BƯỚC 1: NHẬP ĐỊA CHỈ VÍ BEP-20 (USDT)**\n\n` +
    `Dán địa chỉ ví USDT của bạn vào đây:`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Hủy', 'CANCEL_ACTION')]])
  );
});

bot.action('BACK_MAIN', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.withdrawStep = null;
  saveData(db);

  ctx.deleteMessage().catch(() => {});
  ctx.reply('Quay lại menu chính:', getMainKeyboard());
});

bot.action(/^APPROVE_(\d+)/, (ctx) => {
  const reqId = Number(ctx.match[1]);
  const db = loadData();
  const req = db.withdraw_requests.find(r => r.id === reqId);

  if (!req || req.status !== 'PENDING') return ctx.reply('⚠️ Lệnh này đã xử lý rồi!');

  req.status = 'APPROVED';
  saveData(db);

  ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n STATUS: ✅ **ĐÃ DUYỆT THÀNH CÔNG**');
  bot.telegram.sendMessage(req.userId, `🎉 **RÚT TIỀN THÀNH CÔNG!**\n\nYêu cầu rút tiền của bạn đã được Admin thanh toán!`);
});

bot.action(/^REFUND_(\d+)/, (ctx) => {
  const reqId = Number(ctx.match[1]);
  const db = loadData();
  const req = db.withdraw_requests.find(r => r.id === reqId);

  if (!req || req.status !== 'PENDING') return ctx.reply('⚠️ Lệnh này đã xử lý rồi!');

  const user = getUser(db, req.userId);
  user.balance += req.amount;
  req.status = 'REFUNDED';
  saveData(db);

  ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n STATUS: ❌ **ĐÃ HOÀN TIỀN**');
  bot.telegram.sendMessage(req.userId, `❌ **LỆNH RÚT TIỀN BỊ HỦY!** Số tiền đã được hoàn về số dư.`);
});

bot.on('text', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const db = loadData();
    const user = getUser(db, ctx.from.id);

    if (user.withdrawStep === 'WAITING_ATM_INFO') {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 3) {
        return ctx.reply('❌ Sai cú pháp! Đúng dạng: `Tên_Bank | STK | Tên_Chủ_TK`');
      }

      user.tempWithdraw = {
        type: 'ATM',
        bankName: parts[0].toUpperCase(),
        accountNo: parts[1],
        accountName: parts[2].toUpperCase()
      };
      user.withdrawStep = 'WAITING_AMOUNT';
      saveData(db);

      return ctx.reply(
        `💰 **BƯỚC 2: NHẬP SỐ TIỀN MUỐN RÚT**\n\n` +
        `💵 Số dư: **${user.balance.toLocaleString('vi-VN')} VNĐ**\n` +
        `📌 Tối thiểu: **${MIN_WITHDRAW_VN.toLocaleString('vi-VN')} VNĐ**\n\n` +
        `Gõ số tiền muốn rút:`
      );
    }

    if (user.withdrawStep === 'WAITING_USDT_WALLET') {
      if (!text.startsWith('0x') || text.length < 30) {
        return ctx.reply('❌ Địa chỉ ví BEP-20 không hợp lệ!');
      }

      user.tempWithdraw = {
        type: 'USDT',
        usdtWallet: text
      };
      user.withdrawStep = 'WAITING_AMOUNT';
      saveData(db);

      return ctx.reply(
        `💰 **BƯỚC 2: NHẬP SỐ TIỀN (VNĐ)**\n\n` +
        `📌 Tối thiểu: **${MIN_WITHDRAW_USDT_VND.toLocaleString('vi-VN')} VNĐ**\n\n` +
        `Gõ số tiền VNĐ muốn quy đổi sang USDT rút:`
      );
    }

    if (user.withdrawStep === 'WAITING_AMOUNT') {
      const amount = Number(text);
      if (isNaN(amount) || amount < MIN_WITHDRAW_VN) {
        return ctx.reply(`❌ Số tiền không hợp lệ hoặc dưới tối thiểu (${MIN_WITHDRAW_VN.toLocaleString('vi-VN')} VNĐ)! Nhập lại:`);
      }

      if (amount > user.balance) {
        return ctx.reply(`❌ Số dư không đủ! Nhập lại:`);
      }

      user.balance -= amount;
      const reqId = Date.now();
      const withdrawInfo = user.tempWithdraw;

      db.withdraw_requests.push({
        id: reqId,
        userId: ctx.from.id,
        amount: amount,
        type: withdrawInfo.type,
        status: 'PENDING'
      });

      user.withdrawStep = null;
      user.tempWithdraw = {};
      saveData(db);

      ctx.reply(`✅ **ĐÃ GỬI YÊU CẦU RÚT TIỀN!** Vui lòng đợi Admin duyệt.`);

      const transferContent = `tra thuong vuot link ${user.accountCode}`;

      if (withdrawInfo.type === 'ATM') {
        const qrUrl = `https://img.vietqr.io/image/${withdrawInfo.bankName}-${withdrawInfo.accountNo}-compact2.jpg?amount=${amount}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(withdrawInfo.accountName)}`;

        bot.telegram.sendPhoto(
          ADMIN_ID,
          { url: qrUrl },
          {
            caption: `🚨 **YÊU CẦU RÚT ATM (#${reqId})**\n\n` +
                     `🆔 ID Acc: \`${user.accountCode}\`\n` +
                     `👤 User Telegram ID: \`${user.userId}\`\n` +
                     `💰 Số tiền: **${amount.toLocaleString('vi-VN')} VNĐ**\n` +
                     `🏦 Bank: ${withdrawInfo.bankName}\n` +
                     `🔢 STK: \`${withdrawInfo.accountNo}\`\n` +
                     `👤 Tên: ${withdrawInfo.accountName}\n` +
                     `📝 Nội dung CK:\n\`${transferContent}\``,
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Đã Chuyển', `APPROVE_${reqId}`), Markup.button.callback('❌ Hoàn Tiền', `REFUND_${reqId}`)]
            ])
          }
        ).catch(() => {
          bot.telegram.sendMessage(
            ADMIN_ID,
            `🚨 **YÊU CẦU RÚT ATM (#${reqId})** (Lỗi tải ảnh QR)\n\n` +
            `🆔 ID Acc: \`${user.accountCode}\`\n` +
            `💰 Số tiền: **${amount.toLocaleString('vi-VN')} VNĐ**\n` +
            `🏦 Bank: ${withdrawInfo.bankName} | STK: \`${withdrawInfo.accountNo}\`\n` +
            `📝 Nội dung: \`${transferContent}\``,
            Markup.inlineKeyboard([
              [Markup.button.callback('✅ Đã Chuyển', `APPROVE_${reqId}`), Markup.button.callback('❌ Hoàn Tiền', `REFUND_${reqId}`)]
            ])
          );
        });
      } else {
        const usdtVal = (amount / USDT_RATE).toFixed(2);
        bot.telegram.sendMessage(
          ADMIN_ID,
          `🚨 **YÊU CẦU RÚT USDT BEP-20 (#${reqId})**\n\n` +
          `🆔 ID Acc: \`${user.accountCode}\`\n` +
          `👤 User ID: \`${user.userId}\`\n` +
          `💰 Số tiền: **${usdtVal} USDT** (${amount.toLocaleString('vi-VN')} VNĐ)\n` +
          `🌐 Ví BEP-20: \`${withdrawInfo.usdtWallet}\``,
          Markup.inlineKeyboard([
            [Markup.button.callback('✅ Đã Chuyển', `APPROVE_${reqId}`), Markup.button.callback('❌ Hoàn Tiền', `REFUND_${reqId}`)]
          ])
        );
      }
      return;
    }

    if (!user.waitingForCode) {
      return ctx.reply('👉 Vui lòng bấm nút tương ứng ở menu bên dưới!', getMainKeyboard());
    }

    if (text !== user.expectedCode) {
      return ctx.reply('❌ **SAI MÃ XÁC NHẬN!** Vui lòng thử lại hoặc gõ `/huy`.');
    }

    const now = Date.now();
    db.redeemed_codes.push(text);
    user.balance += REWARD_PER_LINK;
    user.lastBypassTime = now;
    user.waitingForCode = false;
    user.expectedCode = null;

    if (user.referredBy && !user.refRewarded) {
      const referrer = db.users[user.referredBy];
      if (referrer) {
        referrer.balance += REWARD_PER_REF;
        referrer.refCount = (referrer.refCount || 0) + 1;
        
        bot.telegram.sendMessage(
          user.referredBy, 
          `🎉 **THƯỞNG GIỚI THIỆU!**\n\nThành viên do bạn mời vừa hoàn thành vượt link đầu tiên!\n💰 Cộng: **+${REWARD_PER_REF} VNĐ**.`
        ).catch(() => {});
      }
      user.refRewarded = true;
    }

    saveData(db);

    ctx.reply(
      `🎉 **XÁC NHẬN MÃ CHÍNH XÁC!**\n\n` +
      `💰 Cộng: **+${REWARD_PER_LINK} VNĐ**\n` +
      `💵 Số dư mới: **${user.balance.toLocaleString('vi-VN')} VNĐ**\n\n` +
      `Bấm menu bên dưới để tiếp tục:`,
      getMainKeyboard()
    );
  } catch (err) {
    console.error('Lỗi ở xử lý text:', err);
  }
});

bot.launch()
  .then(() => console.log('⚡ Bot Telegram đã chạy thành công!'))
  .catch((err) => console.error('Lỗi chạy bot:', err));

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot Telegram đang hoạt động 24/7!');
});

app.listen(PORT, () => {
  console.log(`Web Server nghe cổng ${PORT} để Render giữ kết nối.`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
