# ==========================================
# HOYOYO AI客服系统 - Docker 构建文件
# ==========================================

# 使用 Node.js 18 官方镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制应用代码
COPY . .

# 创建数据目录
RUN mkdir -p data

# 暴露端口（Render 会自动设置 PORT 环境变量）
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
