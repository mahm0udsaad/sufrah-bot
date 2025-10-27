# Sufrah Bot - Deployment & Testing Guide

## 📋 Table of Contents
- [Prerequisites](#prerequisites)
- [Local Testing](#local-testing)
- [Production Deployment with PM2](#production-deployment-with-pm2)
- [Nginx Configuration](#nginx-configuration)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements
- **Bun** v1.2.21+ ([Install Bun](https://bun.sh))
- **PostgreSQL** v14+ (for database)
- **Redis** v6+ (for queues and caching)
- **PM2** (for production): `npm install -g pm2`
- **Nginx** (for production reverse proxy)

### Required Environment Variables

Create a `.env` file in the project root:

```bash
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sufrah_bot"

# Redis
REDIS_URL="redis://localhost:6379"
# OR specify individual settings:
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false

# Twilio (Master Account)
TWILIO_MASTER_SID=AC...
TWILIO_MASTER_AUTH=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WEBHOOK_VALIDATE=true

# Content Template SIDs (WhatsApp approved templates)
CONTENT_SID_WELCOME=HX...
CONTENT_SID_ORDER_TYPE=HX...
CONTENT_SID_CATEGORIES=HX...
CONTENT_SID_POST_ITEM_CHOICE=HX...
CONTENT_SID_LOCATION_REQUEST=HX...
CONTENT_SID_QUANTITY=HX...
CONTENT_SID_CART_OPTIONS=HX...
CONTENT_SID_PAYMENT_OPTIONS=HX...
CONTENT_SID_BRANCH_LIST=HX...
CONTENT_SID_RATING_LIST=HX...

# Sufrah API Integration
SUFRAH_API_BASE=https://api.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_api_key_here
SUFRAH_CACHE_TTL_MS=180000

# Security
JWT_SECRET=your_strong_jwt_secret_here
DASHBOARD_PAT=your_dashboard_personal_access_token
BOT_API_TOKEN=your_bot_api_token
BOT_API_KEY=your_bot_api_key
WHATSAPP_SEND_TOKEN=your_whatsapp_send_token

# Optional
DASHBOARD_BASE_URL=https://sufrah-bot.vercel.app
PAYMENT_LINK=https://example.com/pay
SUPPORT_CONTACT=+966-500-000000
```

---

## 🧪 Local Testing

### 1. Install Dependencies

```bash
bun install
```

### 2. Setup Database

```bash
# Generate Prisma client
bunx prisma generate

# Run migrations
bunx prisma migrate dev

# Seed database with test data (optional)
bunx prisma db seed
```

### 3. Start Services Locally

#### Option A: Start All Services (Recommended for Local Dev)

```bash
# Starts API server + all 3 workers
bun run start
```

This starts:
- API server (port 3000)
- Outbound worker (message processing)
- WhatsApp send worker (message delivery)
- Welcome bootstrap worker (onboarding)

#### Option B: Start Services Individually (for debugging)

Open 4 terminal windows:

**Terminal 1 - API Server:**
```bash
bun run dev
# or: bun run --watch index.ts
```

**Terminal 2 - Outbound Worker:**
```bash
bun run worker:dev
# or: bun run --watch src/workers/outboundWorker.ts
```

**Terminal 3 - WhatsApp Send Worker:**
```bash
bun run worker:send:dev
# or: bun run --watch src/workers/whatsappSendWorker.ts
```

**Terminal 4 - Bootstrap Worker:**
```bash
bun run worker:bootstrap:dev
# or: bun run --watch src/workers/welcomeBootstrapWorker.ts
```

### 4. Test the Server

```bash
# Health check
curl http://localhost:3000/health

# Test webhook (example)
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+1234567890&Body=Hello"
```

### 5. Run Tests

```bash
# Run all tests
bun test

# Run specific tests
bun run test:usage
bun run test:queue
bun run test:cache
```

### 6. View Database (Optional)

```bash
bunx prisma studio
# Opens Prisma Studio at http://localhost:5555
```

---

## 🚀 Production Deployment with PM2

### 1. Initial Setup

```bash
# Clone repository (if not already)
cd /path/to/sufrah-bot

# Install dependencies
bun install

# Setup database
bunx prisma generate
bunx prisma migrate deploy

# Optional: Seed production data
bunx prisma db seed
```

### 2. Create PM2 Ecosystem File

Create `ecosystem.config.js` in project root:

```javascript
module.exports = {
  apps: [
    {
      name: 'sufrah-api',
      script: 'bun',
      args: 'run index.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'sufrah-worker-outbound',
      script: 'bun',
      args: 'run src/workers/outboundWorker.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: './logs/worker-outbound-error.log',
      out_file: './logs/worker-outbound-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'sufrah-worker-send',
      script: 'bun',
      args: 'run src/workers/whatsappSendWorker.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      error_file: './logs/worker-send-error.log',
      out_file: './logs/worker-send-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'sufrah-worker-bootstrap',
      script: 'bun',
      args: 'run src/workers/welcomeBootstrapWorker.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      error_file: './logs/worker-bootstrap-error.log',
      out_file: './logs/worker-bootstrap-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
```

### 3. Create Logs Directory

```bash
mkdir -p logs
```

### 4. PM2 Commands

#### Start All Services
```bash
pm2 start ecosystem.config.js
```

#### View Status
```bash
pm2 list
```

#### View Logs
```bash
# All logs
pm2 logs

# Specific service
pm2 logs sufrah-api
pm2 logs sufrah-worker-outbound
pm2 logs sufrah-worker-send
pm2 logs sufrah-worker-bootstrap

# Last 100 lines
pm2 logs sufrah-api --lines 100
```

#### Restart Services
```bash
# Restart all
pm2 restart all

# Restart specific service
pm2 restart sufrah-api

# Restart with updated environment
pm2 restart sufrah-api --update-env
```

#### Stop Services
```bash
# Stop all
pm2 stop all

# Stop specific service
pm2 stop sufrah-api
```

#### Delete Services
```bash
# Delete all
pm2 delete all

# Delete specific service
pm2 delete sufrah-api
```

#### Monitor Services
```bash
pm2 monit
```

### 5. Auto-Start on System Boot

```bash
# Generate startup script
pm2 startup

# Save current PM2 process list
pm2 save

# To disable auto-start
pm2 unstartup
```

### 6. Quick Restart Script (Using Existing)

Use the provided restart script:

```bash
# Make executable
chmod +x scripts/restartPM2.sh

# Run
./scripts/restartPM2.sh
```

Or create a custom one:

```bash
#!/bin/bash
echo "🔄 Restarting Sufrah Bot..."

# Regenerate Prisma client
bunx prisma generate

# Restart PM2 services
pm2 restart ecosystem.config.js --update-env

# Show status
pm2 list

echo "✅ Restart complete!"
```

---

## 🌐 Nginx Configuration

### 1. Basic Nginx Configuration

Create `/etc/nginx/sites-available/sufrah-bot`:

```nginx
# Upstream definitions
upstream sufrah_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name bot.sufrah.sa api.sufrah.sa;
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name bot.sufrah.sa api.sufrah.sa;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/bot.sufrah.sa/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.sufrah.sa/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Logging
    access_log /var/log/nginx/sufrah-bot-access.log;
    error_log /var/log/nginx/sufrah-bot-error.log;

    # Max upload size (for media)
    client_max_body_size 10M;

    # API Endpoints
    location / {
        proxy_pass http://sufrah_api;
        proxy_http_version 1.1;
        
        # Proxy Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffering
        proxy_buffering off;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket Support
    location /ws {
        proxy_pass http://sufrah_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket timeouts (longer)
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
    }

    # Health check endpoint (no buffering)
    location /health {
        proxy_pass http://sufrah_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

### 2. Enable Configuration

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/sufrah-bot /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 3. SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d bot.sufrah.sa -d api.sufrah.sa

# Auto-renewal is set up automatically
# Test renewal
sudo certbot renew --dry-run
```

### 4. Nginx Commands

```bash
# Test configuration
sudo nginx -t

# Start
sudo systemctl start nginx

# Stop
sudo systemctl stop nginx

# Restart
sudo systemctl restart nginx

# Reload (graceful)
sudo systemctl reload nginx

# Status
sudo systemctl status nginx

# View logs
sudo tail -f /var/log/nginx/sufrah-bot-access.log
sudo tail -f /var/log/nginx/sufrah-bot-error.log
```

---

## 🔍 Troubleshooting

### Check Service Status

```bash
# PM2 status
pm2 list
pm2 logs --lines 50

# Check if port 3000 is in use
lsof -i :3000
netstat -tlnp | grep 3000

# Check Redis
redis-cli ping

# Check PostgreSQL
psql -h localhost -U youruser -d sufrah_bot -c "SELECT 1;"
```

### Common Issues

#### 1. Port Already in Use
```bash
# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Or use a different port in .env
PORT=3001
```

#### 2. Database Connection Error
```bash
# Test connection
bunx prisma migrate status

# Regenerate client
bunx prisma generate

# Apply migrations
bunx prisma migrate deploy
```

#### 3. Redis Connection Error
```bash
# Check Redis is running
redis-cli ping

# Check Redis URL in .env
REDIS_URL="redis://localhost:6379"
```

#### 4. PM2 Process Keeps Restarting
```bash
# Check logs for errors
pm2 logs sufrah-api --lines 100

# Check environment
pm2 env sufrah-api
```

### Useful Diagnostic Scripts

```bash
# Check bot status
bun run scripts/diagnoseAllBots.ts

# Test webhook
bun run scripts/testWebhook.ts

# Validate environment
bun run scripts/validateEnv.ts
```

---

## 📊 Monitoring

### PM2 Monitoring

```bash
# Terminal dashboard
pm2 monit

# Web dashboard (optional)
pm2 plus

# Metrics
pm2 describe sufrah-api
```

### Check Application Health

```bash
# Health endpoint
curl https://bot.sufrah.sa/health

# Cache metrics
curl https://bot.sufrah.sa/api/cache/metrics

# Bot status
curl https://bot.sufrah.sa/api/bot/status
```

---

## 🔐 Security Checklist

- [ ] `.env` file has secure secrets
- [ ] `.env` is in `.gitignore`
- [ ] PostgreSQL uses strong password
- [ ] Redis has password authentication (if exposed)
- [ ] Twilio webhook validation enabled
- [ ] JWT_SECRET is strong and unique
- [ ] Nginx SSL certificates are valid
- [ ] Firewall rules are configured
- [ ] Only necessary ports are exposed (443, 80)

---

## 📚 Additional Resources

- [Bun Documentation](https://bun.sh/docs)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp)

---

## 🆘 Need Help?

Check the following documentation files:
- `AGENTS.md` - Repository guidelines
- `docs/START_HERE.md` - Getting started guide
- `docs/IMPLEMENTATION_SUMMARY.md` - Technical overview
- `docs/DASHBOARD_API_COMPLETE_REFERENCE.md` - API reference

---

**Last Updated:** October 2025

