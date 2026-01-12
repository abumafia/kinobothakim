const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8595951105:AAEgCbk2ZqJRtrOJ1-gpZNTEwTphmx_wUws';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kino17bot?appName=abumafia';

// Adminlar ro'yxati
const ADMIN_IDS = [6606638731, 6355141067, 7962180552, 6671258886];

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123';

// MongoDB ulanish
mongoose.connect(MONGODB_URL)
    .then(() => console.log('✅ MongoDB ulandi'))
    .catch(err => console.error('❌ MongoDB xatosi:', err));

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
    chat_username: { type: String, required: true, unique: true },
    chat_id: { type: String, unique: true },
    type: { type: String, enum: ['channel', 'group'], required: true },
    is_private: { type: Boolean, default: false },
    invite_link: String,
    added_date: { type: Date, default: Date.now }
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
            type: 'public',
            identifier: text.toLowerCase(),
            isPrivate: false,
            inviteHash: null
        };
    }
    
    // https://t.me/username format
    if (text.includes('https://t.me/')) {
        const match = text.match(/https:\/\/t\.me\/(.+)/);
        if (match) {
            const identifier = match[1];
            if (identifier.startsWith('+')) {
                return {
                    type: 'private',
                    identifier: `@${identifier}`,
                    isPrivate: true,
                    inviteHash: identifier
                };
            } else {
                return {
                    type: 'public',
                    identifier: `@${identifier}`.toLowerCase(),
                    isPrivate: false,
                    inviteHash: null
                };
            }
        }
    }
    
    // +invitehash format
    if (text.startsWith('+')) {
        return {
            type: 'private',
            identifier: `@${text}`,
            isPrivate: true,
            inviteHash: text
        };
    }
    
    return null;
}

// Obuna tekshirish
async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        const subs = await Subscription.find({});
        if (subs.length === 0) return true;

        for (const sub of subs) {
            // Maxfiy kanal/guruhlar uchun tekshirishni o'tkazib yuboramiz
            if (sub.is_private) continue;
            
            try {
                const chatId = sub.chat_username.replace('@', '');
                const member = await bot.telegram.getChatMember(chatId, userId);
                const status = member.status;
                
                if (status === 'left' || status === 'kicked') {
                    return false;
                }
            } catch (error) {
                console.error(`❌ Obuna tekshirish xatosi (${sub.chat_username}):`, error.message);
                // Agar kanal topilmasa, obunani o'chiramiz
                await Subscription.deleteOne({ chat_username: sub.chat_username });
                continue;
            }
        }
        return true;
    } catch (error) {
        console.error('❌ Obunalar xatosi:', error);
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
            buttonText = sub.type === 'channel' ? '🔒 Maxfiy Kanal' : '🔒 Maxfiy Guruh';
            url = sub.invite_link || `https://t.me/${sub.chat_username.replace('@', '')}`;
        } else {
            buttonText = sub.type === 'channel' ? '📢 Kanal' : '👥 Guruh';
            const username = sub.chat_username.replace('@', '');
            url = `https://t.me/${username}`;
        }
        
        rows.push([Markup.button.url(buttonText, url)]);
    }
    
    rows.push([Markup.button.callback('✅ Obunani tekshirish', 'check_subscription')]);
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
        console.error('❌ User qo\'shish xatosi:', error);
    }
}

// Kanal qo'shish (umumiy funksiya)
async function addSubscription(chatLink, type) {
    try {
        const parsed = parseChatLink(chatLink);
        if (!parsed) {
            return { success: false, message: '❌ Noto\'g\'ri link format' };
        }

        // Bazada mavjudligini tekshirish
        const existing = await Subscription.findOne({ 
            $or: [
                { chat_username: parsed.identifier },
                { invite_link: chatLink }
            ]
        });
        
        if (existing) {
            return { success: false, message: '❌ Bu kanal/guruh allaqachon qoʻshilgan.' };
        }

        if (parsed.isPrivate) {
            // Maxfiy kanal/guruh
            const subscriptionData = {
                chat_username: parsed.identifier,
                type: type,
                is_private: true,
                invite_link: chatLink.startsWith('http') ? chatLink : `https://t.me/${parsed.inviteHash}`
            };
            
            await Subscription.create(subscriptionData);
            return { 
                success: true, 
                message: `✅ ${type === 'channel' ? 'Maxfiy kanal' : 'Maxfiy guruh'} muvaffaqiyatli qoʻshildi!` 
            };
        } else {
            // Ochiq kanal/guruh
            const chatId = parsed.identifier.replace('@', '');
            
            try {
                // Bot adminligini tekshirish
                const chat = await bot.telegram.getChat(`@${chatId}`);
                
                if (chat.type !== 'channel' && chat.type !== 'supergroup') {
                    return { success: false, message: '❌ Bu kanal yoki guruh emas.' };
                }
                
                const admins = await bot.telegram.getChatAdministrators(`@${chatId}`);
                const isBotAdmin = admins.some(admin => admin.user.id === bot.botInfo.id);
                
                if (!isBotAdmin) {
                    return { success: false, message: '❌ Bot kanalda admin emas. Botni kanalga admin qiling va qayta urinib ko\'ring.' };
                }
                
                await Subscription.create({
                    chat_username: parsed.identifier,
                    type: type,
                    is_private: false
                });
                
                return { 
                    success: true, 
                    message: `✅ ${type === 'channel' ? 'Kanal' : 'Guruh'} muvaffaqiyatli qoʻshildi!` 
                };
            } catch (error) {
                if (error.description === 'Bad Request: chat not found') {
                    return { success: false, message: '❌ Kanal topilmadi. Username ni tekshiring yoki kanal ochiqligiga ishonch hosil qiling.' };
                }
                return { success: false, message: `❌ Xatolik: ${error.message}` };
            }
        }
    } catch (err) {
        console.error('❌ Kanal qo\'shish xatosi:', err);
        return { success: false, message: '❌ Ichki xatolik yuz berdi.' };
    }
}

// Kanal o'chirish
async function deleteSubscription(identifier) {
    try {
        const result = await Subscription.deleteOne({ 
            $or: [
                { chat_username: identifier.toLowerCase() },
                { invite_link: identifier },
                { chat_username: `@${identifier}`.toLowerCase() }
            ]
        });
        
        return result.deletedCount > 0;
    } catch (err) {
        console.error('❌ O\'chirish xatosi:', err);
        return false;
    }
}

// Barcha handlerlar
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply(
            '🤖 Botdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:\n' +
            '⚠️ Eslatma: Kanalga obuna bo\'lgach, "✅ Obunani tekshirish" tugmasini bosing.',
            keyboard
        );
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!', adminKeyboard);
    }

    ctx.reply(
        '🎥 Botga xush kelibsiz!\n\n' +
        'Kino olish uchun kod yuboring (masalan: 123)\n' +
        '⚠️ Diqqat: Bot 18+ kontent uchun mo\'ljallangan!'
    );
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
            ]).resize().oneTime();
            return ctx.reply('✅ Obuna tasdiqlandi! Admin panelga xush kelibsiz!', adminKeyboard);
        }
        return ctx.reply('✅ Obuna tasdiqlandi! Kino olish uchun kod yuboring.');
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.reply('❌ Hali barcha kanal va guruhlarga obuna boʻlmagansiz:', keyboard);
});

// Admin buyruqlari
bot.hears('🎬 Kino qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.addingMovie = true;
    ctx.reply(
        '🎬 Kino qoʻshish rejimi yoqildi!\n\n' +
        'Har qanday chatdan (shaxsiy, guruh, kanal) video yuboring yoki forward qiling!\n' +
        'Yuborgan videongizga izoh qo\'shishingiz mumkin (masalan: kino nomi, yili).\n' +
        'Keyin sizdan kino kodi so\'raladi.'
    );
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const movies = await Movie.countDocuments();
        const subs = await Subscription.countDocuments();
        const publicSubs = await Subscription.countDocuments({ is_private: false });
        const privateSubs = await Subscription.countDocuments({ is_private: true });
        
        ctx.reply(
            `📊 Bot statistikasi:\n\n` +
            `👥 Foydalanuvchilar: ${users}\n` +
            `🎬 Kinolar soni: ${movies}\n` +
            `📢 Majburiy obunalar: ${subs}\n` +
            `   ├ Ochiq kanal/guruh: ${publicSubs}\n` +
            `   └ Maxfiy kanal/guruh: ${privateSubs}`
        );
    } catch (err) {
        ctx.reply('❌ Statistika olishda xatolik');
    }
});

bot.hears('📢 Broadcast', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.broadcasting = true;
    ctx.reply(
        '📢 Broadcast rejimi yoqildi!\n\n' +
        'Barcha foydalanuvchilarga yubormoqchi bo\'lgan xabaringizni yuboring:\n' +
        'Matn, rasm, video, audio, dokument yoki boshqa kontent.'
    );
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingChannel = true;
    ctx.reply(
        '📢 Kanal qoʻshish rejimi:\n\n' +
        'Kanal linkini yuboring:\n' +
        '1. Public kanal: @kanal_username yoki https://t.me/kanal_username\n' +
        '2. Private kanal: https://t.me/+invitehash yoki +invitehash\n\n' +
        '⚠️ Eslatma: Public kanallarda bot admin bo\'lishi shart!'
    );
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingGroup = true;
    ctx.reply(
        '👥 Guruh qoʻshish rejimi:\n\n' +
        'Guruh linkini yuboring:\n' +
        '1. Public guruh: @guruh_username yoki https://t.me/guruh_username\n' +
        '2. Private guruh: https://t.me/+invitehash yoki +invitehash\n\n' +
        '⚠️ Eslatma: Public guruhlarda bot admin bo\'lishi shart!'
    );
});

bot.hears('📋 Roʻyxatni koʻrish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const subs = await Subscription.find({}).sort({ added_date: -1 });
    if (subs.length === 0) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');
    
    const list = subs.map((s, i) => 
        `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username} ${s.is_private ? '🔒' : '🌐'}`
    ).join('\n');
    
    ctx.reply(`📋 Majburiy obunalar (${subs.length} ta):\n\n${list}`);
});

bot.hears('➖ Oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.deletingSub = true;
    ctx.reply(
        '🗑️ Obunani o\'chirish rejimi:\n\n' +
        'O\'chirmoqchi bo\'lgan kanal/guruhning username yoki linkini yuboring.\n' +
        'Namuna: @kanal_username yoki https://t.me/+invitehash'
    );
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
    ctx.reply('✅ Video qabul qilindi!\nEndi kino kodi yuboring (masalan: 123):');
});

// TEXT XABARLARNI QAYTA ISHLASH
bot.on('text', async (ctx) => {
    ensureSession(ctx);
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Kanal qo'shish
    if (isAdmin(userId) && ctx.session.awaitingChannel) {
        const result = await addSubscription(text, 'channel');
        delete ctx.session.awaitingChannel;
        return ctx.reply(result.message);
    }

    // Guruh qo'shish
    if (isAdmin(userId) && ctx.session.awaitingGroup) {
        const result = await addSubscription(text, 'group');
        delete ctx.session.awaitingGroup;
        return ctx.reply(result.message);
    }

    // Obunani o'chirish
    if (isAdmin(userId) && ctx.session.deletingSub) {
        const deleted = await deleteSubscription(text);
        delete ctx.session.deletingSub;
        if (deleted) {
            return ctx.reply(`✅ "${text}" obunasi o'chirildi.`);
        } else {
            return ctx.reply('❌ Bunday obuna topilmadi.');
        }
    }

    // Kino kodi qabul qilish
    if (isAdmin(userId) && ctx.session.waitingForCode && ctx.session.movieData) {
        const code = text;
        
        if (!/^\d+$/.test(code)) {
            return ctx.reply('❌ Kod faqat raqamlardan iborat bo\'lishi kerak. Qayta kiriting:');
        }

        try {
            const existing = await Movie.findOne({ code });
            if (existing) {
                return ctx.reply(`⚠️ ${code} kodi allaqachon mavjud. Boshqa kod kiriting:`);
            }

            await Movie.create({
                code,
                file_id: ctx.session.movieData.file_id,
                caption: ctx.session.movieData.caption || `Kino kodi: ${code}`
            });

            ctx.session.addingMovie = false;
            ctx.session.waitingForCode = false;
            delete ctx.session.movieData;

            return ctx.reply(`✅ ${code} kodli kino muvaffaqiyatli saqlandi!`);
        } catch (err) {
            console.error('❌ Kino saqlash xatosi:', err);
            return ctx.reply('❌ Saqlashda xatolik yuz berdi. Qayta urinib ko\'ring.');
        }
    }

    // Broadcast
    if (isAdmin(userId) && ctx.session.broadcasting) {
        try {
            const users = await User.find({});
            let success = 0;
            let failed = 0;
            
            for (const user of users) {
                try {
                    await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                    success++;
                    
                    // Har 50ta xabardan keyin biroz kutamiz
                    if (success % 50 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (e) {
                    failed++;
                }
            }
            
            ctx.session.broadcasting = false;
            return ctx.reply(
                `✅ Broadcast yakunlandi!\n` +
                `📤 Yuborildi: ${success} ta\n` +
                `❌ Yuborilmadi: ${failed} ta`
            );
        } catch (err) {
            ctx.session.broadcasting = false;
            return ctx.reply('❌ Broadcastda xatolik yuz berdi.');
        }
    }

    // Foydalanuvchi uchun kino qidirish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('❌ Avval barcha kanal va guruhlarga obuna boʻling:', keyboard);
    }

    // Kino kodini qidirish
    if (/^\d+$/.test(text)) {
        await addUser(ctx);
        const movie = await Movie.findOne({ code: text });
        
        if (!movie) {
            return ctx.reply('❌ Bunday kodda kino topilmadi.');
        }

        try {
            await ctx.replyWithVideo(movie.file_id, {
                caption: movie.caption || `🎬 Kino kodi: ${movie.code}\n\n@Kino17Bot`,
                parse_mode: 'HTML'
            });
        } catch (err) {
            console.error('❌ Video yuborish xatosi:', err);
            ctx.reply('❌ Video yuborishda xatolik yuz berdi. Adminlarga murojaat qiling.');
        }
    } else {
        ctx.reply('⚠️ Iltimos, faqat raqamlardan iborat kino kodini yuboring.');
    }
});

// BOSHQA KONTENT TURLARI UCHUN BROADCAST
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
                
                if (success % 50 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (e) {
                // O'tkazib yuborish
            }
        }
        
        ctx.session.broadcasting = false;
        ctx.reply(`✅ Broadcast ${success} ta foydalanuvchiga yuborildi.`);
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('❌ Broadcastda xatolik yuz berdi.');
    }
});

// === WEBHOOK SOZLASH ===
if (URL) {
    // Render.com uchun webhook
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;

    bot.telegram.setWebhook(fullUrl, {
        secret_token: WEBHOOK_SECRET
    }).then(() => {
        console.log(`✅ Webhook o'rnatildi: ${fullUrl}`);
    }).catch(err => {
        console.error('❌ Webhook o\'rnatishda xato:', err.message);
    });

    // Express server
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use(bot.webhookCallback(webhookPath));

    app.get('/', (req, res) => {
        res.send('🎬 Kino17Bot ishlamoqda! 🚀');
    });

    app.listen(PORT, () => {
        console.log(`✅ Server ${PORT} portda ishga tushdi`);
    });
} else {
    // Local test uchun polling
    bot.launch()
        .then(() => console.log('✅ Bot polling rejimida ishga tushdi'))
        .catch(err => console.error('❌ Xatolik:', err));
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🚀 Bot mukammal ishlashga tayyor!');
