#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/home/ubuntu/bot-general}"
SERVICE_NAME="bot-general"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

cd "$APP_DIR"
mkdir -p invoices auth_info_baileys credentials

npm ci
npm run build

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<SERVICE
[Unit]
Description=Bot General WhatsApp automation
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
ExecStart=${NPM_BIN} start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"
sudo systemctl --no-pager --lines=30 status "${SERVICE_NAME}.service"
