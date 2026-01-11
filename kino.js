const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8595951105:AAEgCbk2ZqJRtrOJ1-gpZNTEwTphmx_wUws';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kino17bot?appName=abumafia';

// Bir nechta admin
const ADMIN_IDS = [6606638731, 6355141067, 7962180552, 6671258886]; // Raqamlar bilan!

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL; // Render avto beradi
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123'; // Ixtiyoriy himoya

mongoose.connect(MONGODB_URL)
    .then(() => console.log('MongoDB ulandi'))
    .catch(err => console.error('MongoDB xatosi:', err));

// Schemalar
const userSchema = new mongoose.Schema({
    user_id: { type: Number, required: true, unique: true },
    username: String,
    first_name: String,
    join_date: { type: Date, default: Date.now }
});

const movieSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    file_id: { type: String, required: true },
    caption: String,
    date: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
    chat_username: { type: String, required: true },
    chat_id: { type: String, unique: true },
    type: { type: String, enum: ['channel', 'group'], required: true },
    is_private: { type: Boolean, default: false },
    invite_link: String
});

const User = mongoose.model('User', userSchema);
const Movie = mongoose.model('Movie', movieSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Bot yaratish
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Session xavfsizligi
function ensureSession(ctx) {
    if (!ctx.session) ctx.session = {};
}

// Admin tekshirish
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Kanal linkini parse qilish
function parseChatLink(input) {
    const text = input.trim();
    
    // @username format
    if (text.startsWith('@')) {
        return {
            type: text.includes('channel') || text.includes('Group') ? 'channel' : 'unknown',
            identifier: text,
            isPrivate: false,
            inviteHash: null
        };
    }
    
    // https://t.me/username format
    if (text.includes('https://t.me/')) {
        const match = text.match(/https:\/\/t\.me\/(.+)/);
        if (match) {
            const identifier = match[1];
            return {
                type: identifier.startsWith('+') ? 'private' : 'public',
                identifier: identifier.startsWith('+') ? identifier : `@${identifier}`,
                isPrivate: identifier.startsWith('+'),
                inviteHash: identifier.startsWith('+') ? identifier.slice(1) : null
            };
        }
    }
    
    // +dR2CFxyLVS4zNGVI format
    if (text.startsWith('+')) {
        return {
            type: 'private',
            identifier: text,
            isPrivate: true,
            inviteHash: text.slice(1)
        };
    }
    
    return null;
}

// Obuna tekshirish (faqat public kanal/guruhlar uchun)
async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        const subs = await Subscription.find({});
        if (subs.length === 0) return true;

        for (const sub of subs) {
            // Maxfiy kanal/guruhlar uchun tekshirishni o'tkazib yuboramiz
            if (sub.is_private) continue;
            
            try {
                const member = await bot.telegram.getChatMember(sub.chat_username, userId);
                const status = member.status;
                if (status === 'left' || status === 'kicked' || status === 'banned') {
                    return false;
                }
            } catch (error) {
                console.error(`Obuna xatosi (${sub.chat_username}):`, error.message);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Obunalar xatosi:', error);
        return false;
    }
}

// Obuna klaviaturasi
async function getSubscriptionKeyboard() {
    const subs = await Subscription.find({});
    const rows = [];
    
    for (const sub of subs) {
        let buttonText = '';
        let url = '';
        
        if (sub.is_private) {
            // Maxfiy kanal uchun
            buttonText = sub.type === 'channel' ? '🔒 Maxfiy Kanal' : '🔒 Maxfiy Guruh';
            url = sub.invite_link || `https://t.me/${sub.chat_username}`;
        } else {
            // Ochiq kanal uchun
            buttonText = sub.type === 'channel' ? '📢 Kanal' : '👥 Guruh';
            const username = sub.chat_username.replace('@', '');
            url = `https://t.me/${username}`;
        }
        
        rows.push([Markup.button.url(buttonText, url)]);
    }
    
    rows.push([Markup.button.callback('✅ Tekshirish', 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
}

// User qo'shish
async function addUser(ctx) {
    try {
        const existing = await User.findOne({ user_id: ctx.from.id });
        if (!existing) {
            await User.create({
                user_id: ctx.from.id,
                username: ctx.from.username || null,
                first_name: ctx.from.first_name || null
            });
        }
    } catch (error) {
        console.error('User qo\'shish xatosi:', error);
    }
}

// Maxfiy kanalni tekshirish va saqlash
async function addPrivateSubscription(chatLink, type) {
    try {
        // Linkni tahlil qilish
        const parsed = parseChatLink(chatLink);
        if (!parsed) return { success: false, message: 'Noto\'g\'ri link format' };
        
        // Ma'lumotlarni tayyorlash
        const subscriptionData = {
            chat_username: parsed.identifier,
            type: type,
            is_private: true,
            invite_link: chatLink.startsWith('http') ? chatLink : `https://t.me/${parsed.identifier}`
        };
        
        // Bazaga saqlash
        await Subscription.create(subscriptionData);
        return { success: true, message: `✅ ${type === 'channel' ? 'Maxfiy kanal' : 'Maxfiy guruh'} qoʻshildi!` };
        
    } catch (err) {
        if (err.code === 11000) return { success: false, message: 'Bu kanal allaqachon qoʻshilgan.' };
        return { success: false, message: 'Xatolik yuz berdi.' };
    }
}

// Public kanalni tekshirish va saqlash
async function addPublicSubscription(chatLink, type) {
    try {
        const chatId = chatLink.startsWith('@') ? chatLink : `@${chatLink}`;
        
        // Bot kanalda adminligini tekshirish
        try {
            await bot.telegram.getChat(chatId);
            const admins = await bot.telegram.getChatAdministrators(chatId);
            const isBotAdmin = admins.some(admin => admin.user.id === bot.botInfo.id);
            
            if (!isBotAdmin) {
                return { success: false, message: 'Bot kanalda admin emas. Botni kanalga admin qiling va qayta urinib ko\'ring.' };
            }
        } catch (error) {
            return { success: false, message: 'Kanal topilmadi yoki bot kanalda admin emas.' };
        }
        
        // Bazaga saqlash
        await Subscription.create({
            chat_username: chatId,
            type: type,
            is_private: false
        });
        
        return { success: true, message: `✅ ${type === 'channel' ? 'Kanal' : 'Guruh'} qoʻshildi!` };
        
    } catch (err) {
        if (err.code === 11000) return { success: false, message: 'Bu kanal allaqachon qoʻshilgan.' };
        return { success: false, message: 'Xatolik yuz berdi.' };
    }
}

// Barcha handlerlar
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish']
        ]).resize();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!', adminKeyboard);
    }

    ctx.reply('🎥 Botga xush kelibsiz!\nKino olish uchun kod yuboring (masalan: 7)');
});

bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (isSubscribed || isAdmin(userId)) {
        await addUser(ctx);
        if (isAdmin(userId)) {
            const adminKeyboard = Markup.keyboard([
                ['🎬 Kino qoʻshish', '📊 Statistika'],
                ['📢 Broadcast'],
                ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
                ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish']
            ]).resize();
            return ctx.reply('✅ Obuna tasdiqlandi! Admin panelga xush kelibsiz!', adminKeyboard);
        }
        return ctx.reply('✅ Obuna tasdiqlandi! Kino olish uchun kod yuboring.');
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.reply('Hali barcha kanal va guruhlarga obuna boʻlmagansiz:', keyboard);
});

// Barcha admin tugmalari va handlerlar
bot.hears('🎬 Kino qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.addingMovie = true;
    ctx.reply('🎬 Kino qoʻshish rejimi yoqildi!\nHar qanday chatdan (shaxsiy, guruh, kanal) video yuboring yoki forward qiling!');
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const movies = await Movie.countDocuments();
        const subs = await Subscription.countDocuments();
        const publicSubs = await Subscription.countDocuments({ is_private: false });
        const privateSubs = await Subscription.countDocuments({ is_private: true });
        ctx.reply(`📊 Statistika:\n\n👥 Foydalanuvchilar: ${users}\n🎬 Kinolar: ${movies}\n📢 Majburiy obunalar: ${subs}\n   └ Ochiq: ${publicSubs}\n   └ Maxfiy: ${privateSubs}`);
    } catch (err) {
        ctx.reply('Statistika olishda xatolik');
    }
});

bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.broadcasting = true;
    ctx.reply('Broadcast uchun matn, rasm, video yoki boshqa kontent yuboring:');
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingChannel = true;
    ctx.reply('Yangi kanal linkini yuboring:\n\n' +
             '- Public kanal: @kanal_username yoki https://t.me/kanal_username\n' +
             '- Private kanal: https://t.me/+dR2CFxyLVS4zNGVI yoki +dR2CFxyLVS4zNGVI');
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingGroup = true;
    ctx.reply('Yangi guruh linkini yuboring:\n\n' +
             '- Public guruh: @guruh_username yoki https://t.me/guruh_username\n' +
             '- Private guruh: https://t.me/+dR2CFxyLVS4zNGVI yoki +dR2CFxyLVS4zNGVI');
});

bot.hears('📋 Roʻyxatni koʻrish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const subs = await Subscription.find({});
    if (subs.length === 0) return ctx.reply('Hozircha majburiy obuna yoʻq.');
    const list = subs.map((s, i) => 
        `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username} ${s.is_private ? '🔒' : '🌐'}`
    ).join('\n');
    ctx.reply(`📋 Majburiy obunalar:\n\n${list}`);
});

bot.hears('➖ Oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.deletingSub = true;
    ctx.reply('Oʻchirish uchun kanal yoki guruh username/linkini yuboring:');
});

// VIDEO QABUL QILISH
bot.on('video', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    if (!ctx.session.addingMovie) return;

    ctx.session.movieData = {
        file_id: ctx.message.video.file_id,
        caption: ctx.message.caption || ''
    };
    ctx.session.waitingForCode = true;
    ctx.reply('✅ Video qabul qilindi!\nEndi kino kodi yuboring (masalan: 7):');
});

bot.on('text', async (ctx) => {
    ensureSession(ctx);
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Kanal qo'shish
    if (isAdmin(userId) && ctx.session.awaitingChannel) {
        const parsed = parseChatLink(text);
        
        if (!parsed) {
            return ctx.reply('❌ Noto\'g\'ri format. Iltimos, quyidagi formatlardan birini kiriting:\n' +
                           '- @kanal_username\n' +
                           '- https://t.me/kanal_username\n' +
                           '- https://t.me/+invitehash\n' +
                           '- +invitehash');
        }
        
        delete ctx.session.awaitingChannel;
        
        if (parsed.isPrivate) {
            // Maxfiy kanal
            const result = await addPrivateSubscription(text, 'channel');
            return ctx.reply(result.message);
        } else {
            // Ochiq kanal
            const result = await addPublicSubscription(text, 'channel');
            return ctx.reply(result.message);
        }
    }

    // Guruh qo'shish
    if (isAdmin(userId) && ctx.session.awaitingGroup) {
        const parsed = parseChatLink(text);
        
        if (!parsed) {
            return ctx.reply('❌ Noto\'g\'ri format. Iltimos, quyidagi formatlardan birini kiriting:\n' +
                           '- @guruh_username\n' +
                           '- https://t.me/guruh_username\n' +
                           '- https://t.me/+invitehash\n' +
                           '- +invitehash');
        }
        
        delete ctx.session.awaitingGroup;
        
        if (parsed.isPrivate) {
            // Maxfiy guruh
            const result = await addPrivateSubscription(text, 'group');
            return ctx.reply(result.message);
        } else {
            // Ochiq guruh
            const result = await addPublicSubscription(text, 'group');
            return ctx.reply(result.message);
        }
    }

    // O'chirish
    if (isAdmin(userId) && ctx.session.deletingSub) {
        const result = await Subscription.deleteOne({ 
            $or: [
                { chat_username: text },
                { invite_link: text }
            ]
        });
        delete ctx.session.deletingSub;
        if (result.deletedCount > 0) {
            return ctx.reply(`✅ Oʻchirildi.`);
        } else {
            return ctx.reply('❌ Bunday obuna topilmadi.');
        }
    }

    // Kino kodini qabul qilish
    if (isAdmin(userId) && ctx.session.waitingForCode && ctx.session.movieData) {
        const code = text;
        try {
            const existing = await Movie.findOne({ code });
            if (existing) return ctx.reply(`⚠️ ${code} kodi allaqachon ishlatilgan. Boshqa kod kiriting:`);

            await Movie.create({
                code,
                file_id: ctx.session.movieData.file_id,
                caption: ctx.session.movieData.caption
            });

            ctx.session.addingMovie = false;
            ctx.session.waitingForCode = false;
            ctx.session.movieData = null;

            return ctx.reply(`✅ ${code} kodli kino muvaffaqiyatli saqlandi!`);
        } catch (err) {
            return ctx.reply('Saqlashda xatolik yuz berdi.');
        }
    }

    // Broadcast
    if (isAdmin(userId) && ctx.session.broadcasting) {
        try {
            const users = await User.find({});
            let success = 0;
            for (const user of users) {
                try {
                    await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                    success++;
                } catch (e) { }
            }
            ctx.session.broadcasting = false;
            return ctx.reply(`✅ Broadcast ${success} ta foydalanuvchiga yuborildi.`);
        } catch (err) {
            ctx.session.broadcasting = false;
            return ctx.reply('Broadcastda xatolik.');
        }
    }

    // Oddiy foydalanuvchi uchun kino qidirish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Avval barcha kanal va guruhlarga obuna boʻling:', keyboard);
    }

    const code = text;
    const movie = await Movie.findOne({ code });
    if (!movie) {
        return ctx.reply('❌ Bunday kodda kino topilmadi.');
    }

    await ctx.replyWithVideo(movie.file_id, {
        caption: movie.caption || `🎬 Kino kodi: ${movie.code}`
    });
});

// Boshqa turdagi kontentlar bilan broadcast
bot.on(['photo', 'document', 'audio', 'voice', 'animation'], async (ctx) => {
    ensureSession(ctx);
    if (!isAdmin(ctx.from.id) || !ctx.session.broadcasting) return;

    try {
        const users = await User.find({});
        let success = 0;
        for (const user of users) {
            try {
                await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                success++;
            } catch (e) { }
        }
        ctx.session.broadcasting = false;
        ctx.reply(`✅ Broadcast ${success} ta foydalanuvchiga yuborildi.`);
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('Broadcastda xatolik.');
    }
});

// === WEBHOOK SOZLASH ===
if (URL) {
    // Render.com da webhook ornatish
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;

    bot.telegram.setWebhook(fullUrl, {
        secret_token: WEBHOOK_SECRET
    }).then(() => {
        console.log(`Webhook o'rnatildi: ${fullUrl}`);
    }).catch(err => {
        console.error('Webhook o\'rnatishda xato:', err.message);
    });

    // Express server yaratish (Render uchun majburiy)
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.use(bot.webhookCallback(webhookPath));

    // Asosiy sahifa (Render so'raganda javob berish uchun)
    app.get('/', (req, res) => {
        res.send('Bot ishlamoqda! 🚀');
    });

    app.listen(PORT, () => {
        console.log(`Server ${PORT} portda ishga tushdi`);
        console.log(`Webhook URL: ${fullUrl}`);
    });
} else {
    // Local test uchun polling
    bot.launch()
        .then(() => console.log('Bot polling rejimida ishga tushdi (local)'))
        .catch(err => console.error('Xatolik:', err));
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
