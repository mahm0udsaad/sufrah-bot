#!/bin/bash

# Sufrah Bot Setup Script
# This script helps you set up the bot for the first time

set -e  # Exit on error

echo "🚀 Sufrah Bot Setup Script"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running with proper permissions
if [ "$EUID" -eq 0 ]; then 
   echo -e "${RED}❌ Please do not run this script as root${NC}"
   exit 1
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo "📋 Step 1: Checking dependencies..."
echo ""

# Check Bun
if command_exists bun; then
    echo -e "${GREEN}✅ Bun is installed:${NC} $(bun --version)"
else
    echo -e "${RED}❌ Bun is not installed${NC}"
    echo "   Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Check PostgreSQL
if command_exists psql; then
    echo -e "${GREEN}✅ PostgreSQL is installed:${NC} $(psql --version | head -n 1)"
else
    echo -e "${YELLOW}⚠️  PostgreSQL client not found${NC}"
    echo "   Install: sudo apt-get install postgresql-client"
fi

# Check Redis
if command_exists redis-cli; then
    echo -e "${GREEN}✅ Redis CLI is installed${NC}"
    if redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Redis server is running${NC}"
    else
        echo -e "${YELLOW}⚠️  Redis server is not running${NC}"
        echo "   Start: sudo systemctl start redis"
    fi
else
    echo -e "${YELLOW}⚠️  Redis is not installed${NC}"
    echo "   Install: sudo apt-get install redis-server"
fi

# Check PM2
if command_exists pm2; then
    echo -e "${GREEN}✅ PM2 is installed${NC}"
else
    echo -e "${YELLOW}⚠️  PM2 is not installed (required for production)${NC}"
    echo "   Install: npm install -g pm2"
fi

# Check Nginx
if command_exists nginx; then
    echo -e "${GREEN}✅ Nginx is installed${NC}"
else
    echo -e "${YELLOW}⚠️  Nginx is not installed (required for production)${NC}"
    echo "   Install: sudo apt-get install nginx"
fi

echo ""
read -p "Continue with setup? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
fi

echo ""
echo "📦 Step 2: Installing dependencies..."
bun install

echo ""
echo "🗂️  Step 3: Creating necessary directories..."
mkdir -p logs
mkdir -p prisma/migrations
echo -e "${GREEN}✅ Directories created${NC}"

echo ""
echo "📝 Step 4: Checking environment configuration..."
if [ -f .env ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
else
    echo -e "${YELLOW}⚠️  .env file not found${NC}"
    read -p "Create .env file from template? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cat > .env << 'EOF'
# Server Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sufrah_bot"

# Redis
REDIS_URL="redis://localhost:6379"
# OR specify individual settings:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_TLS=false

# Twilio Configuration
TWILIO_MASTER_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_MASTER_AUTH=your_auth_token_here
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WEBHOOK_VALIDATE=true

# WhatsApp Content Template SIDs
CONTENT_SID_WELCOME=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_ORDER_TYPE=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_CATEGORIES=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_POST_ITEM_CHOICE=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_LOCATION_REQUEST=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_QUANTITY=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_CART_OPTIONS=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_PAYMENT_OPTIONS=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_BRANCH_LIST=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTENT_SID_RATING_LIST=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Sufrah API Integration
SUFRAH_API_BASE=https://api.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_api_key_here
SUFRAH_CACHE_TTL_MS=180000

# Security Tokens
JWT_SECRET=change_this_to_a_strong_random_secret
DASHBOARD_PAT=your_personal_access_token
BOT_API_TOKEN=your_bot_api_token
BOT_API_KEY=your_bot_api_key
WHATSAPP_SEND_TOKEN=your_whatsapp_send_token

# Optional Configuration
DASHBOARD_BASE_URL=https://sufrah-bot.vercel.app
PAYMENT_LINK=https://example.com/pay
SUPPORT_CONTACT=+966-500-000000
EOF
        echo -e "${GREEN}✅ .env file created${NC}"
        echo -e "${YELLOW}⚠️  IMPORTANT: Edit .env file with your actual credentials!${NC}"
    fi
fi

echo ""
echo "🔐 Step 5: Checking Prisma setup..."
if [ -f prisma/schema.prisma ]; then
    echo -e "${GREEN}✅ Prisma schema exists${NC}"
    
    read -p "Generate Prisma client? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        bunx prisma generate
        echo -e "${GREEN}✅ Prisma client generated${NC}"
    fi
    
    read -p "Run database migrations? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        bunx prisma migrate deploy
        echo -e "${GREEN}✅ Migrations applied${NC}"
    fi
    
    read -p "Seed database with test data? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        bunx prisma db seed
        echo -e "${GREEN}✅ Database seeded${NC}"
    fi
else
    echo -e "${RED}❌ Prisma schema not found${NC}"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Next Steps:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Edit .env file with your credentials:"
echo "   nano .env"
echo ""
echo "2. For LOCAL development:"
echo "   bun run start"
echo ""
echo "3. For PRODUCTION with PM2:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "4. Test the server:"
echo "   curl http://localhost:3000/health"
echo ""
echo "5. View logs:"
echo "   pm2 logs"
echo ""
echo "6. For full documentation:"
echo "   cat QUICK_START.md"
echo "   cat DEPLOYMENT_GUIDE.md"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

