# Quick Start Guide - Sufrah Bot

## 🚀 Quick Commands Reference

### Local Development

```bash
# Install dependencies
bun install

# Setup database
bunx prisma generate
bunx prisma migrate dev
bunx prisma db seed

# Start all services (API + Workers)
bun run start

# OR start individually for debugging
bun run dev                    # API server with hot reload
bun run worker:dev             # Outbound worker
bun run worker:send:dev        # Send worker
bun run worker:bootstrap:dev   # Bootstrap worker

# Run tests
bun test

# Database admin UI
bunx prisma studio
```

### Production with PM2

```bash
# First time setup
bun install
bunx prisma generate
bunx prisma migrate deploy
mkdir -p logs

# Start all services
pm2 start ecosystem.config.js

# Or start individually
pm2 start ecosystem.config.js --only sufrah-api
pm2 start ecosystem.config.js --only sufrah-worker-outbound
pm2 start ecosystem.config.js --only sufrah-worker-send
pm2 start ecosystem.config.js --only sufrah-worker-bootstrap

# View status
pm2 list

# View logs
pm2 logs                           # All services
pm2 logs sufrah-api --lines 100   # Specific service

# Restart
pm2 restart all
pm2 restart sufrah-api

# Stop
pm2 stop all
pm2 delete all

# Auto-start on boot
pm2 startup
pm2 save

# Quick restart script (regenerates Prisma + restarts)
./scripts/restartPM2.sh
```

### Nginx

```bash
# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx

# Restart
sudo systemctl restart nginx

# View logs
sudo tail -f /var/log/nginx/sufrah-bot-access.log
sudo tail -f /var/log/nginx/sufrah-bot-error.log
```

### Testing

```bash
# Health check
curl http://localhost:3000/health
curl https://bot.sufrah.sa/health

# Cache metrics
curl http://localhost:3000/api/cache/metrics

# Test webhook locally
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+1234567890&Body=Hello"
```

### Database

```bash
# Generate Prisma client after schema changes
bunx prisma generate

# Create migration
bunx prisma migrate dev --name migration_name

# Apply migrations (production)
bunx prisma migrate deploy

# Seed database
bunx prisma db seed

# Open Prisma Studio
bunx prisma studio

# Push schema without migration
bunx prisma db push
```

### Diagnostics

```bash
# Check all bots
bun run scripts/diagnoseAllBots.ts

# Test webhook
bun run scripts/testWebhook.ts

# Validate environment
bun run scripts/validateEnv.ts

# Check specific bot
bun run scripts/checkAndFixBot.ts
```

---

## 📁 Required Files

### `.env` (Create this file)

```bash
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sufrah_bot"

# Redis
REDIS_URL="redis://localhost:6379"

# Twilio
TWILIO_MASTER_SID=AC...
TWILIO_MASTER_AUTH=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Content SIDs (WhatsApp templates)
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

# Sufrah API
SUFRAH_API_BASE=https://api.sufrah.sa/api/v1/external
SUFRAH_API_KEY=your_key

# Security
JWT_SECRET=your_strong_secret
DASHBOARD_PAT=your_pat
BOT_API_TOKEN=your_token
BOT_API_KEY=your_key
WHATSAPP_SEND_TOKEN=your_token
```

---

## 🏗️ Project Structure

```
sufrah-bot/
├── index.ts                    # Main API server
├── ecosystem.config.js         # PM2 configuration
├── .env                        # Environment variables (create this)
├── src/
│   ├── config.ts              # Configuration
│   ├── workers/               # Background workers
│   │   ├── outboundWorker.ts
│   │   ├── whatsappSendWorker.ts
│   │   └── welcomeBootstrapWorker.ts
│   ├── server/routes/         # API routes
│   ├── workflows/             # Business logic
│   ├── state/                 # State management
│   └── services/              # External services
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── migrations/            # Database migrations
│   └── seed.ts                # Seed data
└── scripts/                   # Utility scripts
```

---

## 🔥 Common Tasks

### Deploy Code Update
```bash
git pull
bun install
bunx prisma generate
bunx prisma migrate deploy
pm2 restart all
```

### Update Database Schema
```bash
# Edit prisma/schema.prisma
bunx prisma migrate dev --name your_migration
bunx prisma generate
pm2 restart all
```

### Add New Environment Variable
```bash
# 1. Add to .env
echo "NEW_VAR=value" >> .env

# 2. Add to src/config.ts
export const NEW_VAR = process.env.NEW_VAR || 'default';

# 3. Restart services
pm2 restart all --update-env
```

### Check Logs for Errors
```bash
# PM2 logs
pm2 logs --lines 100 --err

# Nginx logs
sudo tail -100 /var/log/nginx/sufrah-bot-error.log

# Application logs
tail -100 logs/api-error.log
```

### Clear Redis Cache
```bash
redis-cli FLUSHDB
pm2 restart all
```

---

## 🐛 Troubleshooting Quick Fixes

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### PM2 Process Won't Start
```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 logs
```

### Database Connection Error
```bash
# Check database is running
pg_isready

# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Regenerate Prisma
bunx prisma generate
```

### Redis Connection Error
```bash
# Check Redis
redis-cli ping

# Restart Redis
sudo systemctl restart redis
```

### Prisma Client Out of Sync
```bash
bunx prisma generate
pm2 restart all
```

---

## 📊 Monitoring

```bash
# PM2 dashboard
pm2 monit

# Process status
pm2 list

# Detailed info
pm2 describe sufrah-api

# Application health
curl http://localhost:3000/health | jq
```

---

## 🔗 Useful URLs

- **Local API:** http://localhost:3000
- **Health:** http://localhost:3000/health
- **Prisma Studio:** http://localhost:5555 (after running `bunx prisma studio`)
- **PM2 Logs:** http://localhost:9615 (if PM2 web dashboard installed)

---

For detailed documentation, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

