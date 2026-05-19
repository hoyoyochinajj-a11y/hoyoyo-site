require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// ────── 数据存储配置 ──────
const USE_MONGODB = !!process.env.MONGODB_URI;

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

// ────── MongoDB 连接 ──────
let mongoose, dbModels;

if (USE_MONGODB) {
  mongoose = require('mongoose');
  // 定义所有 Schema
  const chatSchema = new mongoose.Schema({
    email: String,
    message: String,
    reply: String,
    time: String
  }, { strict: false });

  const humanChatSchema = new mongoose.Schema({
    userId: String,
    email: String,
    note: String,
    messages: [{
      sender: String,
      content: String,
      time: String,
      read: Boolean
    }],
    lastActive: String
  }, { strict: false });

  const suggestSchema = new mongoose.Schema({
    email: String,
    content: String,
    time: String
  }, { strict: false });

  const demandSchema = new mongoose.Schema({
    email: String,
    content: String,
    time: String
  }, { strict: false });

  const userEmailSchema = new mongoose.Schema({
    email: String,
    userId: String,
    time: String
  }, { strict: false });

  const aiRuleSchema = new mongoose.Schema({
    id: String,
    content: String,
    createdAt: String
  }, { strict: false });

  const faqKnowledgeSchema = new mongoose.Schema({
    id: String,
    question: String,
    keywords: [String],
    answer: String,
    source: String,
    createdAt: String
  }, { strict: false });

  const sitePageSchema = new mongoose.Schema({
    url: String,
    chunks: [{
      text: String
    }]
  }, { strict: false });

  const unansweredSchema = new mongoose.Schema({
    id: String,
    email: String,
    question: String,
    time: String
  }, { strict: false });

  const learnedPageSchema = new mongoose.Schema({
    id: String,
    url: String,
    title: String,
    content: String,
    createdAt: String
  }, { strict: false });

  const adminAccountSchema = new mongoose.Schema({
    id: String,
    username: String,
    password: String,
    role: String,
    permissions: [String],
    createdAt: String
  }, { strict: false });

  dbModels = {
    chats: mongoose.model('Chat', chatSchema),
    humanChats: mongoose.model('HumanChat', humanChatSchema),
    suggests: mongoose.model('Suggest', suggestSchema),
    demands: mongoose.model('Demand', demandSchema),
    userEmails: mongoose.model('UserEmail', userEmailSchema),
    aiRules: mongoose.model('AiRule', aiRuleSchema),
    faqKnowledge: mongoose.model('FaqKnowledge', faqKnowledgeSchema),
    sitePages: mongoose.model('SitePage', sitePageSchema),
    unanswered: mongoose.model('Unanswered', unansweredSchema),
    learnedPages: mongoose.model('LearnedPage', learnedPageSchema),
    adminAccounts: mongoose.model('AdminAccount', adminAccountSchema),
  };
}

// ────── 统一数据访问层 ──────
// collectionName: 'chats' | 'humanChats' | 'suggests' | 'demands' | 'userEmails' | 'aiRules' | 'faqKnowledge' | 'sitePages' | 'unanswered' | 'learnedPages' | 'adminAccounts'
// filePath: 对应的本地 JSON 文件路径
// defaultValue: 默认值（仅本地模式使用）

const COLLECTION_FILE_MAP = {
  chats: CHAT_FILE,
  humanChats: HUMAN_CHAT_FILE,
  suggests: SUGGEST_FILE,
  demands: DEMAND_FILE,
  userEmails: USER_EMAIL_FILE,
  aiRules: RULES_FILE,
  faqKnowledge: FAQ_FILE,
  sitePages: SITE_PAGES_FILE,
  unanswered: UNANSWERED_FILE,
  learnedPages: LEARNED_FILE,
  adminAccounts: ADMIN_ACCOUNTS_FILE,
};

function readJSON(filePath, defaultValue = []) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
  return defaultValue;
}
function writeJSON(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }

// 通用数据读取（异步）
async function dbFindAll(collectionName, defaultValue = []) {
  if (USE_MONGODB) {
    const docs = await dbModels[collectionName].find({}).lean();
    return docs.map(doc => {
      const obj = { ...doc };
      delete obj._id;
      delete obj.__v;
      return obj;
    });
  } else {
    return readJSON(COLLECTION_FILE_MAP[collectionName], defaultValue);
  }
}

// 通用数据写入（全量替换）
async function dbReplaceAll(collectionName, data, filePath) {
  if (USE_MONGODB) {
    await dbModels[collectionName].deleteMany({});
    if (Array.isArray(data) && data.length > 0) {
      await dbModels[collectionName].insertMany(data);
    }
  } else {
    writeJSON(filePath, data);
  }
}

// 通用单条插入
async function dbPush(collectionName, item) {
  if (USE_MONGODB) {
    await dbModels[collectionName].create(item);
  } else {
    const filePath = COLLECTION_FILE_MAP[collectionName];
    const list = readJSON(filePath);
    list.push(item);
    writeJSON(filePath, list);
  }
}

// 通用按条件更新
async function dbUpdateOne(collectionName, filter, update) {
  if (USE_MONGODB) {
    await dbModels[collectionName].updateOne(filter, update);
  } else {
    const filePath = COLLECTION_FILE_MAP[collectionName];
    const list = readJSON(filePath);
    const index = list.findIndex(item => {
      return Object.keys(filter).every(key => item[key] === filter[key]);
    });
    if (index !== -1) {
      Object.assign(list[index], update.$set || update);
      writeJSON(filePath, list);
    }
  }
}

// 通用按条件删除
async function dbDeleteMany(collectionName, filter) {
  if (USE_MONGODB) {
    await dbModels[collectionName].deleteMany(filter);
  } else {
    const filePath = COLLECTION_FILE_MAP[collectionName];
    let list = readJSON(filePath);
    list = list.filter(item => {
      return !Object.keys(filter).every(key => item[key] === filter[key]);
    });
    writeJSON(filePath, list);
  }
}

// 通用按条件查找
async function dbFind(collectionName, filter) {
  if (USE_MONGODB) {
    const docs = await dbModels[collectionName].find(filter).lean();
    return docs.map(doc => {
      const obj = { ...doc };
      delete obj._id;
      delete obj.__v;
      return obj;
    });
  } else {
    const filePath = COLLECTION_FILE_MAP[collectionName];
    const list = readJSON(filePath);
    return list.filter(item => {
      return Object.keys(filter).every(key => item[key] === filter[key]);
    });
  }
}

// ────── 初始化内存缓存 ──────
let aiRules, sitePages, learnedPages, adminAccounts;

async function initData() {
  if (USE_MONGODB) {
    aiRules = await dbFindAll('aiRules', []);
    sitePages = await dbFindAll('sitePages', []);
    learnedPages = await dbFindAll('learnedPages', []);
    adminAccounts = await dbFindAll('adminAccounts', []);
  } else {
    aiRules = readJSON(RULES_FILE);
    sitePages = readJSON(SITE_PAGES_FILE);
    learnedPages = readJSON(LEARNED_FILE);
    adminAccounts = readJSON(ADMIN_ACCOUNTS_FILE);
  }

  // 初始化默认管理员账号（如果不存在）
  const defaultAdminUsername = process.env.ADMIN_USERNAME || 'admin';
  const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'hoyoyo111';
  if (!adminAccounts.some(a => a.username === defaultAdminUsername)) {
    const newAdmin = {
      id: 'default',
      username: defaultAdminUsername,
      password: defaultAdminPassword,
      role: 'superadmin',
      permissions: ['all'],
      createdAt: new Date().toISOString()
    };
    adminAccounts.push(newAdmin);
    await dbPush('adminAccounts', newAdmin);
    if (!USE_MONGODB) {
      writeJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
    }
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
  if (pages.length) {
    sitePages = pages;
    await dbReplaceAll('sitePages', sitePages, SITE_PAGES_FILE);
  }
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
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    email,
    question,
    time: new Date().toISOString()
  };
  await dbPush('unanswered', item);
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

  const allChats = await dbFindAll('chats');
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
    await dbPush('chats', { email, message, reply, time: new Date().toISOString() });
    return res.json({ reply });
  }

  // 2. 不耐烦检测
  if (isImpatient(message)) {
    const lastProduct = extractLastProductFromHistory(userHistory);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const reply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}`;
      await dbPush('chats', { email, message, reply, time: new Date().toISOString() });
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
      await dbPush('chats', { email, message, reply: fullReply, time: new Date().toISOString() });
      return res.json({ reply: fullReply });
    } else {
      const search = await executeSingleSearch(searchCmds.keyword);
      const searchReply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}\n💡 如果您还想搜其他商品，直接告诉我关键词就可以哦~`;
      await dbPush('chats', { email, message, reply: searchReply, time: new Date().toISOString() });
      return res.json({ reply: searchReply });
    }
  }

  // 5. 如果 AI 口头承诺搜索但未生成JSON，补救
  if (/帮(你|您).*(搜|找|搜索|查找)|help you (search|find)/i.test(reply) && !searchCmds) {
    const lastProduct = extractLastProductFromHistory([...userHistory, message]);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const searchReply = `您好😊，已帮您在HOYOYO搜索"${search.keyword}"相关商品，点击直达👉 ${search.url}`;
      await dbPush('chats', { email, message, reply: searchReply, time: new Date().toISOString() });
      return res.json({ reply: searchReply });
    }
  }

  // 6. 疑难记录
  if (isFallback || isUnansweredReply(message, reply)) {
    await saveUnanswered(email, message);
  }

  reply = reply.replace(/亲/g, '您');

  await dbPush('chats', { email, message, reply, time: new Date().toISOString() });
  res.json({ reply });
});

// ────── 规则管理 ──────
app.get('/api/rules', (req, res) => res.json(aiRules));
app.post('/api/rules/add', async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const newRule = { id: Date.now().toString(36), content, createdAt: new Date().toISOString() };
  aiRules.push(newRule);
  await dbReplaceAll('aiRules', aiRules, RULES_FILE);
  res.json({ success: true });
});
app.delete('/api/rules/:id', async (req, res) => {
  aiRules = aiRules.filter(r => r.id !== req.params.id);
  await dbReplaceAll('aiRules', aiRules, RULES_FILE);
  res.json({ success: true });
});

// ────── 知识库 ──────
app.post('/api/kb/add', async (req, res) => {
  const { question, keywords, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '问题和答案不能为空' });
  const newItem = { id: Date.now().toString(36), question, keywords: keywords || [], answer, source: 'manual', createdAt: new Date().toISOString() };
  await dbPush('faqKnowledge', newItem);
  res.json({ success: true });
});
app.get('/api/kb/list', async (req, res) => {
  const kb = await dbFindAll('faqKnowledge');
  res.json(kb.reverse());
});
app.delete('/api/kb/delete/:id', async (req, res) => {
  await dbDeleteMany('faqKnowledge', { id: req.params.id });
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
    const newPage = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      url,
      title,
      content: text,
      createdAt: new Date().toISOString()
    };
    learnedPages.push(newPage);
    await dbReplaceAll('learnedPages', learnedPages, LEARNED_FILE);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '抓取失败' });
  }
});
app.get('/api/kb/learned-list', (req, res) => res.json(learnedPages.slice().reverse()));
app.delete('/api/kb/learned/:id', async (req, res) => {
  learnedPages = learnedPages.filter(p => p.id !== req.params.id);
  await dbReplaceAll('learnedPages', learnedPages, LEARNED_FILE);
  res.json({ success: true });
});

// ────── 疑难记录 ──────
app.get('/api/unanswered', async (req, res) => {
  const list = await dbFindAll('unanswered');
  res.json(list.reverse());
});
app.delete('/api/unanswered/:id', async (req, res) => {
  await dbDeleteMany('unanswered', { id: req.params.id });
  res.json({ success: true });
});

// ────── 人工客服（完整）──────
app.post('/api/save-user-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });
  const existing = await dbFind('userEmails', { email });
  if (existing.length === 0) {
    await dbPush('userEmails', { email, userId: Buffer.from(email).toString('base64'), time: new Date().toISOString() });
  }
  res.json({ success: true });
});

app.post('/api/human-send', async (req, res) => {
  const { userId, email, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: '缺少参数' });

  if (USE_MONGODB) {
    let userChat = await dbModels.humanChats.findOne({ userId });
    if (!userChat) {
      userChat = { userId, email: email || '', note: '', messages: [], lastActive: new Date().toISOString() };
      await dbModels.humanChats.create(userChat);
    }
    userChat.messages.push({ sender: 'user', content: message, time: new Date().toISOString() });
    userChat.lastActive = new Date().toISOString();
    await dbModels.humanChats.updateOne({ userId }, { $set: { messages: userChat.messages, lastActive: userChat.lastActive } });
  } else {
    const chats = readJSON(HUMAN_CHAT_FILE);
    let userChat = chats.find(c => c.userId === userId);
    if (!userChat) {
      userChat = { userId, email: email || '', note: '', messages: [], lastActive: new Date().toISOString() };
      chats.push(userChat);
    }
    userChat.messages.push({ sender: 'user', content: message, time: new Date().toISOString() });
    userChat.lastActive = new Date().toISOString();
    writeJSON(HUMAN_CHAT_FILE, chats);
  }
  res.json({ success: true });
});

app.get('/api/human-user-list', async (req, res) => {
  let chats;
  if (USE_MONGODB) {
    chats = await dbModels.humanChats.find({}).lean();
    chats = chats.map(doc => {
      const obj = { ...doc };
      delete obj._id;
      delete obj.__v;
      return obj;
    });
  } else {
    chats = readJSON(HUMAN_CHAT_FILE);
  }
  res.json(chats.map(c => ({
    userId: c.userId,
    email: c.email || '',
    lastActive: c.lastActive,
    unread: c.messages.filter(m => m.sender === 'user' && !m.read).length
  })));
});

app.get('/api/human-history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: '缺少userId' });

  if (USE_MONGODB) {
    const userChat = await dbModels.humanChats.findOne({ userId });
    if (!userChat) return res.json({ messages: [] });
    // 标记已读
    const updatedMessages = userChat.messages.map(m => {
      if (m.sender === 'user') m.read = true;
      return m;
    });
    await dbModels.humanChats.updateOne({ userId }, { $set: { messages: updatedMessages } });
    res.json({ messages: updatedMessages });
  } else {
    const chats = readJSON(HUMAN_CHAT_FILE);
    const userChat = chats.find(c => c.userId === userId);
    if (!userChat) return res.json({ messages: [] });
    userChat.messages.forEach(m => { if (m.sender === 'user') m.read = true; });
    writeJSON(HUMAN_CHAT_FILE, chats);
    res.json({ messages: userChat.messages });
  }
});

app.post('/api/human-reply', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: '缺少参数' });

  if (USE_MONGODB) {
    const userChat = await dbModels.humanChats.findOne({ userId });
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    userChat.messages.push({ sender: 'agent', content: message, time: new Date().toISOString() });
    userChat.lastActive = new Date().toISOString();
    await dbModels.humanChats.updateOne({ userId }, { $set: { messages: userChat.messages, lastActive: userChat.lastActive } });
  } else {
    const chats = readJSON(HUMAN_CHAT_FILE);
    const userChat = chats.find(c => c.userId === userId);
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    userChat.messages.push({ sender: 'agent', content: message, time: new Date().toISOString() });
    userChat.lastActive = new Date().toISOString();
    writeJSON(HUMAN_CHAT_FILE, chats);
  }
  res.json({ success: true });
});

app.get('/api/human-note', async (req, res) => {
  const { userId } = req.query;
  if (USE_MONGODB) {
    const userChat = await dbModels.humanChats.findOne({ userId });
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    res.json({ note: userChat.note || '' });
  } else {
    const chats = readJSON(HUMAN_CHAT_FILE);
    const userChat = chats.find(c => c.userId === userId);
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    res.json({ note: userChat.note || '' });
  }
});

app.post('/api/human-note', async (req, res) => {
  const { userId, note } = req.body;
  if (USE_MONGODB) {
    const userChat = await dbModels.humanChats.findOne({ userId });
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    await dbModels.humanChats.updateOne({ userId }, { $set: { note } });
  } else {
    const chats = readJSON(HUMAN_CHAT_FILE);
    const userChat = chats.find(c => c.userId === userId);
    if (!userChat) return res.status(404).json({ error: '用户不存在' });
    userChat.note = note;
    writeJSON(HUMAN_CHAT_FILE, chats);
  }
  res.json({ success: true });
});

// 其他
app.post('/api/suggest', async (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  await dbPush('suggests', { email, content, time: new Date().toISOString() });
  res.json({ success: true });
});
app.post('/api/demand', async (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  await dbPush('demands', { email, content, time: new Date().toISOString() });
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
  await dbReplaceAll('adminAccounts', adminAccounts, ADMIN_ACCOUNTS_FILE);
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

  await dbReplaceAll('adminAccounts', adminAccounts, ADMIN_ACCOUNTS_FILE);
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
  await dbReplaceAll('adminAccounts', adminAccounts, ADMIN_ACCOUNTS_FILE);
  res.json({ success: true });
});

app.get('/api/ai-chats', async (req, res) => {
  const chats = await dbFindAll('chats');
  res.json(chats.reverse());
});
app.get('/api/suggests', async (req, res) => {
  const suggests = await dbFindAll('suggests');
  res.json(suggests.reverse());
});
app.get('/api/demands', async (req, res) => {
  const demands = await dbFindAll('demands');
  res.json(demands.reverse());
});
app.get('/api/user-email-list', async (req, res) => {
  const emails = await dbFindAll('userEmails');
  res.json(emails.reverse());
});

// ────── 启动服务 ──────
async function startServer() {
  if (USE_MONGODB) {
    try {
      console.log('📦 正在连接 MongoDB...');
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('✅ MongoDB 连接成功');
    } catch (err) {
      console.error('❌ MongoDB 连接失败:', err.message);
      console.log('⚠️  回退到本地 JSON 文件存储模式');
      // 连接失败时回退到本地模式
      process.env.MONGODB_URI = '';
      // 重新标记
      Object.defineProperty(process.env, 'MONGODB_URI', { value: '', writable: true });
    }
  }

  await initData();

  app.listen(PORT, () => console.log(`🚀 HOYOYO 5.0 已启动：http://localhost:${PORT} | 存储模式：${USE_MONGODB ? 'MongoDB' : '本地JSON文件'}`));
}

startServer().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
