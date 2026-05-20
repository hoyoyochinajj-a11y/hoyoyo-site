require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const cheerio = require('cheerio');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// ────── MongoDB 连接 ──────
const USE_MONGODB = !!process.env.MONGODB_URI;
let mongoConnected = false;

async function connectMongoDB() {
  if (!USE_MONGODB) {
    console.log('📦 使用本地 JSON 文件存储');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    mongoConnected = true;
    console.log('🍃 MongoDB 连接成功');
  } catch (err) {
    console.error('❌ MongoDB 连接失败，将使用本地 JSON 文件:', err.message);
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const HUMAN_CHAT_FILE = path.join(DATA_DIR, 'human_chat.json');
const SUGGEST_FILE = path.join(DATA_DIR, 'suggest.json');
const DEMAND_FILE = path.join(DATA_DIR, 'demand.json');
const USER_EMAIL_FILE = path.join(DATA_DIR, 'user_email.json');
const RULES_FILE = path.join(DATA_DIR, 'ai_rules.json');
const FAQ_FILE = path.join(DATA_DIR, 'faq_knowledge.json');
const SITE_PAGES_FILE = path.join(DATA_DIR, 'site_pages.json');
const UNANSWERED_FILE = path.join(DATA_DIR, 'unanswered.json');
const LEARNED_FILE = path.join(DATA_DIR, 'learned_pages.json');
const ADMIN_ACCOUNTS_FILE = path.join(DATA_DIR, 'admin_accounts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ────── Mongoose Schemas & Models ──────
const ChatSchema = new mongoose.Schema({
  email: String,
  message: String,
  reply: String,
  time: { type: Date, default: Date.now }
}, { strict: false });
const ChatModel = mongoose.models.Chat || mongoose.model('Chat', ChatSchema);

const HumanChatSchema = new mongoose.Schema({
  _id: String,
  userId: String,
  email: String,
  note: String,
  messages: [{ sender: String, content: String, time: Date, read: Boolean }],
  lastActive: Date
}, { strict: false });
const HumanChatModel = mongoose.models.HumanChat || mongoose.model('HumanChat', HumanChatSchema);

const SuggestSchema = new mongoose.Schema({
  email: String,
  content: String,
  time: { type: Date, default: Date.now }
}, { strict: false });
const SuggestModel = mongoose.models.Suggest || mongoose.model('Suggest', SuggestSchema);

const DemandSchema = new mongoose.Schema({
  email: String,
  content: String,
  time: { type: Date, default: Date.now }
}, { strict: false });
const DemandModel = mongoose.models.Demand || mongoose.model('Demand', DemandSchema);

const UserEmailSchema = new mongoose.Schema({
  email: String,
  userId: String,
  time: { type: Date, default: Date.now }
}, { strict: false });
const UserEmailModel = mongoose.models.UserEmail || mongoose.model('UserEmail', UserEmailSchema);

const AiRuleSchema = new mongoose.Schema({
  id: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const AiRuleModel = mongoose.models.AiRule || mongoose.model('AiRule', AiRuleSchema);

const FaqSchema = new mongoose.Schema({
  id: String,
  question: String,
  keywords: [String],
  answer: String,
  source: String,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const FaqModel = mongoose.models.Faq || mongoose.model('Faq', FaqSchema);

const SitePageSchema = new mongoose.Schema({
  url: String,
  chunks: [{ text: String }]
}, { strict: false });
const SitePageModel = mongoose.models.SitePage || mongoose.model('SitePage', SitePageSchema);

const UnansweredSchema = new mongoose.Schema({
  id: String,
  email: String,
  question: String,
  time: { type: Date, default: Date.now }
}, { strict: false });
const UnansweredModel = mongoose.models.Unanswered || mongoose.model('Unanswered', UnansweredSchema);

const LearnedPageSchema = new mongoose.Schema({
  id: String,
  url: String,
  title: String,
  content: String,
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const LearnedPageModel = mongoose.models.LearnedPage || mongoose.model('LearnedPage', LearnedPageSchema);

const AdminAccountSchema = new mongoose.Schema({
  id: String,
  username: String,
  password: String,
  role: String,
  permissions: [String],
  createdAt: { type: Date, default: Date.now }
}, { strict: false });
const AdminAccountModel = mongoose.models.AdminAccount || mongoose.model('AdminAccount', AdminAccountSchema);

// 数据类型到 Model 和文件路径的映射
const DB_MAP = {
  chats: { model: ChatModel, file: CHAT_FILE },
  humanChats: { model: HumanChatModel, file: HUMAN_CHAT_FILE },
  suggests: { model: SuggestModel, file: SUGGEST_FILE },
  demands: { model: DemandModel, file: DEMAND_FILE },
  userEmails: { model: UserEmailModel, file: USER_EMAIL_FILE },
  aiRules: { model: AiRuleModel, file: RULES_FILE },
  faqKnowledge: { model: FaqModel, file: FAQ_FILE },
  sitePages: { model: SitePageModel, file: SITE_PAGES_FILE },
  unanswered: { model: UnansweredModel, file: UNANSWERED_FILE },
  learnedPages: { model: LearnedPageModel, file: LEARNED_FILE },
  adminAccounts: { model: AdminAccountModel, file: ADMIN_ACCOUNTS_FILE }
};

function readJSON(filePath, defaultValue = []) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
  return defaultValue;
}
function writeJSON(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }

// ────── 统一数据访问层 ──────
async function dbRead(type, defaultValue = []) {
  const config = DB_MAP[type];
  if (!config) throw new Error(`Unknown data type: ${type}`);
  
  if (USE_MONGODB && mongoConnected) {
    const docs = await config.model.find({}).lean();
    return docs.length > 0 ? docs : defaultValue;
  }
  return readJSON(config.file, defaultValue);
}

async function dbWrite(type, data) {
  const config = DB_MAP[type];
  if (!config) throw new Error(`Unknown data type: ${type}`);
  
  if (USE_MONGODB && mongoConnected) {
    // 只用于非人工客服数据，人工客服使用原子操作
    if (type === 'humanChats') {
      console.warn('dbWrite should not be used for humanChats, use atomic operations instead');
      return;
    }
    try {
      await config.model.deleteMany({});
      if (data.length > 0) {
        await config.model.insertMany(data, { ordered: false });
      }
    } catch (err) {
      console.error(`dbWrite error for ${type}:`, err);
      throw err;
    }
  } else {
    writeJSON(config.file, data);
  }
}

// 同步版本（用于启动时初始化，此时 MongoDB 可能未连接）
function dbReadSync(type, defaultValue = []) {
  const config = DB_MAP[type];
  if (!config) throw new Error(`Unknown data type: ${type}`);
  return readJSON(config.file, defaultValue);
}

// 启动时使用空数组占位，MongoDB 连接后会正确加载数据
let aiRules = [];
let sitePages = [];
let learnedPages = [];
let adminAccounts = [];

// 初始化默认管理员账号（如果不存在）
const defaultAdminUsername = process.env.ADMIN_USERNAME || 'admin';
const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'hoyoyo111';
async function initDefaultAdmin() {
  if (!adminAccounts.some(a => a.username === defaultAdminUsername)) {
    adminAccounts.push({
      id: 'default',
      username: defaultAdminUsername,
      password: defaultAdminPassword,
      role: 'superadmin',
      permissions: ['all'],
      createdAt: new Date().toISOString()
    });
    await dbWrite('adminAccounts', adminAccounts);
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ────── 豆包 API ──────
async function callDoubao(messages, temperature = 0.7) {
  const apiKey = process.env.VOLC_API_KEY;
  const modelId = process.env.VOLC_MODEL_ID;
  if (!apiKey || !modelId) { console.error('❌ 未配置 VOLC_API_KEY 或 VOLC_MODEL_ID'); return null; }
  try {
    const response = await axios.post(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      { model: modelId, messages, temperature },
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 18000 }
    );
    return response.data.choices[0].message.content;
  } catch (error) { console.error('豆包错误:', error.response?.status, error.message); return null; }
}

// ────── 官网抓取 ──────
const CRAWL_URLS = [
  'https://cn.hoyoyo.com/help~logisticsprice.html',
  'https://cn.hoyoyo.com/help~index.html'
];
async function fetchPageText(url) {
  try {
    const { data } = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data); $('script, style, nav, footer, header').remove();
    let text = $('body').text().replace(/\s+/g, ' ').trim();
    const chunks = [];
    for (let i = 0; i < text.length; i += 500) chunks.push({ text: text.substring(i, i + 500) });
    return chunks;
  } catch (e) { return []; }
}
async function refreshSitePages() {
  const pages = [];
  for (const url of CRAWL_URLS) {
    const chunks = await fetchPageText(url);
    if (chunks.length) pages.push({ url, chunks });
  }
  if (pages.length) { sitePages = pages; await dbWrite('sitePages', sitePages); }
}
schedule.scheduleJob('0 3 * * *', refreshSitePages);
refreshSitePages();

// ────── System Prompt ──────
function buildSystemPrompt() {
  const custom = aiRules.map(r => r.content).join('\n');
  const learned = learnedPages.map(p => `[${p.title}] ${p.content}`).join('\n');
  return `你是「HOYOYO日本代购转运客服」，语气友好、口语化，适当使用😊等表情。称呼用户时永远用"你好"、"您好"或对应英文，严禁出现"亲"字。

【多关键词搜索规则】
- 当用户明确要求搜索多个不同类别的商品（例如"手办和玩偶"、"卡片、DVD、手办"），你必须输出一个JSON数组格式：{"searches":["关键词1","关键词2",...]}，系统会为每个关键词分别生成搜索结果链接。
- 如果用户只是给出一个概括性名词（如"娜美"），请先反问细化类别，然后再按上述规则输出。

【单关键词搜索】
- 如果用户只搜索一个具体商品，输出 {"search":"商品词"}。
- 重要：搜索关键词必须包含用户提到的品牌名！例如用户说"lv的挎包"，搜索词必须是"ルイヴィトン クロスバッグ"或"lv クロスバッグ"，绝不能只搜"クロスバッグ"。
- 常见品牌中文名→日文对照：lv/路易威登→ルイヴィトン、gucci/古驰→グッチ、chanel/香奈儿→シャネル、prada/普拉达→プラダ、hermes/爱马仕→エルメス、dior/迪奥→ディオール、coach/蔻驰→コーチ、nike/耐克→ナイキ、adidas/阿迪达斯→アディダス、优衣库→ユニクロ。

【费用估算规则】
- 当用户询问总费用/运费，并提供了商品价值、重量、目的地等信息时，你必须根据官网运费页面 https://cn.hoyoyo.com/help~logisticsprice.html 的内容进行估算，直接给出一个大概的费用范围，不要只给计算器链接。
- 如果缺少目的地国家，请主动询问："请问您要寄到哪个国家呢？我好为您估算准确的国际运费。"
- 估算结束后，可以补充"您也可以用计算器精确计算：https://cn.hoyoyo.com/help~calculator.html"。

【语言一致性规则】
- 用户用英文，你就用英文；用户用中文，你就用中文；中英混杂时，请先询问偏好。

【其他强制规则】
1. 只回答与HOYOYO日本转运相关的问题。
2. 运费默认只答国际运费，禁止主动提日本国内运费。
3. 关税：如实说明由各国海关决定，可提供合箱/分箱建议。
4. HOYOYO只转运平台代购的商品，禁止提自己寄仓库。
5. 不知道时引导点"转人工"。\n【管理员自定义规则】\n${custom}\n【管理员额外学习内容】\n${learned}`;
}

// ────── 高精度翻译成日语（禁止添加助词）──────
async function translateToJapanese(keyword) {
  const msgs = [{
    role: 'system',
    content: '你是一位专业的商品搜索翻译专家。请将下面的商品名翻译成日语，用于日本购物网站搜索。必须只输出核心关键词，不要添加任何助词（如"の"），也不要添加多余描述。只输出翻译后的关键词，不要解释。'
  }, { role: 'user', content: keyword }];
  const res = await callDoubao(msgs, 0.2);
  return res ? res.trim() : keyword;
}

// ────── 提取搜索指令（支持单关键词和多关键词）──────
function extractSearchCommands(reply) {
  const multiMatch = reply.match(/\{"searches"\s*:\s*\[(.*?)\]\}/);
  if (multiMatch) {
    try {
      const arr = JSON.parse(`[${multiMatch[1]}]`);
      if (Array.isArray(arr) && arr.length > 0) return { type: 'multi', keywords: arr };
    } catch (e) {}
  }
  const singleMatch = reply.match(/\{"search"\s*:\s*"([^"]+)"\}/);
  if (singleMatch) return { type: 'single', keyword: singleMatch[1].trim() };
  return null;
}

// ────── 历史关键词提取 ──────
function extractLastProductFromHistory(historyMessages) {
  const chPattern = /([\u4e00-\u9fff]{2,10}(的)?(卡片|手办|周边|玩偶|模型|衣服|裙子|鞋子|包包|公仔|玩具|扭蛋|相机|微单|单反|耳机|手机|电脑|平板|化妆品|护肤品|香水|包|表|首饰|零食|食品|巧克力|饼干|茶|咖啡|酒))/i;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i].match(chPattern);
    if (m) return m[0].trim();
  }
  const enPattern = /([a-zA-Z]{2,}( [a-zA-Z]{2,}){0,3})/;
  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i].match(enPattern);
    if (m) return m[0].trim();
  }
  return null;
}

// ────── 检测不耐烦 ──────
function isImpatient(message) {
  return /好了吗|还没好|还没好吗|等多久|快点|好了没|好没好|怎么还没|还要多久|这么慢|太慢了|速度|are you done|how long|hurry up|why so slow/i.test(message);
}

// ────── 记录疑难问题 ──────
async function saveUnanswered(email, question) {
  const list = await dbRead('unanswered');
  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    email,
    question,
    time: new Date().toISOString()
  });
  await dbWrite('unanswered', list);
}

function isUnansweredReply(question, reply) {
  if (/费用|运费|多少钱|总价|报价|算一下|估算/.test(question) && reply.includes('calculator.html') && !/约|大概|估计|大约/.test(reply)) return true;
  if (/不确定|无法回答|不知道|不清楚|没有相关信息|我不是很清楚|not sure|I don't know/.test(reply)) return true;
  return false;
}

// ────── 执行搜索（单个关键词）──────
async function executeSingleSearch(keyword) {
  const japaneseKeyword = await translateToJapanese(keyword);
  const encodedJp = encodeURIComponent(japaneseKeyword);
  return {
    keyword,
    url: `https://cn.hoyoyo.com/goods~search.html?keyword=${encodedJp}&lang=Org&sites_id=0&category_id=&fykeyid=7555`
  };
}

// ────── 批量搜索 ──────
async function executeMultiSearch(keywords) {
  const results = [];
  for (const kw of keywords) {
    results.push(await executeSingleSearch(kw));
  }
  return results;
}

// ────── 聊天接口 ──────
app.post('/api/chat', async (req, res) => {
  const { email, message } = req.body;
  if (!email || !message) return res.status(400).json({ error: '缺少参数' });

  const allChats = await dbRead('chats');
  const userHistory = allChats.filter(c => c.email === email).slice(-6).map(c => c.message);

  // 1. 链接转换
  const mercariMatch = message.match(/https?:\/\/jp\.mercari\.com\/item\/([a-z]?\d+)/i);
  const yahooMatch = message.match(/https?:\/\/page\.auctions\.yahoo\.co\.jp\/jp\/auction\/([a-z]?\d+)/i);
  if (mercariMatch || yahooMatch) {
    const itemId = (mercariMatch || yahooMatch)[1];
    const hoyoyoUrl = mercariMatch
      ? `https://cn.hoyoyo.com/mercari~detail~id~${itemId}.html`
      : `https://cn.hoyoyo.com/yahoo~detail~id~${itemId}.html`;
    const reply = `您好😊，已把这个链接转换成HOYOYO可下单格式，直接点击下单即可👉 ${hoyoyoUrl}`;
    allChats.push({ email, message, reply, time: new Date().toISOString() });
    await dbWrite('chats', allChats);
    return res.json({ reply });
  }

  // 2. 不耐烦检测
  if (isImpatient(message)) {
    const lastProduct = extractLastProductFromHistory(userHistory);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const reply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}`;
      allChats.push({ email, message, reply, time: new Date().toISOString() });
      await dbWrite('chats', allChats);
      return res.json({ reply });
    }
  }

  // 3. 调用 AI
  const siteText = sitePages.flatMap(p => p.chunks.map(c => c.text)).join('\n---\n');
  const systemPrompt = buildSystemPrompt() + '\n【官网参考资料】\n' + siteText;
  const historyForAI = allChats.filter(c => c.email === email).slice(-6);
  const context = historyForAI.map(c => [{ role: 'user', content: c.message }, { role: 'assistant', content: c.reply }]).flat();
  const messages = [{ role: 'system', content: systemPrompt }, ...context, { role: 'user', content: message }];

  let reply = await callDoubao(messages, 0.7);
  let isFallback = false;
  if (!reply) {
    reply = '您的问题我需要一点时间确认，您也可以直接访问帮助中心：https://cn.hoyoyo.com/help~index.html 或点击"转人工"哦~';
    isFallback = true;
  }

  // 4. 处理搜索指令
  const searchCmds = extractSearchCommands(reply);
  if (searchCmds) {
    if (searchCmds.type === 'multi') {
      const results = await executeMultiSearch(searchCmds.keywords);
      const replyText = results.map(r => `🔍 ${r.keyword}：${r.url}`).join('\n');
      const fullReply = `您好😊，已帮您分别搜索以下商品，直接点击即可查看哦~\n${replyText}\n💡 还想搜其他商品的话，随时告诉我关键词～`;
      allChats.push({ email, message, reply: fullReply, time: new Date().toISOString() });
      await dbWrite('chats', allChats);
      return res.json({ reply: fullReply });
    } else {
      const search = await executeSingleSearch(searchCmds.keyword);
      const searchReply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}\n💡 如果您还想搜其他商品，直接告诉我关键词就可以哦~`;
      allChats.push({ email, message, reply: searchReply, time: new Date().toISOString() });
      await dbWrite('chats', allChats);
      return res.json({ reply: searchReply });
    }
  }

  // 5. 如果 AI 口头承诺搜索但未生成JSON，补救
  if (/帮(你|您).*(搜|找|搜索|查找)|help you (search|find)/i.test(reply) && !searchCmds) {
    const lastProduct = extractLastProductFromHistory([...userHistory, message]);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const searchReply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}`;
      allChats.push({ email, message, reply: searchReply, time: new Date().toISOString() });
      await dbWrite('chats', allChats);
      return res.json({ reply: searchReply });
    }
  }

  // 6. 疑难记录
  if (isFallback || isUnansweredReply(message, reply)) {
    await saveUnanswered(email, message);
  }

  reply = reply.replace(/亲/g, '您');

  allChats.push({ email, message, reply, time: new Date().toISOString() });
  await dbWrite('chats', allChats);
  res.json({ reply });
});

// ────── 规则管理 ──────
app.get('/api/rules', (req, res) => res.json(aiRules));
app.post('/api/rules/add', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  aiRules.push({ id: Date.now().toString(36), content, createdAt: new Date().toISOString() });
  await dbWrite('aiRules', aiRules);
  res.json({ success: true });
});
app.put('/api/rules/:id', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const rule = aiRules.find(r => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: '规则不存在' });
  rule.content = content;
  rule.updatedAt = new Date().toISOString();
  await dbWrite('aiRules', aiRules);
  res.json({ success: true });
});
app.delete('/api/rules/:id', async (req, res) => {
  aiRules = aiRules.filter(r => r.id !== req.params.id);
  await dbWrite('aiRules', aiRules);
  res.json({ success: true });
});

// ────── 知识库 ──────
app.post('/api/kb/add', async (req, res) => {
  const { question, keywords, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '问题和答案不能为空' });
  const kb = await dbRead('faqKnowledge');
  kb.push({ id: Date.now().toString(36), question, keywords: keywords || [], answer, source: 'manual', createdAt: new Date().toISOString() });
  await dbWrite('faqKnowledge', kb);
  res.json({ success: true });
});
app.get('/api/kb/list', async (req, res) => res.json((await dbRead('faqKnowledge')).reverse()));
app.delete('/api/kb/delete/:id', async (req, res) => {
  let kb = await dbRead('faqKnowledge');
  kb = kb.filter(item => item.id !== req.params.id);
  await dbWrite('faqKnowledge', kb);
  res.json({ success: true });
});

// ────── 学习 URL ──────
app.post('/api/kb/learn-url', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少URL' });
  try {
    const { data } = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data);
    $('script, style, nav, footer, header').remove();
    let text = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 2000);
    const title = $('title').text() || url;
    learnedPages.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      url,
      title,
      content: text,
      createdAt: new Date().toISOString()
    });
    await dbWrite('learnedPages', learnedPages);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '抓取失败' });
  }
});
app.get('/api/kb/learned-list', (req, res) => res.json(learnedPages.slice().reverse()));
app.delete('/api/kb/learned/:id', async (req, res) => {
  learnedPages = learnedPages.filter(p => p.id !== req.params.id);
  await dbWrite('learnedPages', learnedPages);
  res.json({ success: true });
});

// ────── 疑难记录 ──────
app.get('/api/unanswered', async (req, res) => res.json((await dbRead('unanswered')).reverse()));
app.delete('/api/unanswered/:id', async (req, res) => {
  let list = await dbRead('unanswered');
  list = list.filter(item => item.id !== req.params.id);
  await dbWrite('unanswered', list);
  res.json({ success: true });
});

// ────── 人工客服（完整）──────
app.post('/api/save-user-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });
  const emails = await dbRead('userEmails');
  if (!emails.some(e => e.email === email)) {
    emails.push({ email, userId: Buffer.from(email).toString('base64'), time: new Date().toISOString() });
    await dbWrite('userEmails', emails);
  }
  res.json({ success: true });
});
// 人工客服API - 使用MongoDB原子操作
app.post('/api/human-send', async (req, res) => {
  try {
    const { userId, email, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: '缺少参数' });
    
    if (USE_MONGODB && mongoConnected) {
      // 使用MongoDB原子操作
      await HumanChatModel.findOneAndUpdate(
        { userId },
        { 
          $set: { email: email || '', lastActive: new Date() },
          $push: { messages: { sender: 'user', content: message, time: new Date(), read: false } }
        },
        { upsert: true, new: true }
      );
    } else {
      // 本地JSON模式
      const chats = await dbRead('humanChats');
      let userChat = chats.find(c => c.userId === userId);
      if (!userChat) {
        userChat = { userId, email: email || '', note: '', messages: [], lastActive: new Date().toISOString() };
        chats.push(userChat);
      }
      userChat.messages.push({ sender: 'user', content: message, time: new Date().toISOString(), read: false });
      userChat.lastActive = new Date().toISOString();
      await dbWrite('humanChats', chats);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('human-send error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/human-user-list', async (req, res) => {
  try {
    if (USE_MONGODB && mongoConnected) {
      const chats = await HumanChatModel.find({}).lean();
      res.json(chats.map(c => ({
        userId: c.userId,
        email: c.email || '',
        lastActive: c.lastActive,
        unread: c.messages.filter(m => m.sender === 'user' && !m.read).length
      })));
    } else {
      const chats = await dbRead('humanChats');
      res.json(chats.map(c => ({
        userId: c.userId,
        email: c.email || '',
        lastActive: c.lastActive,
        unread: c.messages.filter(m => m.sender === 'user' && !m.read).length
      })));
    }
  } catch (err) {
    console.error('human-user-list error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/human-history', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: '缺少userId' });
    
    if (USE_MONGODB && mongoConnected) {
      // 标记用户消息为已读
      await HumanChatModel.updateOne(
        { userId },
        { $set: { 'messages.$[elem].read': true } },
        { arrayFilters: [{ 'elem.sender': 'user' }] }
      );
      const userChat = await HumanChatModel.findOne({ userId }).lean();
      res.json({ messages: userChat ? userChat.messages : [] });
    } else {
      const chats = await dbRead('humanChats');
      const userChat = chats.find(c => c.userId === userId);
      if (!userChat) return res.json({ messages: [] });
      userChat.messages.forEach(m => { if (m.sender === 'user') m.read = true; });
      await dbWrite('humanChats', chats);
      res.json({ messages: userChat.messages });
    }
  } catch (err) {
    console.error('human-history error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/human-reply', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: '缺少参数' });
    
    if (USE_MONGODB && mongoConnected) {
      const result = await HumanChatModel.findOneAndUpdate(
        { userId },
        { 
          $set: { lastActive: new Date() },
          $push: { messages: { sender: 'agent', content: message, time: new Date(), read: true } }
        },
        { new: true }
      );
      if (!result) return res.status(404).json({ error: '用户不存在' });
    } else {
      const chats = await dbRead('humanChats');
      const userChat = chats.find(c => c.userId === userId);
      if (!userChat) return res.status(404).json({ error: '用户不存在' });
      userChat.messages.push({ sender: 'agent', content: message, time: new Date().toISOString(), read: true });
      userChat.lastActive = new Date().toISOString();
      await dbWrite('humanChats', chats);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('human-reply error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/human-note', async (req, res) => {
  try {
    const { userId } = req.query;
    if (USE_MONGODB && mongoConnected) {
      const userChat = await HumanChatModel.findOne({ userId }).lean();
      res.json({ note: userChat ? userChat.note || '' : '' });
    } else {
      const chats = await dbRead('humanChats');
      const userChat = chats.find(c => c.userId === userId);
      res.json({ note: userChat ? userChat.note || '' : '' });
    }
  } catch (err) {
    console.error('human-note error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/human-note', async (req, res) => {
  try {
    const { userId, note } = req.body;
    if (USE_MONGODB && mongoConnected) {
      await HumanChatModel.findOneAndUpdate(
        { userId },
        { $set: { note } },
        { upsert: true }
      );
    } else {
      const chats = await dbRead('humanChats');
      const userChat = chats.find(c => c.userId === userId);
      if (!userChat) return res.status(404).json({ error: '用户不存在' });
      userChat.note = note;
      await dbWrite('humanChats', chats);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('human-note error:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 其他
app.post('/api/suggest', async (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  const suggests = await dbRead('suggests'); suggests.push({ email, content, time: new Date().toISOString() }); await dbWrite('suggests', suggests);
  res.json({ success: true });
});
app.post('/api/demand', async (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  const demands = await dbRead('demands'); demands.push({ email, content, time: new Date().toISOString() }); await dbWrite('demands', demands);
  res.json({ success: true });
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // 支持旧版只传password的方式（向后兼容）
  if (!username && password) {
    if (password === process.env.ADMIN_PASSWORD) {
      const defaultAdmin = adminAccounts.find(a => a.role === 'superadmin');
      return res.json({ success: true, admin: { username: defaultAdmin?.username || 'admin', role: 'superadmin', permissions: ['all'] } });
    }
    return res.status(401).json({ error: '密码错误' });
  }
  
  // 新版账号+密码登录
  const admin = adminAccounts.find(a => a.username === username && a.password === password);
  if (admin) {
    res.json({ success: true, admin: { username: admin.username, role: admin.role, permissions: admin.permissions } });
  } else {
    res.status(401).json({ error: '账号或密码错误' });
  }
});

// ────── 管理员账号管理 ──────
app.get('/api/admin/accounts', (req, res) => {
  // 返回账号列表（不返回密码）
  const list = adminAccounts.map(a => ({
    id: a.id,
    username: a.username,
    role: a.role,
    permissions: a.permissions,
    createdAt: a.createdAt
  }));
  res.json(list);
});

app.post('/api/admin/accounts', async (req, res) => {
  const { username, password, role, permissions } = req.body;
  if (!username || !password) return res.status(400).json({ error: '账号和密码不能为空' });
  if (adminAccounts.some(a => a.username === username)) return res.status(400).json({ error: '账号已存在' });
  
  const newAdmin = {
    id: Date.now().toString(36),
    username,
    password,
    role: role || 'admin',
    permissions: permissions || ['ai-chats', 'suggests', 'demands', 'human', 'emails', 'knowledge', 'rules', 'unanswered', 'learn'],
    createdAt: new Date().toISOString()
  };
  adminAccounts.push(newAdmin);
  await dbWrite('adminAccounts', adminAccounts);
  res.json({ success: true, admin: { ...newAdmin, password: undefined } });
});

app.put('/api/admin/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const { username, password, role, permissions } = req.body;
  
  const index = adminAccounts.findIndex(a => a.id === id);
  if (index === -1) return res.status(404).json({ error: '账号不存在' });
  if (adminAccounts[index].role === 'superadmin' && id === 'default') {
    return res.status(403).json({ error: '不能修改默认超级管理员' });
  }
  
  if (username) adminAccounts[index].username = username;
  if (password) adminAccounts[index].password = password;
  if (role) adminAccounts[index].role = role;
  if (permissions) adminAccounts[index].permissions = permissions;
  
  await dbWrite('adminAccounts', adminAccounts);
  res.json({ success: true, admin: { ...adminAccounts[index], password: undefined } });
});

app.delete('/api/admin/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const admin = adminAccounts.find(a => a.id === id);
  if (!admin) return res.status(404).json({ error: '账号不存在' });
  if (admin.role === 'superadmin' && id === 'default') {
    return res.status(403).json({ error: '不能删除默认超级管理员' });
  }
  
  adminAccounts = adminAccounts.filter(a => a.id !== id);
  await dbWrite('adminAccounts', adminAccounts);
  res.json({ success: true });
});
app.get('/api/ai-chats', async (req, res) => res.json((await dbRead('chats')).reverse()));
app.get('/api/suggests', async (req, res) => res.json((await dbRead('suggests')).reverse()));
app.get('/api/demands', async (req, res) => res.json((await dbRead('demands')).reverse()));
app.get('/api/user-email-list', async (req, res) => res.json((await dbRead('userEmails')).reverse()));

// 健康检查端点
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '5.0-fixed',
    mongoConnected: USE_MONGODB && mongoConnected,
    useMongoDB: USE_MONGODB,
    hasApiKey: !!process.env.VOLC_API_KEY,
    hasModelId: !!process.env.VOLC_MODEL_ID,
    aiRulesCount: aiRules.length,
    sitePagesCount: sitePages.length,
    learnedPagesCount: learnedPages.length,
    adminAccountsCount: adminAccounts.length
  });
});

// ────── 启动服务 ──────
async function startServer() {
  await connectMongoDB();
  
  // 如果 MongoDB 连接成功，从 MongoDB 加载数据
  if (USE_MONGODB && mongoConnected) {
    const loadedAiRules = await dbRead('aiRules');
    const loadedSitePages = await dbRead('sitePages');
    const loadedLearnedPages = await dbRead('learnedPages');
    const loadedAdminAccounts = await dbRead('adminAccounts');
    
    if (loadedAiRules.length > 0) aiRules = loadedAiRules;
    if (loadedSitePages.length > 0) sitePages = loadedSitePages;
    if (loadedLearnedPages.length > 0) learnedPages = loadedLearnedPages;
    if (loadedAdminAccounts.length > 0) adminAccounts = loadedAdminAccounts;
  }
  
  await initDefaultAdmin();
  
  app.listen(PORT, () => console.log(`🚀 HOYOYO 5.0 已启动：http://localhost:${PORT}`));
}

startServer();
