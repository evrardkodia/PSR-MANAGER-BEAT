require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const logger = require('./logger');  // <-- Import pino logger

const app = express();

// 🛡️ CORS: autorise le frontend déployé sur Render
const allowedOrigins = [
  'https://psr-managers-style.onrender.com',
  'http://localhost:3000'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// 📋 Logger chaque requête HTTP avec pino via middleware express (optionnel)
// Il existe pino-http pour logger automatiquement les requêtes :
// const pinoHttp = require('pino-http')({ logger });
// app.use(pinoHttp);
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, 'Requête HTTP reçue');
  next();
});

// 📥 Logger corps des requêtes JSON (optionnel)
app.use(express.json());
app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    logger.info({ body: req.body }, '📥 Corps de la requête');
  }
  next();
});

// 🛣️ Routes principales
const authRoutes = require('./routes/auth');
const beatRoutes = require('./routes/beat');
const playerRoutes = require('./routes/player');

app.use('/api/auth', authRoutes);
app.use('/api/beats', beatRoutes);
app.use('/api/player', playerRoutes);

// 🗂️ Fichiers statiques
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/soundfonts', express.static(path.join(__dirname, 'soundfonts')));

// Création automatique dossiers nécessaires
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info('📁 Dossier uploads créé automatiquement');
} else {
  logger.info('📁 Dossier uploads déjà existant');
}

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  logger.info('📁 Dossier temp créé automatiquement');
} else {
  logger.info('📁 Dossier temp déjà existant');
}

// ⚠️ Gestion des erreurs globales
app.use((err, req, res, next) => {
  logger.error(err, '🔥 ERREUR INTERNE');
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// 🚀 Lancement du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  logger.info(`✅ Server running on http://localhost:${PORT} — 🕒 Démarré à ${now}`);
});
