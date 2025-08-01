#!/bin/bash

# Mise à jour et installation de timidity et sox
apt-get update
apt-get install -y timidity 

# Télécharger le SoundFont Yamaha_PSR.sf2
mkdir -p /app/soundfonts
curl -L -o /app/soundfonts/Yamaha_PSR.sf2 https://pub-70e217e0437d4b508fcd492d95212e77.r2.dev/Yamaha_PSR.sf2

# Installation des dépendances Python
pip install -r requirements.txt

# Installation des dépendances Node.js
npm install

# Génération du client Prisma
npx prisma generate
