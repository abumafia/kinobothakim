const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// SOZLAMALAR
const BOT_TOKEN = '8595951105:AAEgCbk2ZqJRtrOJ1-gpZNTEwTphmx_wUws';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kino17bot?appName=abumafia';

// Adminlar ro'yxati
const ADMIN_IDS = [6606638731, 6355141067, 7962180552, 6671258886];

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 10000; // Render avtomatik 10000 portni ishlatadi
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'super_secret_token_123';

// MongoDB ulanish
mongoose.connect(MONGODB_URL)
    .then(async () => {
        console.log('✅ MongoDB ulandi');
        
        // Mavjud chat_id indeksini o'chirishga harakat qilamiz
        try {
            await mongoose.connection.db.collection('subscriptions').dropIndex('chat_id_1');
            console.log('✅ chat_id indeksi o\'chirildi');
        } catch (err) {
            console.log('ℹ️ Indeks allaqachon o\'chirilgan yoki mavjud emas');
        }
    })
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

// subscriptionSchema - chat_id ni BUTUNLAY OLIB TASHLAYMIZ!
const subscriptionSchema = new mongoose.Schema({
    chat_username: { type: String, required: true, unique: true },
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

// Obuna tekshirish - TO'LIQ ISHLASHI UCHUN QAYTA YOZILDI
async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        const subs = await Subscription.find({});
        if (subs.length === 0) return true;

        for (const sub of subs) {
            // Maxfiy kanal/guruhlar uchun tekshirishni o'tkazib yuboramiz
            if (sub.is_private) continue;
            
            try {
                // @ belgisini olib tashlaymiz
                const chatId = sub.chat_username.startsWith('@') 
                    ? sub.chat_username.substring(1) 
                    : sub.chat_username;
                
                // console.log(`Tekshirilayotgan kanal: ${chatId}, User: ${userId}`);
                const member = await bot.telegram.getChatMember(chatId, userId);
                const status = member.status;
                
                if (status === 'left' || status === 'kicked') {
                    console.log(`❌ User ${userId} kanal ${chatId} da a'zo emas`);
                    return false;
                }
                // console.log(`✅ User ${userId} kanal ${chatId} da a'zo`);
            } catch (error) {
                console.error(`❌ Obuna tekshirish xatosi (${sub.chat_username}):`, error.message);
                // Agar kanal topilmasa yoki bot admin bo'lmasa, obunani o'chiramiz
                if (error.description && error.description.includes('chat not found')) {
                    await Subscription.deleteOne({ chat_username: sub.chat_username });
                    console.log(`🗑️ ${sub.chat_username} kanali o'chirildi`);
                }
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

// Kanal qo'shish (umumiy funksiya) - TO'LIQ TUZATILDI
async function addSubscription(chatLink, type) {
    try {
        const parsed = parseChatLink(chatLink);
        if (!parsed) {
            return { success: false, message: '❌ Noto\'g\'ri link format' };
        }

        // Bazada mavjudligini tekshirish (chat_username bo'yicha)
        const existing = await Subscription.findOne({ 
            chat_username: parsed.identifier
        });
        
        if (existing) {
            return { success: false, message: '❌ Bu kanal/guruh allaqachon qoʻshilgan.' };
        }

        const subscriptionData = {
            chat_username: parsed.identifier,
            type: type,
            is_private: parsed.isPrivate,
            invite_link: null
        };

        if (parsed.isPrivate) {
            // Maxfiy kanal/guruh uchun
            subscriptionData.invite_link = chatLink.startsWith('http') ? chatLink : `https://t.me/${parsed.inviteHash}`;
        } else {
            // Ochiq kanal/guruh uchun bot adminligini tekshirish
            const chatId = parsed.identifier.replace('@', '');
            try {
                // console.log(`Kanalni tekshirish: @${chatId}`);
                const chat = await bot.telegram.getChat(`@${chatId}`);
                
                if (chat.type !== 'channel' && chat.type !== 'supergroup') {
                    return { success: false, message: '❌ Bu kanal yoki guruh emas.' };
                }
                
                // Bot adminligini tekshirish
                const admins = await bot.telegram.getChatAdministrators(`@${chatId}`);
                const isBotAdmin = admins.some(admin => admin.user.id === bot.botInfo.id);
                
                if (!isBotAdmin) {
                    return { success: false, message: '❌ Bot kanalda admin emas. Botni kanalga admin qiling va qayta urinib ko\'ring.' };
                }
            } catch (error) {
                console.error('Kanal tekshirish xatosi:', error.message);
                if (error.description && error.description.includes('chat not found')) {
                    return { success: false, message: '❌ Kanal topilmadi. Username ni tekshiring yoki kanal ochiqligiga ishonch hosil qiling.' };
                }
                return { success: false, message: `❌ Xatolik: ${error.description || error.message}` };
            }
        }
        
        await Subscription.create(subscriptionData);
        return { 
            success: true, 
            message: `✅ ${type === 'channel' ? 'Kanal' : 'Guruh'} muvaffaqiyatli qoʻshildi!\nUsername: ${parsed.identifier}` 
        };
        
    } catch (err) {
        console.error('❌ Kanal qo\'shish xatosi:', err);
        if (err.code === 11000) {
            return { success: false, message: '❌ Bu kanal/guruh allaqachon qoʻshilgan.' };
        }
        return { success: false, message: '❌ Ichki xatolik yuz berdi.' };
    }
}

// Kanal o'chirish
async function deleteSubscription(identifier) {
    try {
        const result = await Subscription.deleteOne({ 
            $or: [
                { chat_username: identifier.toLowerCase() },
                { chat_username: `@${identifier}`.toLowerCase() },
                { invite_link: identifier }
            ]
        });
        
        return result.deletedCount > 0;
    } catch (err) {
        console.error('❌ O\'chirish xatosi:', err);
        return false;
    }
}

// ====================== HANDLERLAR ======================

bot.start(async (ctx) => {
    console.log(`Start bosildi: ${ctx.from.id} - ${ctx.from.username}`);
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply(
            '🤖 *Botdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:*\n\n' +
            '1️⃣ Kanal/guruhga kirish uchun tugmani bosing\n' +
            '2️⃣ Obuna bo\'ling\n' +
            '3️⃣ *"✅ Obunani tekshirish"* tugmasini bosing\n\n' +
            '⚠️ *Eslatma:* Faqat obuna bo\'lish yetarli emas, tekshirish tugmasini ham bosing!',
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish']
        ]).resize().oneTime();
        return ctx.reply('👨‍💻 *Admin panelga xush kelibsiz!*', { parse_mode: 'Markdown', ...adminKeyboard });
    }

    ctx.reply(
        '🎥 *Botga xush kelibsiz!*\n\n' +
        'Kino olish uchun kod yuboring (masalan: 123)\n' +
        '⚠️ *Diqqat:* Bot 18+ kontent uchun mo\'ljallangan!',
        { parse_mode: 'Markdown' }
    );
});

bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    console.log(`Obuna tekshirildi: ${ctx.from.id}`);
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
            return ctx.reply('✅ *Obuna tasdiqlandi! Admin panelga xush kelibsiz!*', { parse_mode: 'Markdown', ...adminKeyboard });
        }
        return ctx.reply('✅ *Obuna tasdiqlandi! Kino olish uchun kod yuboring.*', { parse_mode: 'Markdown' });
    }

    const keyboard = await getSubscriptionKeyboard();
    ctx.reply('❌ *Hali barcha kanal va guruhlarga obuna boʻlmagansiz:*', { parse_mode: 'Markdown', ...keyboard });
});

// Admin buyruqlari
bot.hears('🎬 Kino qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.addingMovie = true;
    ctx.reply(
        '🎬 *Kino qoʻshish rejimi yoqildi!*\n\n' +
        'Har qanday chatdan (shaxsiy, guruh, kanal) video yuboring yoki forward qiling!\n' +
        'Yuborgan videongizga izoh qo\'shishingiz mumkin (masalan: kino nomi, yili).\n' +
        'Keyin sizdan kino kodi so\'raladi.',
        { parse_mode: 'Markdown' }
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
            `📊 *Bot statistikasi:*\n\n` +
            `👥 Foydalanuvchilar: ${users}\n` +
            `🎬 Kinolar soni: ${movies}\n` +
            `📢 Majburiy obunalar: ${subs}\n` +
            `   ├ Ochiq kanal/guruh: ${publicSubs}\n` +
            `   └ Maxfiy kanal/guruh: ${privateSubs}`,
            { parse_mode: 'Markdown' }
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
        '📢 *Broadcast rejimi yoqildi!*\n\n' +
        'Barcha foydalanuvchilarga yubormoqchi bo\'lgan xabaringizni yuboring:\n' +
        'Matn, rasm, video, audio, dokument yoki boshqa kontent.',
        { parse_mode: 'Markdown' }
    );
});

bot.hears('➕ Kanal qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingChannel = true;
    ctx.reply(
        '📢 *Kanal qoʻshish rejimi:*\n\n' +
        'Kanal linkini yuboring:\n' +
        '1. Public kanal: @kanal_username yoki https://t.me/kanal_username\n' +
        '2. Private kanal: https://t.me/+invitehash yoki +invitehash\n\n' +
        '⚠️ *Eslatma:* Public kanallarda bot admin bo\'lishi shart!',
        { parse_mode: 'Markdown' }
    );
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingGroup = true;
    ctx.reply(
        '👥 *Guruh qoʻshish rejimi:*\n\n' +
        'Guruh linkini yuboring:\n' +
        '1. Public guruh: @guruh_username yoki https://t.me/guruh_username\n' +
        '2. Private guruh: https://t.me/+invitehash yoki +invitehash\n\n' +
        '⚠️ *Eslatma:* Public guruhlarda bot admin bo\'lishi shart!',
        { parse_mode: 'Markdown' }
    );
});

bot.hears('📋 Roʻyxatni koʻrish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const subs = await Subscription.find({}).sort({ added_date: -1 });
    if (subs.length === 0) return ctx.reply('📭 Hozircha majburiy obuna yoʻq.');
    
    const list = subs.map((s, i) => 
        `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username} ${s.is_private ? '🔒' : '🌐'}`
    ).join('\n');
    
    ctx.reply(`📋 *Majburiy obunalar (${subs.length} ta):*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.hears('➖ Oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.deletingSub = true;
    ctx.reply(
        '🗑️ *Obunani o\'chirish rejimi:*\n\n' +
        'O\'chirmoqchi bo\'lgan kanal/guruhning username yoki linkini yuboring.\n' +
        'Namuna: @kanal_username yoki https://t.me/+invitehash',
        { parse_mode: 'Markdown' }
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
    ctx.reply('✅ *Video qabul qilindi!*\nEndi kino kodi yuboring (masalan: 123):', { parse_mode: 'Markdown' });
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
        return ctx.reply(result.message, { parse_mode: 'Markdown' });
    }

    // Guruh qo'shish
    if (isAdmin(userId) && ctx.session.awaitingGroup) {
        const result = await addSubscription(text, 'group');
        delete ctx.session.awaitingGroup;
        return ctx.reply(result.message, { parse_mode: 'Markdown' });
    }

    // Obunani o'chirish
    if (isAdmin(userId) && ctx.session.deletingSub) {
        const deleted = await deleteSubscription(text);
        delete ctx.session.deletingSub;
        if (deleted) {
            return ctx.reply(`✅ *"${text}" obunasi o\'chirildi.*`, { parse_mode: 'Markdown' });
        } else {
            return ctx.reply('❌ *Bunday obuna topilmadi.*', { parse_mode: 'Markdown' });
        }
    }

    // Kino kodi qabul qilish
    if (isAdmin(userId) && ctx.session.waitingForCode && ctx.session.movieData) {
        const code = text;
        
        if (!/^\d+$/.test(code)) {
            return ctx.reply('❌ *Kod faqat raqamlardan iborat bo\'lishi kerak. Qayta kiriting:*', { parse_mode: 'Markdown' });
        }

        try {
            const existing = await Movie.findOne({ code });
            if (existing) {
                return ctx.reply(`⚠️ *${code} kodi allaqachon mavjud. Boshqa kod kiriting:*`, { parse_mode: 'Markdown' });
            }

            await Movie.create({
                code,
                file_id: ctx.session.movieData.file_id,
                caption: ctx.session.movieData.caption || `Kino kodi: ${code}`
            });

            ctx.session.addingMovie = false;
            ctx.session.waitingForCode = false;
            delete ctx.session.movieData;

            return ctx.reply(`✅ *${code} kodli kino muvaffaqiyatli saqlandi!*`, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('❌ Kino saqlash xatosi:', err);
            return ctx.reply('❌ *Saqlashda xatolik yuz berdi. Qayta urinib ko\'ring.*', { parse_mode: 'Markdown' });
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
                `✅ *Broadcast yakunlandi!*\n` +
                `📤 Yuborildi: ${success} ta\n` +
                `❌ Yuborilmadi: ${failed} ta`,
                { parse_mode: 'Markdown' }
            );
        } catch (err) {
            ctx.session.broadcasting = false;
            return ctx.reply('❌ *Broadcastda xatolik yuz berdi.*', { parse_mode: 'Markdown' });
        }
    }

    // Foydalanuvchi uchun kino qidirish
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('❌ *Avval barcha kanal va guruhlarga obuna boʻling:*', { 
            parse_mode: 'Markdown',
            ...keyboard 
        });
    }

    // Kino kodini qidirish
    if (/^\d+$/.test(text)) {
        await addUser(ctx);
        const movie = await Movie.findOne({ code: text });
        
        if (!movie) {
            return ctx.reply('❌ *Bunday kodda kino topilmadi.*', { parse_mode: 'Markdown' });
        }

        try {
            await ctx.replyWithVideo(movie.file_id, {
                caption: movie.caption || `🎬 Kino kodi: ${movie.code}\n\n@Kino17Bot`,
                parse_mode: 'HTML'
            });
        } catch (err) {
            console.error('❌ Video yuborish xatosi:', err);
            ctx.reply('❌ *Video yuborishda xatolik yuz berdi. Adminlarga murojaat qiling.*', { parse_mode: 'Markdown' });
        }
    } else {
        ctx.reply('⚠️ *Iltimos, faqat raqamlardan iborat kino kodini yuboring.*', { parse_mode: 'Markdown' });
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
        ctx.reply(`✅ *Broadcast ${success} ta foydalanuvchiga yuborildi.*`, { parse_mode: 'Markdown' });
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('❌ *Broadcastda xatolik yuz berdi.*', { parse_mode: 'Markdown' });
    }
});

// ====================== WEBHOOK SOZLASH ======================

if (URL) {
    console.log('🚀 Webhook rejimida ishga tushyapman...');
    
    // Render.com uchun webhook
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    const fullUrl = `${URL}${webhookPath}`;
    
    console.log(`📡 Webhook manzili: ${fullUrl}`);

    // Express server yaratish
    const app = express();
    app.use(express.json());

    // Asosiy sahifa
    app.get('/', (req, res) => {
        res.send('🎬 Kino17Bot ishlamoqda! 🚀');
    });

    // Webhook endpoint
    app.post(webhookPath, (req, res) => {
        // Secret token tekshirish
        const token = req.headers['x-telegram-bot-api-secret-token'];
        if (token !== WEBHOOK_SECRET) {
            console.warn('⚠️ Noto\'g\'ri secret token');
            return res.status(403).send('Forbidden');
        }
        
        // Telegraf webhook middleware ni ishlatish
        return bot.handleUpdate(req.body, res).then(() => {
            res.status(200).end();
        }).catch(err => {
            console.error('❌ Webhook xatosi:', err);
            res.status(500).end();
        });
    });

    // Serverni ishga tushirish
    const server = app.listen(PORT, async () => {
        console.log(`✅ Server ${PORT} portda ishga tushdi`);
        
        // Webhook o'rnatish
        try {
            await bot.telegram.setWebhook(fullUrl, {
                secret_token: WEBHOOK_SECRET,
                drop_pending_updates: true
            });
            console.log(`✅ Webhook muvaffaqiyatli o'rnatildi: ${fullUrl}`);
            console.log('🤖 Bot to\'liq ishga tushdi va webhook rejimida ishlamoqda!');
        } catch (err) {
            console.error('❌ Webhook o\'rnatishda xato:', err.message);
        }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 SIGTERM signal qabul qilindi, server yopilmoqda...');
        server.close(() => {
            console.log('✅ Server yopildi');
            process.exit(0);
        });
    });

} else {
    console.log('🚀 Local polling rejimida ishga tushyapman...');
    
    // Local test uchun polling
    bot.launch()
        .then(() => console.log('✅ Bot polling rejimida ishga tushdi'))
        .catch(err => console.error('❌ Xatolik:', err));

    // Faqat polling rejimida graceful stop ni o'rnatamiz
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

console.log('🚀 Bot mukammal ishlashga tayyor!');
