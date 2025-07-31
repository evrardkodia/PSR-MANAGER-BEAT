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
