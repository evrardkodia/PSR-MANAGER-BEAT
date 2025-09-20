#!/usr/bin/env bash
set -euo pipefail

# Chemins configurables par variables d'env (Render → "Environment")
: "${SF2_PATH:=/app/soundfonts/Yamaha_PSR.sf2}"
: "${SF2_URL:=}"          # à définir dans Render (cf. plus bas)
: "${SF2_SHA256:=}"       # optionnel: pour vérifier l'intégrité

echo "▶️  Boot script: SF2_PATH=$SF2_PATH"

# Si le SF2 n'est pas présent, on le télécharge côté serveur (pas côté client)
if [[ ! -s "$SF2_PATH" ]]; then
  if [[ -z "$SF2_URL" ]]; then
    echo "❌ SF2 introuvable et SF2_URL non défini. Abandon."
    exit 1
  fi
  echo "⬇️  Téléchargement SF2 → $SF2_PATH"
  mkdir -p "$(dirname "$SF2_PATH")"
  tmp="${SF2_PATH}.part"
  curl -L --fail --retry 3 -o "$tmp" "$SF2_URL"
  mv "$tmp" "$SF2_PATH"
fi

# Vérif d'intégrité (optionnelle)
if [[ -n "$SF2_SHA256" ]]; then
  echo "🔐 Vérification SHA256…"
  want="$SF2_SHA256"
  have="$(sha256sum "$SF2_PATH" | awk '{print $1}')"
  if [[ "$have" != "$want" ]]; then
    echo "❌ SHA256 mismatch: have=$have want=$want"
    exit 2
  fi
fi

# Config TiMidity minimale → interdit tout fallback
echo -e "dir /nonexistent\nsoundfont \"$SF2_PATH\"" > /etc/timidity/run.cfg
export TIMIDITY_CFG=/etc/timidity/run.cfg
echo "✅ TIMIDITY_CFG=$TIMIDITY_CFG"

# Démarre l'app
exec node server.js
