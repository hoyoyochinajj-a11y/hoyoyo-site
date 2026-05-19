# 🤖 HOYOYO AI客服系统

基于 Node.js + Express + 豆包 API 的智能客服系统，支持 AI 自动回复、人工客服接管、知识库管理等功能。

## ✨ 功能特性

- **AI 智能回复**: 集成豆包/火山引擎大模型，自动回答用户问题
- **多语言支持**: 支持中文、繁体中文、英文、日文
- **商品搜索**: 自动识别商品关键词，生成 HOYOYO 搜索链接
- **链接转换**: 自动转换煤炉(Mercari)、雅虎拍卖链接
- **人工客服**: 支持无缝转接人工客服
- **管理后台**: 完整的后台管理系统
  - AI 对话记录查看
  - 人工客服实时对话
  - 知识库管理
  - 规则管理
  - 疑难问题记录
  - URL 学习内容抓取
  - **管理员账号管理**: 支持创建子账号、分配权限
- **定时任务**: 自动抓取官网帮助页面内容

## 🚀 快速部署

### 方法一：一键脚本部署（推荐）

```bash
# 1. 将代码上传到服务器
# 2. 运行部署脚本
sudo bash deploy.sh
```

### 方法二：手动部署

#### 1. 环境要求
- Node.js >= 16
- Nginx (推荐)
- PM2 (进程管理)

#### 2. 安装依赖
```bash
npm install
```

#### 3. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，填入 API Key 和密码
```

#### 4. 启动服务
```bash
# 开发模式
npm run dev

# 生产模式
npm start

# 使用 PM2
npm run pm2:start
```

### 方法三：Docker 部署

```bash
# 构建镜像
docker build -t hoyoyo-ai .

# 运行容器
docker run -d \
  --name hoyoyo-ai \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  hoyoyo-ai
```

## 📁 项目结构

```
hoyoyo-ai-service/
├── server.js          # 主服务文件
├── package.json       # 依赖配置
├── .env.example       # 环境变量模板
├── .env               # 环境变量（需自己创建）
├── Dockerfile         # Docker 构建文件
├── deploy.sh          # 一键部署脚本
├── README.md          # 说明文档
├── public/            # 静态文件目录
│   ├── index.html     # 客服页面
│   ├── human.html     # 人工客服页面
│   └── admin.html     # 管理后台
└── data/              # 数据存储目录
    ├── chat.json          # AI 对话记录
    ├── human_chat.json    # 人工客服记录
    ├── ai_rules.json      # AI 规则
    ├── faq_knowledge.json # 知识库
    ├── admin_accounts.json # 管理员账号
    └── ...
```

## ⚙️ 环境变量配置

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `PORT` | 否 | 服务端口，默认 3000 |
| `VOLC_API_KEY` | 是 | 火山引擎 API Key |
| `VOLC_MODEL_ID` | 是 | 火山引擎模型 ID |
| `ADMIN_USERNAME` | 否 | 管理后台登录账号，默认 admin |
| `ADMIN_PASSWORD` | 是 | 管理后台登录密码 |
| `NODE_ENV` | 否 | 运行环境，默认 production |

### 获取火山引擎 API Key

1. 访问 [火山引擎控制台](https://console.volcengine.com/)
2. 创建方舟应用，获取 API Key
3. 创建推理接入点，获取模型 ID

## 🔧 Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔒 HTTPS 配置（推荐）

使用 Certbot 免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

## 📝 常用命令

```bash
# PM2 管理
pm2 start hoyoyo-ai      # 启动
pm2 stop hoyoyo-ai       # 停止
pm2 restart hoyoyo-ai    # 重启
pm2 logs hoyoyo-ai       # 查看日志
pm2 monit                # 监控面板

# 系统服务
sudo systemctl start hoyoyo-ai
sudo systemctl stop hoyoyo-ai
sudo systemctl restart hoyoyo-ai
sudo systemctl status hoyoyo-ai
```

## 🌐 访问地址

部署完成后，可以通过以下地址访问：

- **客服页面**: `http://your-server-ip/`
- **人工客服**: `http://your-server-ip/human.html`
- **管理后台**: `http://your-server-ip/admin.html`

## ⚠️ 注意事项

1. **API Key 安全**: 不要将 `.env` 文件提交到代码仓库
2. **数据备份**: 定期备份 `data/` 目录下的 JSON 文件
3. **防火墙配置**: 确保服务器防火墙开放 80/443 端口
4. **HTTPS**: 生产环境强烈建议配置 HTTPS

## 📄 许可证

MIT License