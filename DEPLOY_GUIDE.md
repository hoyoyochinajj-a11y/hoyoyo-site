# 🚀 HOYOYO AI客服系统 - 完整部署指南

## 方案一：快速上线（推荐新手）

### 步骤1：购买云服务器（5分钟）

推荐平台：
| 平台 | 价格 | 链接 | 推荐理由 |
|------|------|------|----------|
| **阿里云** | ~99元/年 | [立即购买](https://www.aliyun.com/minisite/goods?userCode=yourcode) | 国内访问快，文档全 |
| **腾讯云** | ~99元/年 | [立即购买](https://cloud.tencent.com/act/cps/redirect?redirect=yourcode) | 新手友好，控制台简单 |
| **华为云** | ~99元/年 | [立即购买](https://activity.huaweicloud.com/cps.html?fromacct=yourcode) | 稳定性好 |

**选购配置**：
- 系统：Ubuntu 22.04 LTS
- 配置：1核2G（最低）/ 2核4G（推荐）
- 带宽：3Mbps 以上
- 时长：1年（最划算）

---

### 步骤2：连接服务器（2分钟）

**Windows 用户**：
1. 下载 [PuTTY](https://www.putty.org/) 或 [FinalShell](http://www.hostbuf.com/)
2. 输入服务器 IP、用户名(root)、密码连接

**Mac/Linux 用户**：
```bash
ssh root@你的服务器IP
```

---

### 步骤3：一键部署（5分钟）

连接服务器后，依次执行：

```bash
# 1. 更新系统
apt update && apt upgrade -y

# 2. 安装必要工具
apt install -y wget unzip curl

# 3. 下载部署包
wget https://你的文件地址/hoyoyo-ai-service.zip

# 4. 解压
cd /root
unzip hoyoyo-ai-service.zip
cd hoyoyo-ai-service

# 5. 运行部署脚本
chmod +x deploy.sh
sudo bash deploy.sh
```

---

### 步骤4：配置 API Key（3分钟）

```bash
# 编辑配置文件
nano /opt/hoyoyo-ai/.env
```

填入以下内容：
```env
PORT=3000
VOLC_API_KEY=你的火山引擎API密钥
VOLC_MODEL_ID=你的模型ID
ADMIN_PASSWORD=你的后台密码
NODE_ENV=production
```

**获取 API Key**：
1. 访问 [火山引擎方舟](https://console.volcengine.com/ark/)
2. 创建应用 → 获取 API Key
3. 创建推理接入点 → 获取模型 ID
4. 充值（新用户有免费额度）

---

### 步骤5：启动服务（1分钟）

```bash
# 启动
pm2 start hoyoyo-ai

# 查看状态
pm2 status

# 查看日志
pm2 logs
```

---

### 步骤6：访问系统 ✅

在浏览器打开：
- 客服页面：`http://你的服务器IP/`
- 管理后台：`http://你的服务器IP/admin.html`

---

## 方案二：使用宝塔面板（可视化操作）

适合不熟悉命令行的用户：

```bash
# 安装宝塔面板
wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0.sh && sudo bash install.sh ed8484bec
```

安装后按提示访问面板，然后：
1. 安装 Nginx + Node.js 环境
2. 上传代码到网站目录
3. 配置反向代理到 3000 端口
4. 设置 SSL 证书

---

## 方案三：Docker 部署（最简单）

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash

# 创建目录
mkdir -p /opt/hoyoyo-ai && cd /opt/hoyoyo-ai

# 下载代码并解压
wget https://你的文件地址/hoyoyo-ai-service.zip
unzip hoyoyo-ai-service.zip
mv hoyoyo-ai-service/* . && rm -rf hoyoyo-ai-service

# 创建 .env 文件
nano .env

# 构建并运行
docker build -t hoyoyo-ai .
docker run -d \
  --name hoyoyo-ai \
  --restart always \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  hoyoyo-ai
```

---

## 🔒 配置 HTTPS（推荐）

```bash
# 安装 certbot
apt install certbot python3-certbot-nginx -y

# 申请证书（替换为你的域名）
certbot --nginx -d your-domain.com

# 自动续期测试
certbot renew --dry-run
```

---

## 🛠️ 常见问题

### 1. 端口被占用
```bash
# 查看 3000 端口占用
lsof -i:3000

# 杀掉进程
kill -9 进程ID
```

### 2. 防火墙问题
```bash
# 开放端口
ufw allow 80
ufw allow 443
ufw allow 3000
```

### 3. PM2 启动失败
```bash
# 查看详细错误
pm2 logs hoyoyo-ai

# 重新加载
pm2 reload hoyoyo-ai
```

### 4. 内存不足
```bash
# 添加 swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 📞 需要帮助？

如果你遇到任何问题，可以：
1. 查看日志：`pm2 logs hoyoyo-ai`
2. 检查配置：`cat /opt/hoyoyo-ai/.env`
3. 重启服务：`pm2 restart hoyoyo-ai`

---

## 💡 替代方案：使用 Vercel/Render（免费）

如果不想买服务器，可以使用免费平台：

### Render（推荐）
1. 注册 [render.com](https://render.com)
2. 新建 Web Service
3. 连接 GitHub 仓库或上传代码
4. 设置环境变量
5. 自动部署

### Vercel
适合前端，但 Node 服务需要额外配置。

---

**预计总耗时**：15-30 分钟
**预计费用**：云服务器 ~99元/年 + API 调用费 ~0.1元/千次