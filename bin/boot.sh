#!/usr/bin/env bash
set -euo pipefail

# Où on stocke le gros SF2 (idéalement sur un Render Disk monté sous /data)
SF2_PATH="${SF2_PATH:-/data/Yamaha_PSR.sf2}"
SF2_URL="${SF2_URL:-}"          # URL de téléchargement (Release GitHub par ex.)
SF2_SHA256="${SF2_SHA256:-}"    # (optionnel) hash attendu pour vérifier l’intégrité
GITHUB_TOKEN_HEADER=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  GITHUB_TOKEN_HEADER="-H Authorization: token ${GITHUB_TOKEN}"
fi

mkdir -p "$(dirname "$SF2_PATH")"

if [ ! -s "$SF2_PATH" ]; then
  if [ -z "$SF2_URL" ]; then
    echo "❌ SF2 absent et SF2_URL non fourni. Renseigne SF2_URL dans les env Render."
    exit 11
  fi
  echo "⬇️ Téléchargement SF2 depuis: $SF2_URL"
  tmp="${SF2_PATH}.part"
  # --fail pour échouer si 404/403 ; -L pour suivre les redirections (GitHub Releases)
  curl -L --fail $GITHUB_TOKEN_HEADER -o "$tmp" "$SF2_URL"
  if [ -n "$SF2_SHA256" ]; then
    echo "🔐 Vérification SHA256…"
    echo "$SF2_SHA256  $tmp" | sha256sum -c - || { echo "❌ SHA256 invalide"; exit 13; }
  fi
  mv "$tmp" "$SF2_PATH"
fi

echo "✅ SF2 prêt:"
ls -lh "$SF2_PATH"

# Neutraliser les includes système et forcer NOTRE SF2 par défaut si quelqu'un lance timidity "tout nu"
mkdir -p /etc/timidity
printf 'dir /nonexistent\n' > /etc/timidity/timidity.cfg

# Construire une cfg minimale pointant sur TON SF2, et l’exporter
echo "soundfont $SF2_PATH" > /app/timidity_forced.cfg
export TIMIDITY_CFG=/app/timidity_forced.cfg

# Petit smoke test (affiche les infos et confirme que timidity voit le SF2)
timidity -c /app/timidity_forced.cfg -v | tail -n +50 || true

# Lancer ton app (CMD du Dockerfile)
exec "$@"
