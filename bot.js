const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

const BOT_TOKEN = '8941809628:AAEaLRwYTQLGsxdaidOeD3-StKpaiSYFdMI';
const ADMIN_ID = 8941809628; 
const LINK4M_API_TOKEN = '6a8105012004f1159849220d'; 

const REWARD_PER_LINK = 350; 
const MIN_WITHDRAW_VN = 10000; 
const USDT_RATE = 25000; 
const MIN_WITHDRAW_USDT_VAL = 0.5; 
const MIN_WITHDRAW_USDT_VND = MIN_WITHDRAW_USDT_VAL * USDT_RATE; 

const COOLDOWN_TIME = 0; 
const DB_FILE = './data.json';

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = { users: {}, redeemed_codes: [], withdraw_requests: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(data, userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      userId,
      balance: 0,
      bankName: null,
      accountNo: null,
      accountName: null,
      usdtWallet: null,
      lastBypassTime: 0,
      waitingForCode: false,
      expectedCode: null
    };
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
    [Markup.button.callback('🏦 RÚT VN (ATM)', 'MENU_WITHDRAW_VN'), Markup.button.callback('🌐 RÚT BEP 20 (USDT)', 'MENU_WITHDRAW_USDT')],
    [Markup.button.callback('⚙️ Cài Đặt Ngân Hàng / Ví', 'MENU_SETTINGS')]
  ]);
}

bot.start((ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.lastBypassTime = 0;
  user.waitingForCode = false;
  user.expectedCode = null;
  saveData(db);

  ctx.reply(
    `👋 Chào mừng **${ctx.from.first_name}** đến với Bot Vượt Link Kiếm Tiền!\n\n` +
    `💰 **Số dư:** ${user.balance.toLocaleString('vi-VN')} VNĐ (~${(user.balance / USDT_RATE).toFixed(2)} USDT)\n` +
    `🎁 **Thưởng:** +${REWARD_PER_LINK} VNĐ / 1 mã vượt thành công.\n\n` +
    `Chọn chức năng phía dưới:`,
    getMainKeyboard()
  );
});

bot.action('MENU_HOME', async (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  const now = Date.now();
  const timePassed = now - user.lastBypassTime;
  
  if (COOLDOWN_TIME > 0 && timePassed < COOLDOWN_TIME) {
    const remainingSec = Math.ceil((COOLDOWN_TIME - timePassed) / 1000);
    const min = Math.floor(remainingSec / 60);
    const sec = remainingSec % 60;
    return ctx.reply(`⏳ **Đang trong thời gian chờ:** Vui lòng đợi **${min} phút ${sec} giây** nữa mới được lấy link tiếp theo!`, getMainKeyboard());
  }

  const generatedCode = generateDynamicCode();
  ctx.reply('⏳ Đang khởi tạo link chứa mã xác nhận duy nhất cho bạn...');

  const shortLink = await createDynamicLink(generatedCode);

  if (!shortLink) {
    return ctx.reply('❌ Có lỗi xảy ra khi tạo link. Vui lòng bấm thử lại!');
  }

  user.waitingForCode = true;
  user.expectedCode = generatedCode;
  saveData(db);

  ctx.reply(
    `🏠 **PHẦN 1: LẤY LINK VƯỢT KIẾM TIỀN**\n\n` +
    `🔗 **Link Vượt Dành Riêng Cho Bạn:**\n${shortLink}\n\n` +
    `👉 **Bước 1:** Bấm vào link trên và thực hiện vượt link.\n` +
    `👉 **Bước 2:** Sau khi vượt xong sẽ hiện mã dạng \`UQ...\`.\n` +
    `👉 **Bước 3:** Sao chép mã đó và dán vào đây để nhận **+350 VNĐ**.\n\n` +
    `⚠️ Hoặc gõ lệnh \`/huy\` để hủy lượt này.`,
    Markup.inlineKeyboard([
      [Markup.button.callback('❌ Hủy & Về Trang Chủ', 'CANCEL_ACTION')]
    ])
  );
});

bot.action('CANCEL_ACTION', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  user.expectedCode = null;
  saveData(db);

  ctx.deleteMessage().catch(() => {});
  ctx.reply('🏠 Đã hủy. Quay lại trang chủ:', getMainKeyboard());
});

bot.hears(/^\/huy$/i, (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  user.expectedCode = null;
  saveData(db);

  ctx.reply('🏠 Đã hủy thao tác nhập mã. Quay lại trang chủ:', getMainKeyboard());
});

bot.action('MENU_WITHDRAW_VN', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  saveData(db);

  let msg = `🏦 **PHẦN 2: RÚT TIỀN VỀ ATM (VNĐ)**\n\n`;
  msg += `💰 Số dư hiện tại: **${user.balance.toLocaleString('vi-VN')} VNĐ**\n`;
  msg += `📌 Rút tối thiểu: **${MIN_WITHDRAW_VN.toLocaleString('vi-VN')} VNĐ**\n\n`;
  msg += `🏦 Ngân hàng: ${user.bankName || 'Chưa cài'}\n`;
  msg += `🔢 STK: ${user.accountNo || 'Chưa cài'}\n`;
  msg += `👤 Tên chủ TK: ${user.accountName || 'Chưa cài'}\n`;

  ctx.reply(msg, Markup.inlineKeyboard([
    [Markup.button.callback('💸 Xác Nhận Rút ATM', 'EXECUTE_WITHDRAW_VN')],
    [Markup.button.callback('⬅️ Quay Lại Menu', 'BACK_MAIN')]
  ]));
});

bot.action('MENU_WITHDRAW_USDT', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  saveData(db);

  const usdtBalance = (user.balance / USDT_RATE).toFixed(2);
  let msg = `🌐 **PHẦN 3: RÚT TIỀN VỀ VÍ BEP-20 (USDT)**\n\n`;
  msg += `💰 Số dư: **${user.balance.toLocaleString('vi-VN')} VNĐ** (~${usdtBalance} USDT)\n`;
  msg += `📌 Rút tối thiểu: **0.5 USDT** (${MIN_WITHDRAW_USDT_VND.toLocaleString('vi-VN')} VNĐ)\n`;
  msg += `💱 Tỷ giá quy đổi: **1 USDT = ${USDT_RATE.toLocaleString('vi-VN')} VNĐ**\n\n`;
  msg += `🌐 Địa chỉ ví BEP-20: \`${user.usdtWallet || 'Chưa cài'}\`\n`;

  ctx.reply(msg, Markup.inlineKeyboard([
    [Markup.button.callback('💸 Xác Nhận Rút USDT', 'EXECUTE_WITHDRAW_USDT')],
    [Markup.button.callback('⬅️ Quay Lại Menu', 'BACK_MAIN')]
  ]));
});

bot.action('MENU_SETTINGS', (ctx) => {
  ctx.reply(
    `⚙️ **CÀI ĐẶT THÔNG TIN RÚT TIỀN**\n\n` +
    `1️⃣ **Cài ATM:**\n\`/bank Tên_Bank | STK | Tên_Chủ_TK\`\n*VD:* \`/bank MBBank | 0987654321 | NGUYEN VAN A\`\n\n` +
    `2️⃣ **Cài Ví USDT BEP-20:**\n\`/usdt Địa_Chỉ_Ví_BEP20\`\n*VD:* \`/usdt 0x1234567890abcdef...\``
  );
});

bot.action('BACK_MAIN', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.waitingForCode = false;
  saveData(db);

  ctx.deleteMessage().catch(() => {});
  ctx.reply('Quay lại menu chính:', getMainKeyboard());
});

bot.hears(/^\/bank (.+)/i, (ctx) => {
  const input = ctx.match[1].split('|').map(s => s.trim());
  if (input.length < 3) return ctx.reply('❌ Cú pháp sai! Dạng đúng: `/bank Tên_Bank | STK | Tên_Chủ_TK`');

  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.bankName = input[0].toUpperCase();
  user.accountNo = input[1];
  user.accountName = input[2].toUpperCase();
  saveData(db);

  ctx.reply('✅ Đã lưu thông tin Ngân Hàng!');
});

bot.hears(/^\/usdt (.+)/i, (ctx) => {
  const wallet = ctx.match[1].trim();
  if (!wallet.startsWith('0x') || wallet.length < 30) return ctx.reply('❌ Địa chỉ ví BEP-20 không hợp lệ!');

  const db = loadData();
  const user = getUser(db, ctx.from.id);
  user.usdtWallet = wallet;
  saveData(db);

  ctx.reply('✅ Đã lưu Địa chỉ ví USDT (BEP-20)!');
});

bot.action('EXECUTE_WITHDRAW_VN', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  if (!user.bankName || !user.accountNo || !user.accountName) return ctx.reply('❌ Vui lòng cài đặt thông tin Ngân hàng trước!');
  if (user.balance < MIN_WITHDRAW_VN) return ctx.reply(`❌ Số dư không đủ! Cần tối thiểu ${MIN_WITHDRAW_VN.toLocaleString('vi-VN')} VNĐ.`);

  const withdrawAmount = user.balance;
  user.balance = 0;

  const reqId = Date.now();
  db.withdraw_requests.push({ id: reqId, userId: ctx.from.id, amount: withdrawAmount, type: 'ATM', status: 'PENDING' });
  saveData(db);

  ctx.reply('⏳ Yêu cầu rút tiền ATM của bạn đã gửi cho Admin duyệt!');

  bot.telegram.sendMessage(
    ADMIN_ID,
    `🚨 **YÊU CẦU RÚT TIỀN ATM (#${reqId})**\n\n` +
    `👤 User ID: \`${user.userId}\`\n` +
    `💰 Số tiền: **${withdrawAmount.toLocaleString('vi-VN')} VNĐ**\n` +
    `🏦 Bank: ${user.bankName}\n` +
    `🔢 STK: \`${user.accountNo}\`\n` +
    `👤 Tên: ${user.accountName}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Đã Chuyển', `APPROVE_${reqId}`), Markup.button.callback('❌ Hoàn Tiền', `REFUND_${reqId}`)]
    ])
  );
});

bot.action('EXECUTE_WITHDRAW_USDT', (ctx) => {
  const db = loadData();
  const user = getUser(db, ctx.from.id);
  if (!user.usdtWallet) return ctx.reply('❌ Vui lòng cài đặt ví USDT (BEP-20) trước!');
  if (user.balance < MIN_WITHDRAW_USDT_VND) return ctx.reply(`❌ Số dư không đủ! Cần tối thiểu 0.5 USDT (${MIN_WITHDRAW_USDT_VND.toLocaleString('vi-VN')} VNĐ).`);

  const withdrawAmount = user.balance;
  const usdtValue = (withdrawAmount / USDT_RATE).toFixed(2);
  user.balance = 0;

  const reqId = Date.now();
  db.withdraw_requests.push({ id: reqId, userId: ctx.from.id, amount: withdrawAmount, type: 'USDT', status: 'PENDING' });
  saveData(db);

  ctx.reply('⏳ Yêu cầu rút USDT BEP-20 đã gửi cho Admin duyệt!');

  bot.telegram.sendMessage(
    ADMIN_ID,
    `🚨 **YÊU CẦU RÚT USDT BEP-20 (#${reqId})**\n\n` +
    `👤 User ID: \`${user.userId}\`\n` +
    `💰 Số tiền: **${usdtValue} USDT** (${withdrawAmount.toLocaleString('vi-VN')} VNĐ)\n` +
    `🌐 Ví BEP-20: \`${user.usdtWallet}\``,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Đã Chuyển', `APPROVE_${reqId}`), Markup.button.callback('❌ Hoàn Tiền', `REFUND_${reqId}`)]
    ])
  );
});

bot.action(/^APPROVE_(\d+)/, (ctx) => {
  const reqId = Number(ctx.match[1]);
  const db = loadData();
  const req = db.withdraw_requests.find(r => r.id === reqId);

  if (!req || req.status !== 'PENDING') return ctx.reply('⚠️ Lệnh này đã xử lý rồi!');

  req.status = 'APPROVED';
  saveData(db);

  ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n STATUS: ✅ **ĐÃ DUYỆT THÀNH CÔNG**');
  bot.telegram.sendMessage(req.userId, `🎉 **RÚT TIỀN THÀNH CÔNG!**\n\nYêu cầu rút tiền của bạn đã được Admin chuyển khoản thành công!`);
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

  ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n STATUS: ❌ **ĐÃ HOÀN TIỀN VỀ SỐ DƯ USER**');
  bot.telegram.sendMessage(req.userId, `❌ **LỆNH RÚT TIỀN BỊ HỦY!**\n\nYêu cầu rút tiền bị hủy. Số tiền ${req.amount.toLocaleString('vi-VN')} VNĐ đã được **HOÀN VỀ SỐ DƯ BOT** của bạn.`);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  const db = loadData();
  const user = getUser(db, ctx.from.id);

  if (!user.waitingForCode) {
    return ctx.reply('👉 Vui lòng bấm nút **"🏠 PHẦN 1: LẤY LINK VƯỢT"** trước khi nhập mã xác nhận!', getMainKeyboard());
  }

  if (text !== user.expectedCode) {
    return ctx.reply('❌ **SAI MÃ XÁC NHẬN!** Mã bạn nhập không khớp với link đã cấp. Vui lòng kiểm tra lại hoặc gõ `/huy` để hủy.');
  }

  const now = Date.now();
  db.redeemed_codes.push(text);
  user.balance += REWARD_PER_LINK;
  user.lastBypassTime = now;
  user.waitingForCode = false;
  user.expectedCode = null;
  saveData(db);

  ctx.reply(
    `🎉 **XÁC NHẬN MÃ CHÍNH XÁC!**\n\n` +
    `💰 Cộng: **+${REWARD_PER_LINK} VNĐ**\n` +
    `💵 Số dư mới: **${user.balance.toLocaleString('vi-VN')} VNĐ**\n\n` +
    `Bấm vào menu bên dưới để tiếp tục lượt tiếp theo:`,
    getMainKeyboard()
  );
});

bot.launch();
console.log('⚡ Bot Vượt Link Đã Khởi Động!');
