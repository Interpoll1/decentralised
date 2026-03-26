#!/bin/bash
# Run this on your VPS as root
# Sets up: Node 20, npm, pm2, nginx, deploys both servers

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Interpoll VPS Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Node 20 (replaces v18) ─────────────────────────────────────────────────
echo ""
echo "▶ Installing Node 20 + npm..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

# ── 2. PM2 ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Installing PM2..."
npm install -g pm2
pm2 -v

# ── 3. Nginx ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ Installing Nginx..."
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# ── 4. Create app directories ─────────────────────────────────────────────────
echo ""
echo "▶ Creating app directories..."
mkdir -p /var/www/interpoll/gun-relay
mkdir -p /var/www/interpoll/relay-server
mkdir -p /var/www/interpoll/gun-relay/data
mkdir -p /var/www/interpoll/relay-server/data

# ── 5. Install dependencies ───────────────────────────────────────────────────
echo ""
echo "▶ Installing dependencies for gun-relay..."
cd /var/www/interpoll/gun-relay
cat > package.json << 'EOF'
{
  "name": "gun-relay",
  "version": "1.0.0",
  "type": "module",
  "main": "gun-relay-enhanced.js",
  "dependencies": {
    "gun": "^0.2020.1240",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "mysql2": "^3.6.0"
  }
}
EOF
npm install

echo ""
echo "▶ Installing dependencies for relay-server..."
cd /var/www/interpoll/relay-server
cat > package.json << 'EOF'
{
  "name": "relay-server",
  "version": "1.0.0",
  "type": "module",
  "main": "relay-server-enhanced.js",
  "dependencies": {
    "ws": "^8.14.0",
    "mysql2": "^3.6.0"
  }
}
EOF
npm install

# ── 6. PM2 ecosystem config ───────────────────────────────────────────────────
echo ""
echo "▶ Creating PM2 ecosystem config..."
cat > /var/www/interpoll/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: 'gun-relay',
      script: './gun-relay/gun-relay-enhanced.js',
      cwd: '/var/www/interpoll',
      interpreter: 'node',
      env: {
        PORT: 8765,
        NODE_ENV: 'production',
        // Add your MySQL env vars here or in a .env file
        MYSQL_HOST: process.env.MYSQL_HOST || '',
        MYSQL_USER: process.env.MYSQL_USER || '',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
        MYSQL_DATABASE: process.env.MYSQL_DATABASE || '',
        MYSQL_PORT: process.env.MYSQL_PORT || '3306',
      },
      max_memory_restart: '400M',
      restart_delay: 3000,
      error_file: '/var/log/pm2/gun-relay-error.log',
      out_file: '/var/log/pm2/gun-relay-out.log',
    },
    {
      name: 'relay-server',
      script: './relay-server/relay-server-enhanced.js',
      cwd: '/var/www/interpoll',
      interpreter: 'node',
      env: {
        PORT: 8080,
        NODE_ENV: 'production',
        DOMAIN: 'https://endless.sbs',
        FRONTEND_ORIGIN: 'https://endless.sbs',
        MYSQL_HOST: process.env.MYSQL_HOST || '',
        MYSQL_USER: process.env.MYSQL_USER || '',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || '',
        MYSQL_DATABASE: process.env.MYSQL_DATABASE || '',
        MYSQL_PORT: process.env.MYSQL_PORT || '3306',
        ASSET_JS: '/assets2/index.js',
        ASSET_CSS: '/assets2/index.css',
      },
      max_memory_restart: '400M',
      restart_delay: 3000,
      error_file: '/var/log/pm2/relay-server-error.log',
      out_file: '/var/log/pm2/relay-server-out.log',
    },
  ],
};
EOF

mkdir -p /var/log/pm2

# ── 7. Nginx config ───────────────────────────────────────────────────────────
echo ""
echo "▶ Writing Nginx config..."

# Gun relay — interpoll2.endless.sbs (or keep using interpoll2.onrender.com for now)
cat > /etc/nginx/sites-available/gun-relay << 'EOF'
server {
    listen 80;
    server_name interpoll2.endless.sbs;

    # WebSocket support for Gun
    location /gun {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Relay server — interpoll.endless.sbs
cat > /etc/nginx/sites-available/relay-server << 'EOF'
server {
    listen 80;
    server_name interpoll.endless.sbs;

    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30;
    }
}
EOF

ln -sf /etc/nginx/sites-available/gun-relay   /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/relay-server /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "NEXT STEPS:"
echo "1. Upload your server files:"
echo "   scp gun-relay-enhanced.js root@YOUR_VPS_IP:/var/www/interpoll/gun-relay/"
echo "   scp relay-server-enhanced.js root@YOUR_VPS_IP:/var/www/interpoll/relay-server/"
echo ""
echo "2. Create /var/www/interpoll/.env with your MySQL credentials"
echo ""
echo "3. Start servers:"
echo "   cd /var/www/interpoll && pm2 start ecosystem.config.cjs"
echo "   pm2 save && pm2 startup"
echo ""
echo "4. Add DNS A records pointing to this VPS IP:"
echo "   interpoll.endless.sbs  → $(curl -s ifconfig.me)"
echo "   interpoll2.endless.sbs → $(curl -s ifconfig.me)"
echo ""
echo "5. Get SSL certs:"
echo "   apt install -y certbot python3-certbot-nginx"
echo "   certbot --nginx -d interpoll.endless.sbs -d interpoll2.endless.sbs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"