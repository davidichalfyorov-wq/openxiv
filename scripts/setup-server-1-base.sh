#!/usr/bin/env bash
# Phase 1: base hardening + package install.
# Idempotent — safe to re-run.
set -euo pipefail

echo "=== authorized_keys for root (so we can drop password auth later) ==="
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Append local key only if not already present
KEY='ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDFAXpjPgJx6PNNUClVaR5zW5PpeR5+FYTMGS+whZr4PpyNsh3jo3HPNSsngwvAvhQhcyxcorD8om5hSjpRjOnfKV6nqpzlR+lqidQB4T/qCg9ADqUlgFVeMp+0jjSmRLF4Z917sEQVbA9yUPnN5z5gGHWn9zLrVGhywMEoxiYHb7pv1ZeX6CTfxCnIWOnoxT5X0fEn9l4q/26sRaQ3BU3++MWeTUsW0XKuu1xxTlTGBPRZCnZ+RKIgiH5fw1XNt5OOZbPn6AReBpaUYQ1uI6QwNB+407/3/M6mOLxyuoBxesxrEgnk9eKBA79nwqHYfjb6dWIjKH1buQsW98cI6itf2qFMqQbUBw1hC9W3h6QcYgSI4LRYfYOgHrcllk9OpuWsB81BALMQ/fokS10ZtTZnTQSkZkL6CDYPJGN4TlAl74u8nI3A6r0vYmow+v8tQXWFVu34obKEEJ5YAdaScuX2SYSw7iayCtiFpylq+jhohfzVvmEi1jILyG6lTe0bc82qFE4rEJwHmC3q404M8oQ/QAvPOiC0AophCUjhjXDi7TaCuwwSdCOPR7dtbbob4cEqH3T6nUOO/kvRBuRqRerH7aIA5o59o6j3wYo3NklgGLgA1Y3yqLO3bbR+IEM53nAoQ0CKzHA56IXJxqJw0/XguuJhOWfXPNRCzs29h4cXqQ== Russia'
grep -qxF "$KEY" /root/.ssh/authorized_keys || echo "$KEY" >> /root/.ssh/authorized_keys

echo "=== apt update ==="
export DEBIAN_FRONTEND=noninteractive
# Wait for any in-flight apt locks from cloud-init.
while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
      fuser /var/lib/apt/lists/lock >/dev/null 2>&1 ; do
  echo "waiting for apt lock..."
  sleep 3
done

apt-get update -y -o Acquire::Retries=3

echo "=== base packages ==="
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg lsb-release \
  ufw fail2ban htop vim git rsync tar zstd jq \
  unattended-upgrades apt-listchanges \
  postgresql-client-16

echo "=== docker install (official Docker apt repo) ==="
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
docker --version
docker compose version

echo "=== 4 GB swap (Postgres + GROBID safety) ==="
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -qxF '/swapfile none swap sw 0 0' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -qxF 'vm.swappiness=10' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

echo "=== non-root user 'openxiv' with sudo + ssh key ==="
if ! id openxiv >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" openxiv
  usermod -aG sudo,docker openxiv
  echo 'openxiv ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/openxiv-nopasswd
  chmod 440 /etc/sudoers.d/openxiv-nopasswd
fi
mkdir -p /home/openxiv/.ssh
chmod 700 /home/openxiv/.ssh
touch /home/openxiv/.ssh/authorized_keys
chmod 600 /home/openxiv/.ssh/authorized_keys
grep -qxF "$KEY" /home/openxiv/.ssh/authorized_keys || echo "$KEY" >> /home/openxiv/.ssh/authorized_keys
chown -R openxiv:openxiv /home/openxiv/.ssh

echo "=== ufw firewall (22/80/443 only; deny everything else) ==="
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http (caddy / lets-encrypt http-01)'
ufw allow 443/tcp comment 'https (caddy)'
ufw --force enable
ufw status verbose

echo "=== unattended-upgrades (security only) ==="
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

echo "=== summary ==="
echo "  docker: $(docker --version)"
echo "  compose: $(docker compose version --short 2>/dev/null || docker compose version)"
echo "  swap: $(swapon --show=NAME,SIZE | tail -n +2 | tr -s ' ' | head -1)"
echo "  user openxiv exists: $(id openxiv >/dev/null 2>&1 && echo yes || echo NO)"
echo "  ufw status: $(ufw status | head -1)"
echo "OK"
