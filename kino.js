const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// SOZLAMALAR
const BOT_TOKEN = '8595951105:AAEgCbk2ZqJRtrOJ1-gpZNTEwTphmx_wUws';
const MONGODB_URL = 'mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/kinojanbot?appName=abumafia';

// Bir nechta admin
const ADMIN_IDS = [6606638731, 901126203]; // Raqamlar bilan!

// Render.com muhit o'zgaruvchilari
const PORT = process.env.PORT || 3000;
const URL = process.env.RENDER_EXTERNAL_URL || process.env.URL; // Render avto berada
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

// Kengaytirilgan subscription schema
const subscriptionSchema = new mongoose.Schema({
    title: { type: String, required: true }, // Ko'rinadigan nom
    url: { type: String, required: true, unique: true }, // Havola
    type: { 
        type: String, 
        enum: ['channel', 'group', 'private_channel', 'social', 'website'], 
        required: true 
    },
    icon: { type: String, default: '🔗' }, // Ikonka
    order: { type: Number, default: 0 } // Tartib raqami
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

// Iconlar ro'yxati
const TYPE_ICONS = {
    channel: '📢',
    group: '👥',
    private_channel: '🔒',
    social: '🌐',
    website: '🌍'
};

// Obuna tekshirish (faqat kanallar va guruhlar uchun)
async function checkRequiredSubscriptions(userId) {
    if (isAdmin(userId)) return true;

    try {
        const requiredSubs = await Subscription.find({
            type: { $in: ['channel', 'group'] }
        });
        
        if (requiredSubs.length === 0) return true;

        for (const sub of requiredSubs) {
            try {
                // URL dan username ajratish
                const usernameMatch = sub.url.match(/t\.me\/([^/?]+)/);
                if (!usernameMatch) continue;
                
                const username = usernameMatch[1];
                const member = await bot.telegram.getChatMember(`@${username}`, userId);
                const status = member.status;
                if (status === 'left' || status === 'kicked' || status === 'banned') {
                    return false;
                }
            } catch (error) {
                console.error(`Obuna xatosi (${sub.url}):`, error.message);
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Obunalar xatosi:', error);
        return false;
    }
}

// Barcha havolalar uchun klaviatura
async function getLinksKeyboard() {
    const subs = await Subscription.find().sort('order');
    
    const rows = subs.map(sub => {
        const icon = TYPE_ICONS[sub.type] || sub.icon;
        return [Markup.button.url(`${icon} ${sub.title}`, sub.url)];
    });
    
    rows.push([Markup.button.callback('✅ Obunalarni tekshirish', 'check_subscription')]);
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

// START HANDLER
bot.start(async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    const isSubscribed = await checkRequiredSubscriptions(userId);

    if (!isSubscribed && !isAdmin(userId)) {
        const keyboard = await getLinksKeyboard();
        return ctx.reply(
            '🎬 *Kino Botiga xush kelibsiz!*\n\n' +
            'Botdan to\'liq foydalanish uchun quyidagi kanal va guruhlarga obuna bo\'ling, ' +
            'boshqa havolalar ham sizga foydali bo\'ladi:',
            { 
                parse_mode: 'Markdown',
                ...keyboard 
            }
        );
    }

    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔗 Havola qoʻshish'],
            ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize();
        return ctx.reply('👨‍💻 *Admin panelga xush kelibsiz!*', { 
            parse_mode: 'Markdown',
            ...adminKeyboard 
        });
    }

    ctx.reply('🎥 *Botga xush kelibsiz!*\n\nKino olish uchun kod yuboring (masalan: 7)\n\n📌 *Boshqa foydali havolalar:*', {
        parse_mode: 'Markdown',
        ...(await getLinksKeyboard())
    });
});

// Obuna tekshirish
bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const isSubscribed = await checkRequiredSubscriptions(userId);

    if (isSubscribed || isAdmin(userId)) {
        await addUser(ctx);
        if (isAdmin(userId)) {
            const adminKeyboard = Markup.keyboard([
                ['🎬 Kino qoʻshish', '📊 Statistika'],
                ['📢 Broadcast', '🔗 Havola qoʻshish'],
                ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
                ['🏠 Bosh menyu']
            ]).resize();
            return ctx.reply('✅ *Obuna tasdiqlandi!*\nAdmin panelga xush kelibsiz!', { 
                parse_mode: 'Markdown',
                ...adminKeyboard 
            });
        }
        return ctx.reply('✅ *Obuna tasdiqlandi!*\n\nKino olish uchun kod yuboring.', {
            parse_mode: 'Markdown'
        });
    }

    const keyboard = await getLinksKeyboard();
    ctx.reply('❌ *Hali barcha majburiy kanal va guruhlarga obuna bo\'lmagansiz:*', {
        parse_mode: 'Markdown',
        ...keyboard
    });
});

// ================== ADMIN FUNKSIYALARI ==================

bot.hears('🔗 Havola qoʻshish', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    
    const typeKeyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📢 Oddiy kanal', 'add_link_channel'),
            Markup.button.callback('🔒 Maxfiy kanal', 'add_link_private_channel')
        ],
        [
            Markup.button.callback('👥 Guruh', 'add_link_group'),
            Markup.button.callback('🌐 Ijtimoiy tarmoq', 'add_link_social')
        ],
        [
            Markup.button.callback('🌍 Website', 'add_link_website')
        ]
    ]);
    
    ctx.reply('Qanday turdagi havola qo\'shmoqchisiz?', typeKeyboard);
});

// Havola turini tanlash
bot.action(/add_link_(.+)/, (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ensureSession(ctx);
    
    const type = ctx.match[1];
    const typeNames = {
        'channel': '📢 Oddiy kanal',
        'private_channel': '🔒 Maxfiy kanal',
        'group': '👥 Guruh',
        'social': '🌐 Ijtimoiy tarmoq',
        'website': '🌍 Website'
    };
    
    ctx.session.addingLink = {
        type: type,
        step: 'title'
    };
    
    ctx.reply(`*${typeNames[type]} qo'shish*\n\nHavola uchun nom yozing (masalan: "Kino Janri"):`, {
        parse_mode: 'Markdown'
    });
});

// Havola ma'lumotlarini qabul qilish
bot.on('text', async (ctx) => {
    ensureSession(ctx);
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Havola qo'shish jarayoni
    if (isAdmin(userId) && ctx.session.addingLink) {
        const step = ctx.session.addingLink.step;
        
        if (step === 'title') {
            ctx.session.addingLink.title = text;
            ctx.session.addingLink.step = 'url';
            
            return ctx.reply('Endi havola linkini yuboring:');
        }
        
        if (step === 'url') {
            const { title, type } = ctx.session.addingLink;
            
            // URL tekshirish
            if (!text.startsWith('http://') && !text.startsWith('https://') && !text.startsWith('t.me/')) {
                return ctx.reply('❌ Noto\'g\'ri havola formati. http://, https:// yoki t.me/ bilan boshlansin.');
            }
            
            // To'liq URL yaratish
            let url = text;
            if (text.startsWith('t.me/')) {
                url = `https://${text}`;
            }
            
            try {
                // Order ni aniqlash
                const count = await Subscription.countDocuments({ type });
                const order = count + 1;
                
                await Subscription.create({
                    title: title,
                    url: url,
                    type: type,
                    icon: TYPE_ICONS[type],
                    order: order
                });
                
                delete ctx.session.addingLink;
                
                return ctx.reply(`✅ *${title}* havolasi muvaffaqiyatli qo'shildi!`, {
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                if (err.code === 11000) {
                    return ctx.reply('❌ Bu havola allaqachon mavjud.');
                }
                return ctx.reply('❌ Xatolik yuz berdi: ' + err.message);
            }
        }
    }

    // Havola o'chirish
    if (isAdmin(userId) && ctx.session.deletingLink) {
        const result = await Subscription.deleteOne({ _id: ctx.session.deletingLink.id });
        delete ctx.session.deletingLink;
        
        if (result.deletedCount > 0) {
            return ctx.reply('✅ Havola muvaffaqiyatli o\'chirildi.');
        } else {
            return ctx.reply('❌ Havola topilmadi.');
        }
    }

    // Bosh admin funksiyalar (oldingi kod)
    if (isAdmin(userId) && ctx.session.awaitingChannel) {
        // ... oldingi kod
    }
    
    // ... boshqa admin handlerlar

    // Foydalanuvchilarga kinolarni yuborish
    const isSubscribed = await checkRequiredSubscriptions(userId);
    if (!isSubscribed) {
        const keyboard = await getLinksKeyboard();
        return ctx.reply('Avval barcha majburiy kanal va guruhlarga obuna bo\'ling:', keyboard);
    }

    const code = text;
    const movie = await Movie.findOne({ code });
    if (!movie) {
        return ctx.reply('❌ Bunday kodda kino topilmadi.\n\n📌 *Foydali havolalar:*', {
            parse_mode: 'Markdown',
            ...(await getLinksKeyboard())
        });
    }

    await ctx.replyWithVideo(movie.file_id, {
        caption: movie.caption || `🎬 *Kino kodi:* ${movie.code}\n\n👉 Boshqa kodlar bilan kinolar toping!`,
        parse_mode: 'Markdown'
    });
});

// Havolalar ro'yxatini ko'rish
bot.hears('📋 Havolalar roʻyxati', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    try {
        const subs = await Subscription.find().sort('order');
        
        if (subs.length === 0) {
            return ctx.reply('❌ Hozircha hech qanday havola mavjud emas.');
        }
        
        let message = '📋 *Barcha havolalar:*\n\n';
        
        subs.forEach((sub, index) => {
            const typeNames = {
                'channel': 'Kanal',
                'private_channel': 'Maxfiy kanal',
                'group': 'Guruh',
                'social': 'Ijtimoiy tarmoq',
                'website': 'Website'
            };
            
            message += `${index + 1}. *${sub.title}*\n`;
            message += `   🔗 ${sub.url}\n`;
            message += `   📝 Turi: ${typeNames[sub.type]}\n`;
            message += `   ⚙️ ID: \`${sub._id}\`\n\n`;
        });
        
        ctx.reply(message, { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🗑️ Havola o\'chirish', 'delete_link_prompt')]
            ])
        });
    } catch (error) {
        ctx.reply('❌ Xatolik yuz berdi: ' + error.message);
    }
});

// Havola o'chirish prompt
bot.action('delete_link_prompt', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    
    ctx.reply('O\'chirish uchun havola ID sini yuboring (yuqoridagi ro\'yxatdan):');
});

// Bosh menyu
bot.hears('🏠 Bosh menyu', async (ctx) => {
    await addUser(ctx);
    const userId = ctx.from.id;
    
    if (isAdmin(userId)) {
        const adminKeyboard = Markup.keyboard([
            ['🎬 Kino qoʻshish', '📊 Statistika'],
            ['📢 Broadcast', '🔗 Havola qoʻshish'],
            ['📋 Havolalar roʻyxati', '➖ Havola oʻchirish'],
            ['🏠 Bosh menyu']
        ]).resize();
        return ctx.reply('🏠 *Bosh menyuga xush kelibsiz!*', { 
            parse_mode: 'Markdown',
            ...adminKeyboard 
        });
    }
    
    ctx.reply('🎥 *Bosh menyu*\n\nKino olish uchun kod yuboring (masalan: 7)\n\n📌 *Foydali havolalar:*', {
        parse_mode: 'Markdown',
        ...(await getLinksKeyboard())
    });
});

// Havola o'chirish uchun ID qabul qilish
bot.on('text', async (ctx) => {
    ensureSession(ctx);
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Havola o'chirish (ID orqali)
    if (isAdmin(userId) && text.length === 24) { // MongoDB ObjectId uzunligi
        try {
            const sub = await Subscription.findById(text);
            if (!sub) {
                return ctx.reply('❌ Bunday ID bilan havola topilmadi.');
            }
            
            ctx.session.deletingLink = {
                id: text,
                title: sub.title
            };
            
            return ctx.reply(`🗑️ *${sub.title}* havolasini o'chirishni tasdiqlaysizmi?`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Ha', 'confirm_delete_link'),
                        Markup.button.callback('❌ Yo\'q', 'cancel_delete_link')
                    ]
                ])
            });
        } catch (error) {
            return ctx.reply('❌ Noto\'g\'ri ID formati.');
        }
    }
    
    // ... qolgan handlerlar
});

// Havola o'chirishni tasdiqlash
bot.action('confirm_delete_link', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    
    if (!ctx.session.deletingLink) {
        return ctx.reply('❌ Sessiya muddati tugagan.');
    }
    
    const result = await Subscription.deleteOne({ _id: ctx.session.deletingLink.id });
    
    if (result.deletedCount > 0) {
        ctx.reply(`✅ *${ctx.session.deletingLink.title}* havolasi muvaffaqiyatli o'chirildi.`, {
            parse_mode: 'Markdown'
        });
    } else {
        ctx.reply('❌ Havola o\'chirilmadi.');
    }
    
    delete ctx.session.deletingLink;
});

bot.action('cancel_delete_link', (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    ctx.answerCbQuery();
    delete ctx.session.deletingLink;
    ctx.reply('❌ Havola o\'chirish bekor qilindi.');
});

// ... qolgan handlerlar (oldingi kodi qo'shing)

// ================== WEBHOOK SOZLASH ==================
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

    // Express server
    const express = require('express');
    const app = express();
    app.use(express.json());

    app.use(bot.webhookCallback(webhookPath));

    app.get('/', (req, res) => {
        res.send('🎬 Kino Bot ishlamoqda! 🚀');
    });

    app.listen(PORT, () => {
        console.log(`Server ${PORT} portda ishga tushdi`);
        console.log(`Webhook URL: ${fullUrl}`);
    });
} else {
    // Local test
    bot.launch()
        .then(() => console.log('Bot polling rejimida ishga tushdi (local)'))
        .catch(err => console.error('Xatolik:', err));
}

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
