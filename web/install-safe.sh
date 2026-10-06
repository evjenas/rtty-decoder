#!/bin/bash
# Безопасная установка RTTY-декодера на сервер, где уже работает nginx.
# Ничего не удаляет, чужие конфиги не меняет, делает резервную копию /etc/nginx.
# Запуск:  sudo bash install-safe.sh [домен] [email]
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DOMAIN="$1"; EMAIL="$2"
SITE=/etc/nginx/sites-available/rtty

fail(){ echo; echo "!!! $1"; echo "!!! Установка остановлена, на сервере ничего не изменено."; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите через sudo"
[ -f "$DIR/index.html" ] || fail "Рядом со скриптом нет index.html"

if [ -z "$DOMAIN" ]; then
  IP=$(curl -4 -s https://api.ipify.org) || fail "Не удалось узнать IP сервера"
  DOMAIN="${IP//./-}.sslip.io"
fi
echo ">>> Домен для сайта: $DOMAIN"

# 1. nginx должен быть установлен в системе (не в Docker)
command -v nginx >/dev/null || fail "Системный nginx не найден. Возможно, nginx работает в Docker — напишите, сделаем вариант для него."
systemctl is-active --quiet nginx || fail "Служба nginx не запущена через systemd (возможно, nginx в Docker)."
[ -d /etc/nginx/sites-enabled ] || fail "Нет папки /etc/nginx/sites-enabled — нестандартная настройка nginx."

# 2. Текущий конфиг должен быть рабочим ещё до наших изменений
nginx -t 2>/dev/null || fail "Текущая конфигурация nginx уже с ошибкой (nginx -t). Сначала исправьте её."

# 3. Домен не должен быть занят другим сайтом
if grep -rqs "server_name[^;]*\b$DOMAIN\b" /etc/nginx --exclude=rtty; then
  fail "Домен $DOMAIN уже используется в другом конфиге nginx."
fi

# 4. Резервная копия
BK=/root/nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz
tar czf "$BK" /etc/nginx 2>/dev/null
echo ">>> Резервная копия nginx: $BK"

# 5. Файлы сайта
mkdir -p /var/www/rtty
cp "$DIR/index.html" /var/www/rtty/index.html
chown -R www-data:www-data /var/www/rtty 2>/dev/null || true

# 6. Отдельный конфиг только для этого домена
cat > "$SITE" <<NGX
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
ln -sf "$SITE" /etc/nginx/sites-enabled/rtty

if ! nginx -t; then
  rm -f /etc/nginx/sites-enabled/rtty "$SITE"
  fail "Новый конфиг не прошёл проверку — он удалён, nginx не перезагружался."
fi
systemctl reload nginx     # reload, а не restart — работающие сервисы не прерываются
echo ">>> Сайт добавлен в nginx"

# 7. HTTPS-сертификат только для этого домена
if ! command -v certbot >/dev/null; then
  apt-get update && apt-get install -y certbot python3-certbot-nginx
fi
CB="certbot --nginx -d $DOMAIN --non-interactive --agree-tos --redirect"
if [ -n "$EMAIL" ]; then $CB -m "$EMAIL"; else $CB --register-unsafely-without-email; fi || {
  echo "!!! Сертификат не получен. Сайт уже работает по http://$DOMAIN, но микрофону нужен HTTPS."
  echo "!!! Проверьте, что порты 80 и 443 открыты, и запустите скрипт ещё раз."
  exit 1; }

echo
echo "=========================================="
echo " Готово! Откройте на телефоне:"
echo "   https://$DOMAIN"
echo " Удалить сайт:  rm /etc/nginx/sites-enabled/rtty && systemctl reload nginx"
echo "=========================================="
