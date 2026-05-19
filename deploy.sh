#!/bin/bash
# ==========================================
# HOYOYO AI客服系统 - 云服务器一键部署脚本
# 支持: Ubuntu / CentOS / Debian
# ==========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检测系统类型
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    else
        print_error "无法检测操作系统类型"
        exit 1
    fi
    print_info "检测到系统: $OS $VERSION"
}

# 安装 Node.js
install_nodejs() {
    print_info "正在安装 Node.js 18..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 16 ]; then
            print_success "Node.js 已安装: $(node --version)"
            return
        fi
    fi
    
    case $OS in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        centos|rhel|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
            sudo yum install -y nodejs
            ;;
        *)
            print_error "不支持的操作系统: $OS"
            exit 1
            ;;
    esac
    
    print_success "Node.js 安装完成: $(node --version)"
}

# 安装 PM2
install_pm2() {
    print_info "正在安装 PM2 进程管理器..."
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
        print_success "PM2 安装完成"
    else
        print_success "PM2 已安装"
    fi
}

# 安装 Nginx
install_nginx() {
    print_info "正在安装 Nginx..."
    
    if command -v nginx &> /dev/null; then
        print_success "Nginx 已安装"
        return
    fi
    
    case $OS in
        ubuntu|debian)
            sudo apt-get update
            sudo apt-get install -y nginx
            ;;
        centos|rhel|fedora)
            sudo yum install -y epel-release
            sudo yum install -y nginx
            sudo systemctl enable nginx
            ;;
    esac
    
    print_success "Nginx 安装完成"
}

# 配置 Nginx
configure_nginx() {
    print_info "正在配置 Nginx..."
    
    # 获取服务器 IP
    SERVER_IP=$(curl -s ifconfig.me || echo "your-server-ip")
    
    sudo tee /etc/nginx/sites-available/hoyoyo-ai > /dev/null <<EOF
server {
    listen 80;
    server_name $SERVER_IP;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    # 启用站点
    if [ -d /etc/nginx/sites-enabled ]; then
        sudo ln -sf /etc/nginx/sites-available/hoyoyo-ai /etc/nginx/sites-enabled/
        sudo rm -f /etc/nginx/sites-enabled/default
    else
        # CentOS 路径
        sudo cp /etc/nginx/sites-available/hoyoyo-ai /etc/nginx/conf.d/hoyoyo-ai.conf
    fi
    
    # 测试配置
    sudo nginx -t
    sudo systemctl restart nginx
    
    print_success "Nginx 配置完成"
}

# 配置防火墙
configure_firewall() {
    print_info "正在配置防火墙..."
    
    if command -v ufw &> /dev/null; then
        sudo ufw allow 80/tcp
        sudo ufw allow 443/tcp
        sudo ufw allow 22/tcp
        sudo ufw --force enable
        print_success "UFW 防火墙配置完成"
    elif command -v firewall-cmd &> /dev/null; then
        sudo firewall-cmd --permanent --add-service=http
        sudo firewall-cmd --permanent --add-service=https
        sudo firewall-cmd --reload
        print_success "FirewallD 配置完成"
    else
        print_warning "未检测到防火墙，请手动配置"
    fi
}

# 创建应用目录
setup_app() {
    print_info "正在设置应用..."
    
    APP_DIR="/opt/hoyoyo-ai"
    sudo mkdir -p $APP_DIR
    sudo mkdir -p $APP_DIR/data
    
    # 如果当前目录有代码，复制过去
    if [ -f "server.js" ]; then
        sudo cp -r . $APP_DIR/
        print_info "已复制当前代码到 $APP_DIR"
    else
        print_warning "未在当前目录找到 server.js，请手动上传代码到 $APP_DIR"
    fi
    
    # 设置权限
    sudo chown -R $USER:$USER $APP_DIR
    
    print_success "应用目录创建完成: $APP_DIR"
}

# 安装依赖
install_dependencies() {
    print_info "正在安装 Node.js 依赖..."
    
    cd /opt/hoyoyo-ai
    npm install --production
    
    print_success "依赖安装完成"
}

# 创建环境变量文件
create_env_file() {
    print_info "正在创建环境变量配置文件..."
    
    ENV_FILE="/opt/hoyoyo-ai/.env"
    
    if [ -f "$ENV_FILE" ]; then
        print_warning ".env 文件已存在，跳过创建"
        return
    fi
    
    # 生成随机管理员密码
    RANDOM_PASSWORD=$(openssl rand -base64 12 2>/dev/null || date +%s | sha256sum | base64 | head -c 16)
    
    cat > $ENV_FILE <<EOF
# ==========================================
# HOYOYO AI客服系统 - 环境变量配置
# ==========================================

# 服务器端口
PORT=3000

# ==========================================
# 豆包/火山引擎 API 配置 (必填)
# ==========================================
# 请替换为你的实际 API Key
VOLC_API_KEY=your_volc_api_key_here

# 请替换为你的实际模型 ID
VOLC_MODEL_ID=your_model_id_here

# ==========================================
# 管理员密码 (必填)
# ==========================================
ADMIN_PASSWORD=$RANDOM_PASSWORD

# ==========================================
# 可选配置
# ==========================================
NODE_ENV=production
EOF

    print_success "环境变量文件创建完成"
    print_warning "请编辑 $ENV_FILE 文件，填入你的 VOLC_API_KEY 和 VOLC_MODEL_ID"
    print_info "初始管理员密码: $RANDOM_PASSWORD"
}

# 创建 PM2 配置文件
create_pm2_config() {
    print_info "正在创建 PM2 配置文件..."
    
    sudo tee /opt/hoyoyo-ai/ecosystem.config.js > /dev/null <<EOF
module.exports = {
  apps: [{
    name: 'hoyoyo-ai',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
EOF

    sudo mkdir -p /opt/hoyoyo-ai/logs
    print_success "PM2 配置文件创建完成"
}

# 创建启动脚本
create_startup_script() {
    print_info "正在创建系统服务..."
    
    sudo tee /etc/systemd/system/hoyoyo-ai.service > /dev/null <<EOF
[Unit]
Description=HOYOYO AI Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hoyoyo-ai
ExecStart=/usr/bin/pm2 start ecosystem.config.js --env production
ExecReload=/usr/bin/pm2 reload hoyoyo-ai
ExecStop=/usr/bin/pm2 stop hoyoyo-ai
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable hoyoyo-ai
    
    print_success "系统服务创建完成"
}

# 显示完成信息
show_completion_info() {
    SERVER_IP=$(curl -s ifconfig.me || echo "your-server-ip")
    
    echo ""
    echo "=========================================="
    echo -e "${GREEN}🎉 HOYOYO AI客服系统部署完成！${NC}"
    echo "=========================================="
    echo ""
    echo "📋 访问地址:"
    echo "   - 客服页面: http://$SERVER_IP/"
    echo "   - 人工客服: http://$SERVER_IP/human.html"
    echo "   - 管理后台: http://$SERVER_IP/admin.html"
    echo ""
    echo "📁 重要文件路径:"
    echo "   - 应用目录: /opt/hoyoyo-ai"
    echo "   - 环境变量: /opt/hoyoyo-ai/.env"
    echo "   - 数据文件: /opt/hoyoyo-ai/data/"
    echo "   - 日志文件: /opt/hoyoyo-ai/logs/"
    echo ""
    echo "🔧 常用命令:"
    echo "   - 启动服务: pm2 start hoyoyo-ai"
    echo "   - 停止服务: pm2 stop hoyoyo-ai"
    echo "   - 重启服务: pm2 restart hoyoyo-ai"
    echo "   - 查看日志: pm2 logs hoyoyo-ai"
    echo "   - 查看状态: pm2 status"
    echo ""
    echo -e "${YELLOW}⚠️  重要提醒:${NC}"
    echo "   1. 请务必编辑 /opt/hoyoyo-ai/.env 文件，填入 VOLC_API_KEY 和 VOLC_MODEL_ID"
    echo "   2. 建议修改默认的管理员密码"
    echo "   3. 生产环境建议配置 HTTPS (使用 certbot 或 CDN)"
    echo ""
    echo "=========================================="
}

# 主函数
main() {
    echo "=========================================="
    echo "  HOYOYO AI客服系统 - 一键部署脚本"
    echo "=========================================="
    echo ""
    
    # 检查是否为 root 用户
    if [ "$EUID" -ne 0 ]; then 
        print_error "请使用 sudo 运行此脚本"
        exit 1
    fi
    
    detect_os
    install_nodejs
    install_pm2
    install_nginx
    configure_nginx
    configure_firewall
    setup_app
    install_dependencies
    create_env_file
    create_pm2_config
    create_startup_script
    
    show_completion_info
}

# 运行主函数
main