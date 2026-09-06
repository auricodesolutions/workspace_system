# Hostinger VPS deployment

Replace every `YOUR_DOMAIN` with the real domain or subdomain, for example `system.example.com`.

## 1. Point the domain to the VPS

In Hostinger hPanel, open the domain DNS Zone and add or update an A record:

- Type: `A`
- Name: `system` for `system.example.com`, or `@` for the root domain
- Points to: the Hostinger VPS public IPv4 address
- TTL: default

Wait until the domain resolves to the VPS before enabling HTTPS.

## 2. Prepare Ubuntu

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

Install Node.js 22 LTS before installing the project dependencies.

## 3. Configure and build

Upload or clone the project into `/var/www/aurilink-system`, then run:

```bash
cd /var/www/aurilink-system
cp .env.example .env
nano .env
npm ci
npm run generate -w @aurilink/database
npm run build
```

At minimum, set these real values in `.env`:

```dotenv
DATABASE_URL="mysql://USER:PASSWORD@MYSQL_HOST:3306/DATABASE"
JWT_SECRET="GENERATE_A_LONG_RANDOM_SECRET"
WEB_URL="https://YOUR_DOMAIN"
NEXT_PUBLIC_API_URL="https://YOUR_DOMAIN/api/v1"
```

Also configure the SMTP values from `.env.example` if forgotten-password emails should work.

Important: `NEXT_PUBLIC_API_URL` is embedded during the web build. Set it before `npm run build`.

## 4. Start both services with PM2

```bash
cd /var/www/aurilink-system
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the additional command printed by `pm2 startup`, then verify:

```bash
pm2 status
pm2 logs
```

## 5. Enable Nginx

Edit `deploy/nginx/aurilink.conf` and replace `YOUR_DOMAIN`, then run:

```bash
sudo cp deploy/nginx/aurilink.conf /etc/nginx/sites-available/aurilink
sudo ln -s /etc/nginx/sites-available/aurilink /etc/nginx/sites-enabled/aurilink
sudo nginx -t
sudo systemctl reload nginx
```

Visit `http://YOUR_DOMAIN` and confirm the login page works before requesting SSL.

## 6. Enable HTTPS

For a domain without `www`:

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

If both root and `www` DNS records exist:

```bash
sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
```

Verify automatic renewal:

```bash
sudo certbot renew --dry-run
```

## 7. Configure the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Do not publicly open ports 3100, 4000, or 3306. Nginx accesses the applications locally, and MySQL should allow only trusted connections.

## Updating the application later

```bash
cd /var/www/aurilink-system
npm ci
npm run generate -w @aurilink/database
npm run build
pm2 restart ecosystem.config.cjs --update-env
```
