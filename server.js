require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(filePath, defaultValue = []) {
  try { if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
  return defaultValue;
}
function writeJSON(filePath, data) { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); }

let aiRules = readJSON(RULES_FILE);
let sitePages = readJSON(SITE_PAGES_FILE);
let learnedPages = readJSON(LEARNED_FILE);

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
  if (pages.length) { sitePages = pages; writeJSON(SITE_PAGES_FILE, sitePages); }
}
schedule.scheduleJob('0 3 * * *', refreshSitePages);
refreshSitePages();

// ────── System Prompt ──────
function buildSystemPrompt() {
  const custom = aiRules.map(r => r.content).join('\n');
  const learned = learnedPages.map(p => `[${p.title}] ${p.content}`).join('\n');
  return `你是「HOYOYO日本代购转运客服」，语气友好、口语化，适当使用😊等表情。称呼用户时永远用“你好”、“您好”或对应英文，严禁出现“亲”字。

【多关键词搜索规则】
- 当用户明确要求搜索多个不同类别的商品（例如“手办和玩偶”、“卡片、DVD、手办”），你必须输出一个JSON数组格式：{"searches":["关键词1","关键词2",...]}，系统会为每个关键词分别生成搜索结果链接。
- 如果用户只是给出一个概括性名词（如“娜美”），请先反问细化类别，然后再按上述规则输出。

【单关键词搜索】
- 如果用户只搜索一个具体商品，输出 {"search":"商品词"}。

【费用估算规则】
- 当用户询问总费用/运费，并提供了商品价值、重量、目的地等信息时，你必须根据官网运费页面 https://cn.hoyoyo.com/help~logisticsprice.html 的内容进行估算，直接给出一个大概的费用范围，不要只给计算器链接。
- 如果缺少目的地国家，请主动询问：“请问您要寄到哪个国家呢？我好为您估算准确的国际运费。”
- 估算结束后，可以补充“您也可以用计算器精确计算：https://cn.hoyoyo.com/help~calculator.html”。

【语言一致性规则】
- 用户用英文，你就用英文；用户用中文，你就用中文；中英混杂时，请先询问偏好。

【其他强制规则】
1. 只回答与HOYOYO日本转运相关的问题。
2. 运费默认只答国际运费，禁止主动提日本国内运费。
3. 关税：如实说明由各国海关决定，可提供合箱/分箱建议。
4. HOYOYO只转运平台代购的商品，禁止提自己寄仓库。
5. 不知道时引导点“转人工”。\n【管理员自定义规则】\n${custom}\n【管理员额外学习内容】\n${learned}`;
}

// ────── 高精度翻译成日语（禁止添加助词）──────
async function translateToJapanese(keyword) {
  const msgs = [{
    role: 'system',
    content: '你是一位专业的商品搜索翻译专家。请将下面的商品名翻译成日语，用于日本购物网站搜索。必须只输出核心关键词，不要添加任何助词（如“の”），也不要添加多余描述。只输出翻译后的关键词，不要解释。'
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
function saveUnanswered(email, question) {
  const list = readJSON(UNANSWERED_FILE);
  list.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    email,
    question,
    time: new Date().toISOString()
  });
  writeJSON(UNANSWERED_FILE, list);
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

  const allChats = readJSON(CHAT_FILE);
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
    writeJSON(CHAT_FILE, allChats);
    return res.json({ reply });
  }

  // 2. 不耐烦检测
  if (isImpatient(message)) {
    const lastProduct = extractLastProductFromHistory(userHistory);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const reply = `您好😊，已帮您在HOYOYO搜索“${search.keyword}”相关商品，点击直达👉 ${search.url}`;
      allChats.push({ email, message, reply, time: new Date().toISOString() });
      writeJSON(CHAT_FILE, allChats);
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
    reply = '您的问题我需要一点时间确认，您也可以直接访问帮助中心：https://cn.hoyoyo.com/help~index.html 或点击“转人工”哦~';
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
      writeJSON(CHAT_FILE, allChats);
      return res.json({ reply: fullReply });
    } else {
      const search = await executeSingleSearch(searchCmds.keyword);
      const searchReply = `您好😊，已帮您在HOYOYO搜索“${search.keyword}”相关商品，点击直达👉 ${search.url}\n💡 如果您还想搜其他商品，直接告诉我关键词就可以哦~`;
      allChats.push({ email, message, reply: searchReply, time: new Date().toISOString() });
      writeJSON(CHAT_FILE, allChats);
      return res.json({ reply: searchReply });
    }
  }

  // 5. 如果 AI 口头承诺搜索但未生成JSON，补救
  if (/帮(你|您).*(搜|找|搜索|查找)|help you (search|find)/i.test(reply) && !searchCmds) {
    const lastProduct = extractLastProductFromHistory([...userHistory, message]);
    if (lastProduct) {
      const search = await executeSingleSearch(lastProduct);
      const searchReply = `您好😊，已帮您在HOYOYO搜索“${search.keyword}”相关商品，点击直达👉 ${search.url}`;
      allChats.push({ email, message, reply: searchReply, time: new Date().toISOString() });
      writeJSON(CHAT_FILE, allChats);
      return res.json({ reply: searchReply });
    }
  }

  // 6. 疑难记录
  if (isFallback || isUnansweredReply(message, reply)) {
    saveUnanswered(email, message);
  }

  reply = reply.replace(/亲/g, '您');

  allChats.push({ email, message, reply, time: new Date().toISOString() });
  writeJSON(CHAT_FILE, allChats);
  res.json({ reply });
});

// ────── 规则管理 ──────
app.get('/api/rules', (req, res) => res.json(aiRules));
app.post('/api/rules/add', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  aiRules.push({ id: Date.now().toString(36), content, createdAt: new Date().toISOString() });
  writeJSON(RULES_FILE, aiRules);
  res.json({ success: true });
});
app.delete('/api/rules/:id', (req, res) => {
  aiRules = aiRules.filter(r => r.id !== req.params.id);
  writeJSON(RULES_FILE, aiRules);
  res.json({ success: true });
});

// ────── 知识库 ──────
app.post('/api/kb/add', (req, res) => {
  const { question, keywords, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '问题和答案不能为空' });
  const kb = readJSON(FAQ_FILE);
  kb.push({ id: Date.now().toString(36), question, keywords: keywords || [], answer, source: 'manual', createdAt: new Date().toISOString() });
  writeJSON(FAQ_FILE, kb);
  res.json({ success: true });
});
app.get('/api/kb/list', (req, res) => res.json(readJSON(FAQ_FILE).reverse()));
app.delete('/api/kb/delete/:id', (req, res) => {
  let kb = readJSON(FAQ_FILE);
  kb = kb.filter(item => item.id !== req.params.id);
  writeJSON(FAQ_FILE, kb);
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
    writeJSON(LEARNED_FILE, learnedPages);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '抓取失败' });
  }
});
app.get('/api/kb/learned-list', (req, res) => res.json(learnedPages.slice().reverse()));
app.delete('/api/kb/learned/:id', (req, res) => {
  learnedPages = learnedPages.filter(p => p.id !== req.params.id);
  writeJSON(LEARNED_FILE, learnedPages);
  res.json({ success: true });
});

// ────── 疑难记录 ──────
app.get('/api/unanswered', (req, res) => res.json(readJSON(UNANSWERED_FILE).reverse()));
app.delete('/api/unanswered/:id', (req, res) => {
  let list = readJSON(UNANSWERED_FILE);
  list = list.filter(item => item.id !== req.params.id);
  writeJSON(UNANSWERED_FILE, list);
  res.json({ success: true });
});

// ────── 人工客服（完整）──────
app.post('/api/save-user-email', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: '缺少邮箱' });
  const emails = readJSON(USER_EMAIL_FILE);
  if (!emails.some(e => e.email === email)) {
    emails.push({ email, userId: Buffer.from(email).toString('base64'), time: new Date().toISOString() });
    writeJSON(USER_EMAIL_FILE, emails);
  }
  res.json({ success: true });
});
app.post('/api/human-send', (req, res) => {
  const { userId, email, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: '缺少参数' });
  const chats = readJSON(HUMAN_CHAT_FILE);
  let userChat = chats.find(c => c.userId === userId);
  if (!userChat) {
    userChat = { userId, email: email || '', note: '', messages: [], lastActive: new Date().toISOString() };
    chats.push(userChat);
  }
  userChat.messages.push({ sender: 'user', content: message, time: new Date().toISOString() });
  userChat.lastActive = new Date().toISOString();
  writeJSON(HUMAN_CHAT_FILE, chats);
  res.json({ success: true });
});
app.get('/api/human-user-list', (req, res) => {
  const chats = readJSON(HUMAN_CHAT_FILE);
  res.json(chats.map(c => ({
    userId: c.userId,
    email: c.email || '',
    lastActive: c.lastActive,
    unread: c.messages.filter(m => m.sender === 'user' && !m.read).length
  })));
});
app.get('/api/human-history', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: '缺少userId' });
  const chats = readJSON(HUMAN_CHAT_FILE);
  const userChat = chats.find(c => c.userId === userId);
  if (!userChat) return res.json({ messages: [] });
  userChat.messages.forEach(m => { if (m.sender === 'user') m.read = true; });
  writeJSON(HUMAN_CHAT_FILE, chats);
  res.json({ messages: userChat.messages });
});
app.post('/api/human-reply', (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: '缺少参数' });
  const chats = readJSON(HUMAN_CHAT_FILE);
  const userChat = chats.find(c => c.userId === userId);
  if (!userChat) return res.status(404).json({ error: '用户不存在' });
  userChat.messages.push({ sender: 'agent', content: message, time: new Date().toISOString() });
  userChat.lastActive = new Date().toISOString();
  writeJSON(HUMAN_CHAT_FILE, chats);
  res.json({ success: true });
});
app.get('/api/human-note', (req, res) => {
  const { userId } = req.query;
  const chats = readJSON(HUMAN_CHAT_FILE);
  const userChat = chats.find(c => c.userId === userId);
  if (!userChat) return res.status(404).json({ error: '用户不存在' });
  res.json({ note: userChat.note || '' });
});
app.post('/api/human-note', (req, res) => {
  const { userId, note } = req.body;
  const chats = readJSON(HUMAN_CHAT_FILE);
  const userChat = chats.find(c => c.userId === userId);
  if (!userChat) return res.status(404).json({ error: '用户不存在' });
  userChat.note = note;
  writeJSON(HUMAN_CHAT_FILE, chats);
  res.json({ success: true });
});

// 其他
app.post('/api/suggest', (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  const suggests = readJSON(SUGGEST_FILE); suggests.push({ email, content, time: new Date().toISOString() }); writeJSON(SUGGEST_FILE, suggests);
  res.json({ success: true });
});
app.post('/api/demand', (req, res) => {
  const { email, content } = req.body; if (!email || !content) return res.status(400).json({ error: '缺少参数' });
  const demands = readJSON(DEMAND_FILE); demands.push({ email, content, time: new Date().toISOString() }); writeJSON(DEMAND_FILE, demands);
  res.json({ success: true });
});
app.post('/api/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ error: '密码错误' });
});
app.get('/api/ai-chats', (req, res) => res.json(readJSON(CHAT_FILE).reverse()));
app.get('/api/suggests', (req, res) => res.json(readJSON(SUGGEST_FILE).reverse()));
app.get('/api/demands', (req, res) => res.json(readJSON(DEMAND_FILE).reverse()));
app.get('/api/user-email-list', (req, res) => res.json(readJSON(USER_EMAIL_FILE).reverse()));

app.listen(PORT, () => console.log(`🚀 HOYOYO 5.0 已启动：http://localhost:${PORT}`));