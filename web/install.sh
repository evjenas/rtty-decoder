#!/bin/bash
# Установка RTTY-декодера на Ubuntu 24.04 (nginx + бесплатный HTTPS от Let's Encrypt)
# Запуск:  sudo bash install.sh [домен] [email]
# Без домена будет использован адрес вида 1-2-3-4.sslip.io (по IP сервера)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="$1"; EMAIL="$2"
if [ -z "$DOMAIN" ]; then
  IP=$(curl -4 -s https://api.ipify.org)
  DOMAIN="${IP//./-}.sslip.io"
fi
echo ">>> Домен: $DOMAIN"

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

mkdir -p /var/www/rtty
cp "$DIR/index.html" /var/www/rtty/index.html
chown -R www-data:www-data /var/www/rtty

cat > /etc/nginx/sites-available/rtty <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root /var/www/rtty;
    index index.html;
    add_header Permissions-Policy "microphone=(self)" always;
    location / { try_files \$uri \$uri/ =404; }
}
NGX
ln -sf /etc/nginx/sites-available/rtty /etc/nginx/sites-enabled/rtty
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 'Nginx Full'; fi

if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo
echo "=========================================="
echo " Готово! Откройте на телефоне:"
echo "   https://$DOMAIN"
echo "=========================================="
