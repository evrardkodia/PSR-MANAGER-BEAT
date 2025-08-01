const fs = require('fs');
const path = require('path');

// ✅ Charger les variables d'environnement
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const logger = require('./logger');

const app = express();

// ✅ Vérification du fichier SoundFont
const soundfontPath = process.env.SF2_PATH || path.join(__dirname, 'soundfonts', 'Yamaha_PSR.sf2');
if (!fs.existsSync(soundfontPath)) {
  logger.error(`❌ Fichier SoundFont introuvable : ${soundfontPath}`);
  process.exit(1); // Arrêter le serveur si le fichier est manquant
}
logger.info(`🎹 SoundFont utilisé : ${soundfontPath}`);

// ✅ Configuration CORS
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
    return res.sendStatus(200); // Préflight CORS
  }

  next();
});

app.use(express.json());

// ✅ Logger HTTP
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, '📥 Requête HTTP reçue');
  if (req.body && Object.keys(req.body).length > 0) {
    logger.info({ body: req.body }, '📦 Corps de la requête');
  }
  next();
});

// ✅ Routes principales
const authRoutes = require('./routes/auth');
const beatRoutes = require('./routes/beat');
const playerRoutes = require('./routes/player');

app.use('/api/auth', authRoutes);
app.use('/api/beats', beatRoutes);
app.use('/api/player', playerRoutes);

// ✅ Statics
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/soundfonts', express.static(path.join(__dirname, 'soundfonts')));

// ✅ Dossiers auto-créés au démarrage
['uploads', 'temp'].forEach((dir) => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    logger.info(`📁 Dossier ${dir} créé automatiquement`);
  } else {
    logger.info(`📁 Dossier ${dir} déjà existant`);
  }
});

// ❌ Gestion d’erreur centralisée
app.use((err, req, res, next) => {
  logger.error(err, '🔥 ERREUR INTERNE');
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ✅ Lancement du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  logger.info(`✅ Serveur démarré sur http://localhost:${PORT} — 🕒 ${now}`);
});
