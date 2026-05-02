# onspot - VM Deployment Guide

## Prerequisites
- Ubuntu/Debian VM with a public IP
- Domain with an A record pointing to the VM IP
- Ports 80, 443, 22 open in firewall

---

## 1. Point your domain

You already have a VM at `52.172.129.58` running `auth.sudohq.me`. Just add another A record on the same IP:

```
Type: A
Name: onspot
Value: 52.172.129.58
TTL: 300
```

This maps `onspot.sudohq.me` to the same VM. Check propagation with `dig onspot.sudohq.me`.

---

## 2. Install dependencies on VM

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Docker + Docker Compose (for Kafka)
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out and back in after this

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## 3. Clone and set up the app

```bash
git clone https://github.com/YOUR_USERNAME/onspot.git
cd onspot
npm install
cp .env.example .env   # or create .env manually
```

`.env` contents:
```
PORT=8000
AUTH_API=https://auth.sudohq.me
AUTH_CLIENT_ID=your_client_id
AUTH_CLIENT_SECRET=your_client_secret
```

---

## 4. Start Kafka

```bash
docker compose up -d
# wait ~5 seconds for Kafka to be ready
node kafka-admin.js   # creates the location-updates topic
```

---

## 5. Run the app with PM2

```bash
sudo npm install -g pm2
pm2 start index.js --name onspot --env production
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

---

## 6. Nginx config

Create `/etc/nginx/sites-available/onspot`:

```nginx
server {
    listen 80;
    server_name onspot.sudohq.me;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/onspot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. SSL with Certbot

```bash
sudo certbot --nginx -d onspot.sudohq.me
```

Certbot will auto-edit the nginx config to add HTTPS and set up auto-renewal.

Test renewal:
```bash
sudo certbot renew --dry-run
```

---

## 8. Request SudoAuth credentials

Once the site is live at `https://onspot.sudohq.me`, request credentials from SudoAuth with:
- App name: onspot
- Redirect URI: `https://onspot.sudohq.me/auth/callback`

Add the returned `clientId` and `clientSecret` to `.env`, then `pm2 restart onspot`.

---

## Useful commands

```bash
pm2 logs onspot          # view logs
pm2 restart onspot       # restart after .env changes
docker compose ps           # check Kafka status
sudo nginx -t               # test nginx config
sudo systemctl reload nginx # apply nginx changes
```
