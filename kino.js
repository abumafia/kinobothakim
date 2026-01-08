const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8595951105:AAEgCbk2ZqJRtrOJ1-gpZNTEwTphmx_wUws';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kino1bot?appName=abumafia';

// Bir nechta admin qo'llab-quvvatlash (istalganicha qo'shishingiz mumkin)
const ADMIN_IDS = [6606638731, 6355141067, 7962180552]; // Bu yerga admin ID larni qo'shing (number sifatida!)

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
    chat_username: { type: String, required: true, unique: true },
    type: { type: String, enum: ['channel', 'group'], required: true }
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

// Foydalanuvchi adminligini tekshirish
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// Barcha majburiy obunalarni tekshirish (faqat oddiy userlar uchun)
async function checkAllSubscriptions(userId) {
    if (isAdmin(userId)) return true; // Adminlar uchun obuna shart emas

    try {
        const subs = await Subscription.find({});
        if (subs.length === 0) return true;

        for (const sub of subs) {
            try {
                const member = await bot.telegram.getChatMember(sub.chat_username, userId);
                const status = member.status;
                if (status === 'left' || status === 'kicked' || status === 'banned') {
                    return false;
                }
            } catch (error) {
                console.error(`Obuna tekshirish xatosi (${sub.chat_username}):`, error.message);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Obunalar tekshirish xatosi:', error);
        return false;
    }
}

// Obuna tugmalari
async function getSubscriptionKeyboard() {
    const subs = await Subscription.find({});
    const rows = subs.map(sub =>
        [Markup.button.url(
            sub.type === 'channel' ? '📢 Kanal' : '👥 Guruh',
            `https://t.me/${sub.chat_username.replace('@', '')}`
        )]
    );
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

// START
bot.start(async (ctx) => {
    await addUser(ctx);

    const userId = ctx.from.id;
    const isSubscribed = await checkAllSubscriptions(userId);

    // Agar admin bo'lmasa va obuna bo'lmagan bo'lsa
    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getSubscriptionKeyboard();
        return ctx.reply('Botdan foydalanish uchun quyidagi kanal va guruhlarga obuna boʻling:', keyboard);
    }

    // Admin bo'lsa — panel
    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast'],
            ['➕ Kanal qoʻshish', '➕ Guruh qoʻshish'],
            ['📋 Roʻyxatni koʻrish', '➖ Oʻchirish']
        ]).resize();
        return ctx.reply('👨‍💻 Admin panelga xush kelibsiz!', adminKeyboard);
    }

    // Oddiy user — obuna bo'lgan
    ctx.reply('🎥 Botga xush kelibsiz!\nKino olish uchun kod yuboring (masalan: 7)');
});

// Obuna tekshirish tugmasi
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

// ADMIN TUGMALARI (faqat adminlar uchun)
bot.hears('🎬 Kino qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.addingMovie = true;
    ctx.reply('🎬 Kino qoʻshish rejimi yoqildi!\nBoshqa chatdan video + izoh bilan postni forward qiling.');
});

bot.hears('📊 Statistika', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const users = await User.countDocuments();
        const movies = await Movie.countDocuments();
        const subs = await Subscription.countDocuments();
        ctx.reply(`📊 Statistika:\n\n👥 Foydalanuvchilar: ${users}\n🎬 Kinolar: ${movies}\n📢 Majburiy obunalar: ${subs}`);
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
    ctx.reply('Yangi kanal username ni yuboring (masalan: @hallaym):');
});

bot.hears('➕ Guruh qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.awaitingGroup = true;
    ctx.reply('Yangi guruh username ni yuboring (masalan: @talabagacha):');
});

bot.hears('📋 Roʻyxatni koʻrish', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const subs = await Subscription.find({});
    if (subs.length === 0) return ctx.reply('Hozircha majburiy obuna yoʻq.');
    const list = subs.map((s, i) => `${i+1}. ${s.type === 'channel' ? '📢' : '👥'} ${s.chat_username}`).join('\n');
    ctx.reply(`📋 Majburiy obunalar:\n\n${list}`);
});

bot.hears('➖ Oʻchirish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    ctx.session.deletingSub = true;
    ctx.reply('Oʻchirish uchun kanal yoki guruh username ni yuboring (masalan: @hallaym):');
});

// VIDEO forward qabul qilish
bot.on('video', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    if (!ctx.session.addingMovie) return;

    if (!ctx.message.forward_from_message_id) {
        return ctx.reply('❌ Faqat forward qilingan video qabul qilinadi!');
    }

    ctx.session.movieData = {
        file_id: ctx.message.video.file_id,
        caption: ctx.message.caption || ''
    };
    ctx.session.waitingForCode = true;
    ctx.reply('✅ Video qabul qilindi!\nEndi kino kodi yuboring (masalan: 7):');
});

// TEXT xabarlar
bot.on('text', async (ctx) => {
    ensureSession(ctx);
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // ADMIN: Kanal qo'shish
    if (isAdmin(userId) && ctx.session.awaitingChannel) {
        if (!text.startsWith('@')) return ctx.reply('Username @ bilan boshlanishi kerak.');
        try {
            await Subscription.create({ chat_username: text, type: 'channel' });
            delete ctx.session.awaitingChannel;
            return ctx.reply(`✅ ${text} kanali qoʻshildi.`);
        } catch (err) {
            if (err.code === 11000) return ctx.reply('Bu kanal allaqachon mavjud.');
            return ctx.reply('Xatolik yuz berdi.');
        }
    }

    // ADMIN: Guruh qo'shish
    if (isAdmin(userId) && ctx.session.awaitingGroup) {
        if (!text.startsWith('@')) return ctx.reply('Username @ bilan boshlanishi kerak.');
        try {
            await Subscription.create({ chat_username: text, type: 'group' });
            delete ctx.session.awaitingGroup;
            return ctx.reply(`✅ ${text} guruhi qoʻshildi.`);
        } catch (err) {
            if (err.code === 11000) return ctx.reply('Bu guruh allaqachon mavjud.');
            return ctx.reply('Xatolik yuz berdi.');
        }
    }

    // ADMIN: O'chirish
    if (isAdmin(userId) && ctx.session.deletingSub) {
        const result = await Subscription.deleteOne({ chat_username: text });
        delete ctx.session.deletingSub;
        if (result.deletedCount > 0) {
            return ctx.reply(`✅ ${text} oʻchirildi.`);
        } else {
            return ctx.reply('Bunday obuna topilmadi.');
        }
    }

    // ADMIN: Kino kodini kiritish
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

    // ADMIN: Broadcast
    if (isAdmin(userId) && ctx.session.broadcasting) {
        try {
            const users = await User.find({});
            let success = 0;
            for (const user of users) {
                try {
                    await ctx.telegram.copyMessage(user.user_id, ctx.chat.id, ctx.message.message_id);
                    success++;
                } catch (e) { /* blocked */ }
            }
            ctx.session.broadcasting = false;
            return ctx.reply(`✅ Broadcast ${success} ta foydalanuvchiga yuborildi.`);
        } catch (err) {
            ctx.session.broadcasting = false;
            return ctx.reply('Broadcastda xatolik.');
        }
    }

    // ODDIY USER: Kino kodini kiritishi
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

// Broadcast uchun boshqa kontentlar
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
            } catch (e) { /* blocked */ }
        }
        ctx.session.broadcasting = false;
        ctx.reply(`✅ Broadcast ${success} ta foydalanuvchiga yuborildi.`);
    } catch (err) {
        ctx.session.broadcasting = false;
        ctx.reply('Broadcastda xatolik.');
    }
});

// Botni ishga tushirish
bot.launch()
    .then(() => console.log('Bot muvaffaqiyatli ishga tushdi 🚀'))
    .catch(err => console.error('Ishga tushirishda xatolik:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
