import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

// Constants
const CHAT_PAGE_SIZE = 20;
const FORUM_PAGE_SIZE = 10;

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly apiUrl: string;
  // Track user states for multi-step interactions
  private userStates = new Map<number, { action: string; data?: any }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async handleUpdate(update: any): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  // ===================== MESSAGE HANDLING =====================

  private async handleMessage(message: any): Promise<void> {
    const chatId = message.chat.id;
    const text = message.text || '';
    const from: TelegramUser = message.from;

    // Ensure user exists
    await this.ensureUser(from);

    // Check user state for multi-step flows
    const state = this.userStates.get(from.id);
    if (state) {
      await this.handleUserState(chatId, from, text, state);
      return;
    }

    // Command handling
    if (text.startsWith('/start')) {
      await this.handleStart(chatId, from);
    } else if (text.startsWith('/menu')) {
      await this.sendMainMenu(chatId, from.id);
    } else if (text.startsWith('/admin')) {
      await this.handleAdminCommand(chatId, from);
    } else {
      await this.sendMessage(chatId, 'Используйте /menu для открытия главного меню.');
    }
  }

  private async handleUserState(
    chatId: number,
    from: TelegramUser,
    text: string,
    state: { action: string; data?: any },
  ): Promise<void> {
    if (state.action === 'awaiting_product_name') {
      this.userStates.set(from.id, { action: 'awaiting_product_desc', data: { productName: text } });
      await this.sendMessage(chatId, 'Опишите продукт (где купили, почему считаете безопасным):');
    } else if (state.action === 'awaiting_product_desc') {
      this.userStates.delete(from.id);
      await this.submitForumPost(chatId, from, state.data.productName, text);
    } else if (state.action === 'awaiting_chat_message') {
      this.userStates.delete(from.id);
      await this.saveChatMessage(chatId, from, text);
    } else {
      this.userStates.delete(from.id);
      await this.sendMainMenu(chatId, from.id);
    }
  }

  // ===================== COMMANDS =====================

  private async handleStart(chatId: number, from: TelegramUser): Promise<void> {
    const displayName = from.first_name || from.username || 'друг';
    const welcomeText =
      `🌾 Здравствуйте, ${displayName}!\n\n` +
      `Я — бот-помощник для людей с целиакией (непереносимостью глютена).\n\n` +
      `Здесь вы найдёте:\n` +
      `📋 Общую информацию о целиакии\n` +
      `✅ Списки разрешённых продуктов\n` +
      `❌ Списки запрещённых продуктов\n` +
      `🛒 Чеклист для покупок\n` +
      `💬 Форум безопасных продуктов\n` +
      `💭 Общий чат сообщества`;

    await this.sendMainMenu(chatId, from.id, welcomeText);
  }

  private async handleAdminCommand(chatId: number, from: TelegramUser): Promise<void> {
    const isAdmin = await this.isAdmin(from.id);
    if (!isAdmin) {
      await this.sendMessage(chatId, '⛔ У вас нет прав администратора.');
      return;
    }
    await this.sendAdminPanel(chatId);
  }

  // ===================== MENU =====================

  private async sendMainMenu(chatId: number, telegramId: number, text?: string): Promise<void> {
    const isAdmin = await this.isAdmin(telegramId);
    const menuText = text || '🌾 Главное меню';

    const buttons: any[][] = [
      [{ text: '📋 Общая информация', callback_data: 'info_list' }],
      [{ text: '✅ Разрешённые продукты', callback_data: 'allowed_categories' }],
      [{ text: '❌ Запрещённые продукты', callback_data: 'forbidden_categories' }],
      [{ text: '🛒 Чеклист для покупок', callback_data: 'checklist_categories' }],
      [{ text: '💬 Форум "Безопасные продукты"', callback_data: 'forum_menu' }],
      [{ text: '💭 Общий чат', callback_data: 'chat_view:0' }],
    ];

    if (isAdmin) {
      buttons.push([{ text: '⚙️ Модерация', callback_data: 'admin_panel' }]);
    }

    await this.sendMessage(chatId, menuText, {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ===================== CALLBACK QUERY HANDLING =====================

  private async handleCallbackQuery(query: any): Promise<void> {
    const chatId = query.message.chat.id;
    const from: TelegramUser = query.from;
    const data: string = query.data;

    await this.ensureUser(from);
    await this.answerCallbackQuery(query.id);

    try {
      if (data === 'main_menu') {
        await this.sendMainMenu(chatId, from.id);
      } else if (data === 'info_list') {
        await this.showInfoList(chatId);
      } else if (data.startsWith('info_detail:')) {
        await this.showInfoDetail(chatId, parseInt(data.split(':')[1]));
      } else if (data === 'allowed_categories') {
        await this.showAllowedCategories(chatId);
      } else if (data.startsWith('allowed_cat:')) {
        await this.showAllowedByCategory(chatId, data.split(':')[1]);
      } else if (data === 'forbidden_categories') {
        await this.showForbiddenCategories(chatId);
      } else if (data.startsWith('forbidden_cat:')) {
        await this.showForbiddenByCategory(chatId, data.split(':')[1]);
      } else if (data === 'checklist_categories') {
        await this.showChecklistCategories(chatId);
      } else if (data.startsWith('checklist_cat:')) {
        await this.showChecklistByCategory(chatId, data.split(':')[1]);
      } else if (data === 'forum_menu') {
        await this.showForumMenu(chatId);
      } else if (data === 'forum_add') {
        await this.startForumSubmission(chatId, from);
      } else if (data.startsWith('forum_approved:')) {
        await this.showApprovedPosts(chatId, parseInt(data.split(':')[1]));
      } else if (data.startsWith('chat_view:')) {
        await this.showChat(chatId, parseInt(data.split(':')[1]));
      } else if (data === 'chat_write') {
        await this.startChatWrite(chatId, from);
      } else if (data === 'admin_panel') {
        await this.sendAdminPanel(chatId);
      } else if (data.startsWith('admin_pending:')) {
        await this.showPendingPosts(chatId, parseInt(data.split(':')[1]));
      } else if (data.startsWith('admin_approve:')) {
        await this.moderatePost(chatId, from, parseInt(data.split(':')[1]), 'approved');
      } else if (data.startsWith('admin_reject:')) {
        await this.moderatePost(chatId, from, parseInt(data.split(':')[1]), 'rejected');
      } else if (data === 'admin_stats') {
        await this.showAdminStats(chatId);
      }
    } catch (error) {
      this.logger.error(`Callback error: ${error.message}`, error.stack);
      await this.sendMessage(chatId, '❗ Произошла ошибка. Попробуйте ещё раз.');
    }
  }

  // ===================== INFO SECTIONS =====================

  private async showInfoList(chatId: number): Promise<void> {
    const items = await this.prisma.general_info.findMany({ orderBy: { order: 'asc' } });
    if (items.length === 0) {
      await this.sendMessage(chatId, 'Информация пока не добавлена.');
      return;
    }
    const buttons = items.map((item) => [{ text: item.title, callback_data: `info_detail:${item.id}` }]);
    buttons.push([{ text: '⬅️ Назад', callback_data: 'main_menu' }]);
    await this.sendMessage(chatId, '📋 *Общая информация и рекомендации*\n\nВыберите раздел:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async showInfoDetail(chatId: number, id: number): Promise<void> {
    const info = await this.prisma.general_info.findUnique({ where: { id } });
    if (!info) {
      await this.sendMessage(chatId, 'Раздел не найден.');
      return;
    }
    const text = `*${info.title}*\n\n${info.content}`;
    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ К списку', callback_data: 'info_list' }],
          [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  // ===================== ALLOWED PRODUCTS =====================

  private async showAllowedCategories(chatId: number): Promise<void> {
    const products = await this.prisma.allowed_product.findMany();
    const categories = [...new Set(products.map((p) => p.category))];
    const buttons = categories.map((cat) => [{ text: `✅ ${cat}`, callback_data: `allowed_cat:${cat}` }]);
    buttons.push([{ text: '⬅️ Назад', callback_data: 'main_menu' }]);
    await this.sendMessage(chatId, '✅ *Разрешённые продукты*\n\nВыберите категорию:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async showAllowedByCategory(chatId: number, category: string): Promise<void> {
    const products = await this.prisma.allowed_product.findMany({ where: { category } });
    let text = `✅ *${category}*\n\n`;
    products.forEach((p) => {
      text += `• *${p.name}* — ${p.description || ''}\n`;
    });
    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ К категориям', callback_data: 'allowed_categories' }],
          [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  // ===================== FORBIDDEN PRODUCTS =====================

  private async showForbiddenCategories(chatId: number): Promise<void> {
    const products = await this.prisma.forbidden_product.findMany();
    const categories = [...new Set(products.map((p) => p.category))];
    const buttons = categories.map((cat) => [{ text: `❌ ${cat}`, callback_data: `forbidden_cat:${cat}` }]);
    buttons.push([{ text: '⬅️ Назад', callback_data: 'main_menu' }]);
    await this.sendMessage(chatId, '❌ *Запрещённые продукты и добавки*\n\nВыберите категорию:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async showForbiddenByCategory(chatId: number, category: string): Promise<void> {
    const products = await this.prisma.forbidden_product.findMany({ where: { category } });
    let text = `❌ *${category}*\n\n`;
    products.forEach((p) => {
      text += `• *${p.name}*\n  ${p.description || ''}\n  ⚠️ _${p.reason || ''}_\n\n`;
    });
    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ К категориям', callback_data: 'forbidden_categories' }],
          [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  // ===================== SHOPPING CHECKLIST =====================

  private async showChecklistCategories(chatId: number): Promise<void> {
    const items = await this.prisma.shopping_checklist.findMany();
    const categories = [...new Set(items.map((i) => i.category))];
    const buttons = categories.map((cat) => [{ text: `🛒 ${cat}`, callback_data: `checklist_cat:${cat}` }]);
    buttons.push([{ text: '⬅️ Назад', callback_data: 'main_menu' }]);
    await this.sendMessage(chatId, '🛒 *Чеклист для покупок*\n\nВыберите категорию:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async showChecklistByCategory(chatId: number, category: string): Promise<void> {
    const items = await this.prisma.shopping_checklist.findMany({
      where: { category },
      orderBy: { order: 'asc' },
    });
    let text = `🛒 *${category}*\n\n`;
    items.forEach((item) => {
      text += `☐ *${item.item}*\n`;
      if (item.tips) text += `  💡 _${item.tips}_\n`;
      text += '\n';
    });
    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬅️ К категориям', callback_data: 'checklist_categories' }],
          [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  // ===================== FORUM =====================

  private async showForumMenu(chatId: number): Promise<void> {
    await this.sendMessage(chatId, '💬 *Форум "Безопасные продукты"*\n\nЗдесь вы можете предложить безопасный продукт или посмотреть одобренные предложения:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Предложить продукт', callback_data: 'forum_add' }],
          [{ text: '📝 Одобренные продукты', callback_data: 'forum_approved:0' }],
          [{ text: '⬅️ Назад', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  private async startForumSubmission(chatId: number, from: TelegramUser): Promise<void> {
    this.userStates.set(from.id, { action: 'awaiting_product_name' });
    await this.sendMessage(chatId, 'Введите название безопасного продукта:');
  }

  private async submitForumPost(
    chatId: number,
    from: TelegramUser,
    productName: string,
    description: string,
  ): Promise<void> {
    await this.prisma.safe_product_post.create({
      data: {
        userId: BigInt(from.id),
        username: from.username || from.first_name || '',
        productName,
        description,
      },
    });
    await this.sendMessage(
      chatId,
      `✅ Ваше предложение "отправлено на модерацию!\n\n` +
        `📦 Продукт: *${productName}*\n` +
        `📝 Описание: ${description}\n\n` +
        `После проверки администратором оно появится в списке.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⬅️ К форуму', callback_data: 'forum_menu' }],
            [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
          ],
        },
      },
    );
  }

  private async showApprovedPosts(chatId: number, offset: number): Promise<void> {
    const posts = await this.prisma.safe_product_post.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: FORUM_PAGE_SIZE,
    });
    const total = await this.prisma.safe_product_post.count({ where: { status: 'approved' } });

    if (posts.length === 0) {
      await this.sendMessage(chatId, '📝 Пока нет одобренных продуктов.', {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'forum_menu' }]],
        },
      });
      return;
    }

    let text = '📝 *Одобренные безопасные продукты:*\n\n';
    posts.forEach((p, i) => {
      text += `${offset + i + 1}. *${p.productName}*\n`;
      text += `   ${p.description || ''}\n`;
      text += `   👤 @${p.username || 'аноним'}\n\n`;
    });
    text += `Страница ${Math.floor(offset / FORUM_PAGE_SIZE) + 1} из ${Math.ceil(total / FORUM_PAGE_SIZE)}`;

    const navButtons: any[] = [];
    if (offset > 0) {
      navButtons.push({ text: '⬅️ Назад', callback_data: `forum_approved:${offset - FORUM_PAGE_SIZE}` });
    }
    if (offset + FORUM_PAGE_SIZE < total) {
      navButtons.push({ text: '➡️ Далее', callback_data: `forum_approved:${offset + FORUM_PAGE_SIZE}` });
    }

    const buttons: any[][] = [];
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([{ text: '⬅️ К форуму', callback_data: 'forum_menu' }]);

    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // ===================== CHAT =====================

  private async showChat(chatId: number, offset: number): Promise<void> {
    const messages = await this.prisma.chat_message.findMany({
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: CHAT_PAGE_SIZE,
    });
    const total = await this.prisma.chat_message.count();

    let text = '💭 *Общий чат*\n\n';
    if (messages.length === 0) {
      text += 'Пока нет сообщений. Будьте первым!\n';
    } else {
      // Show newest first, reversed for reading
      const reversed = [...messages].reverse();
      reversed.forEach((m) => {
        const date = new Date(m.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        text += `👤 *@${m.username || 'аноним'}* (${date}):\n${m.message}\n\n`;
      });
    }

    if (total > 0) {
      text += `Страница ${Math.floor(offset / CHAT_PAGE_SIZE) + 1} из ${Math.ceil(total / CHAT_PAGE_SIZE) || 1}`;
    }

    const navButtons: any[] = [];
    if (offset > 0) {
      navButtons.push({ text: '⬅️ Новее', callback_data: `chat_view:${offset - CHAT_PAGE_SIZE}` });
    }
    if (offset + CHAT_PAGE_SIZE < total) {
      navButtons.push({ text: '➡️ Старее', callback_data: `chat_view:${offset + CHAT_PAGE_SIZE}` });
    }

    const buttons: any[][] = [
      [{ text: '✍️ Написать', callback_data: 'chat_write' }],
      [{ text: '🔄 Обновить', callback_data: `chat_view:${offset}` }],
    ];
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([{ text: '🏠 Главное меню', callback_data: 'main_menu' }]);

    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async startChatWrite(chatId: number, from: TelegramUser): Promise<void> {
    this.userStates.set(from.id, { action: 'awaiting_chat_message' });
    await this.sendMessage(chatId, 'Напишите ваше сообщение для общего чата:');
  }

  private async saveChatMessage(chatId: number, from: TelegramUser, message: string): Promise<void> {
    await this.prisma.chat_message.create({
      data: {
        userId: BigInt(from.id),
        username: from.username || from.first_name || '',
        message,
      },
    });
    await this.sendMessage(chatId, '✅ Сообщение отправлено!', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💭 Открыть чат', callback_data: 'chat_view:0' }],
          [{ text: '🏠 Главное меню', callback_data: 'main_menu' }],
        ],
      },
    });
  }

  // ===================== ADMIN =====================

  private async sendAdminPanel(chatId: number): Promise<void> {
    const pendingCount = await this.prisma.safe_product_post.count({ where: { status: 'pending' } });
    await this.sendMessage(
      chatId,
      `⚙️ *Панель администратора*\n\nОжидают модерации: ${pendingCount}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `📝 Ожидающие (${pendingCount})`, callback_data: 'admin_pending:0' }],
            [{ text: '📊 Статистика', callback_data: 'admin_stats' }],
            [{ text: '⬅️ Назад', callback_data: 'main_menu' }],
          ],
        },
      },
    );
  }

  private async showPendingPosts(chatId: number, offset: number): Promise<void> {
    const posts = await this.prisma.safe_product_post.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: 1,
    });
    const total = await this.prisma.safe_product_post.count({ where: { status: 'pending' } });

    if (posts.length === 0) {
      await this.sendMessage(chatId, '✅ Нет предложений для модерации.', {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin_panel' }]],
        },
      });
      return;
    }

    const post = posts[0];
    const date = new Date(post.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const text =
      `📝 *Предложение ${offset + 1} из ${total}*\n\n` +
      `📦 Продукт: *${post.productName}*\n` +
      `📝 Описание: ${post.description || 'нет'}\n` +
      `👤 От: @${post.username || 'аноним'}\n` +
      `📅 Дата: ${date}`;

    const buttons: any[][] = [
      [
        { text: '✅ Одобрить', callback_data: `admin_approve:${post.id}` },
        { text: '❌ Отклонить', callback_data: `admin_reject:${post.id}` },
      ],
    ];
    if (offset + 1 < total) {
      buttons.push([{ text: '➡️ Следующее', callback_data: `admin_pending:${offset + 1}` }]);
    }
    buttons.push([{ text: '⬅️ Назад', callback_data: 'admin_panel' }]);

    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  private async moderatePost(
    chatId: number,
    from: TelegramUser,
    postId: number,
    status: string,
  ): Promise<void> {
    const isAdmin = await this.isAdmin(from.id);
    if (!isAdmin) {
      await this.sendMessage(chatId, '⛔ У вас нет прав.');
      return;
    }

    await this.prisma.safe_product_post.update({
      where: { id: postId },
      data: {
        status,
        moderatedAt: new Date(),
        moderatorId: BigInt(from.id),
      },
    });

    const statusText = status === 'approved' ? '✅ одобрено' : '❌ отклонено';
    await this.sendMessage(chatId, `Предложение ${statusText}.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📝 Следующее', callback_data: 'admin_pending:0' }],
          [{ text: '⬅️ Панель админа', callback_data: 'admin_panel' }],
        ],
      },
    });
  }

  private async showAdminStats(chatId: number): Promise<void> {
    const [userCount, messageCount, approvedCount, pendingCount, allowedCount, forbiddenCount] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.chat_message.count(),
        this.prisma.safe_product_post.count({ where: { status: 'approved' } }),
        this.prisma.safe_product_post.count({ where: { status: 'pending' } }),
        this.prisma.allowed_product.count(),
        this.prisma.forbidden_product.count(),
      ]);

    const text =
      `📊 *Статистика*\n\n` +
      `👥 Пользователей: ${userCount}\n` +
      `💭 Сообщений в чате: ${messageCount}\n` +
      `✅ Одобренных продуктов: ${approvedCount}\n` +
      `⏳ Ожидают модерации: ${pendingCount}\n` +
      `📝 Разрешённых продуктов в базе: ${allowedCount}\n` +
      `🚫 Запрещённых продуктов в базе: ${forbiddenCount}`;

    await this.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'admin_panel' }]],
      },
    });
  }

  // ===================== HELPERS =====================

  private async ensureUser(from: TelegramUser): Promise<void> {
    try {
      await this.prisma.user.upsert({
        where: { telegramId: BigInt(from.id) },
        update: { username: from.username || from.first_name || '' },
        create: {
          telegramId: BigInt(from.id),
          username: from.username || from.first_name || '',
        },
      });
    } catch (error) {
      this.logger.error(`Error ensuring user: ${error.message}`);
    }
  }

  private async isAdmin(telegramId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(telegramId) } });
    return user?.isAdmin === true;
  }

  private async sendMessage(chatId: number, text: string, extra?: any): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        ...extra,
      });
    } catch (error) {
      this.logger.error(`Failed to send message: ${error.message}`);
    }
  }

  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
      });
    } catch (error) {
      this.logger.error(`Failed to answer callback: ${error.message}`);
    }
  }
}
