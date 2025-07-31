#!/bin/bash

# Mise à jour et installation de timidity
apt-get update
apt-get install -y timidity

# Installation des dépendances Python
pip install -r requirements.txt

# Installation des dépendances Node.js
npm install

# Génération du client Prisma
npx prisma generate

# Téléchargement du SoundFont Yamaha_PSR.sf2 dans soundfonts/
echo "⬇️ Téléchargement du SoundFont Yamaha_PSR.sf2 dans soundfonts/"
curl -L -o soundfonts/Yamaha_PSR.sf2 https://pub-70e217e0437d4b508fcd492d95212e77.r2.dev/Yamaha_PSR.sf2

echo "✅ SoundFont téléchargé avec succès"
