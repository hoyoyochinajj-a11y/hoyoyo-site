# 🚀 Render 免费部署指南

## 快速部署（3分钟上线）

### 步骤1：注册 Render 账号
1. 访问 [render.com](https://render.com)
2. 点击 "Get Started for Free"
3. 用 GitHub/Google/邮箱 注册

### 步骤2：创建 Web Service
1. 登录后点击 "New +" → "Web Service"
2. 选择 "Build and deploy from a Git repository"
3. 连接你的 GitHub 账号，上传本项目代码

或者使用 **Blueprint 一键部署**：
1. 点击 "New +" → "Blueprint"
2. 上传 `render.yaml` 文件

### 步骤3：配置环境变量
在 Render 控制台设置以下环境变量：

| 变量名 | 值 |
|--------|-----|
| `VOLC_API_KEY` | 你的火山引擎 API Key |
| `VOLC_MODEL_ID` | 你的模型 ID |
| `ADMIN_PASSWORD` | 后台管理密码 |

**获取 API Key**：
1. 访问 [火山引擎方舟](https://console.volcengine.com/ark/)
2. 创建应用获取 API Key
3. 创建推理接入点获取模型 ID

### 步骤4：部署
点击 "Deploy"，等待 2-3 分钟，Render 会自动：
- 安装依赖
- 构建项目
- 启动服务
- 分配域名

### 步骤5：访问你的客服系统
部署完成后，Render 会给你一个链接：
```
https://hoyoyo-ai-service-xxx.onrender.com
```

**访问地址**：
- 客服页面：`https://xxx.onrender.com/`
- 人工客服：`https://xxx.onrender.com/human.html`
- 管理后台：`https://xxx.onrender.com/admin.html`

---

## ⚠️ 注意事项

1. **免费版限制**：
   - 15分钟无访问会自动休眠
   - 首次访问需要等待唤醒（约30秒）
   - 每月 750 小时免费额度

2. **数据持久化**：
   - 免费版每次部署会重置数据
   - 如需持久化，需要连接外部数据库（如 MongoDB Atlas 免费版）

3. **自定义域名**：
   - 可以在 Render 设置中添加自己的域名
   - 自动提供 HTTPS

---

## 🔧 替代方案：Railway（也是免费）

如果 Render 不满意，可以试试 Railway：
1. 访问 [railway.app](https://railway.app)
2. 同样免费额度更高
3. 部署方式类似