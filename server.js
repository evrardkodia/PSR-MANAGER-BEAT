require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const app = express();

// ✅ Liste des domaines autorisés (frontend + localhost)
const allowedOrigins = [
  'https://psr-managers-styles.onrender.com',
  'http://localhost:3000'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200); // Requête préflight CORS
  }

  next();
});

// 📥 Middleware JSON + logger
app.use(express.json());
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, '📥 Requête HTTP reçue');
  if (req.body && Object.keys(req.body).length > 0) {
    logger.info({ body: req.body }, '📦 Corps de la requête');
  }
  next();
});

// 🛣️ Routes
const authRoutes = require('./routes/auth');
const beatRoutes = require('./routes/beat');
const playerRoutes = require('./routes/player');

app.use('/api/auth', authRoutes);
app.use('/api/beats', beatRoutes);
app.use('/api/player', playerRoutes);

// 🗂️ Fichiers statiques
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/soundfonts', express.static(path.join(__dirname, 'soundfonts')));

// 📁 Création automatique des dossiers
['uploads', 'temp'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    logger.info(`📁 Dossier ${dir} créé automatiquement`);
  } else {
    logger.info(`📁 Dossier ${dir} déjà existant`);
  }
});

// ❌ Gestion des erreurs
app.use((err, req, res, next) => {
  logger.error(err, '🔥 ERREUR INTERNE');
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// 🚀 Lancement du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  logger.info(`✅ Serveur lancé sur http://localhost:${PORT} — 🕒 Démarré à ${now}`);
});
