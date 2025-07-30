const fs = require('fs');
const path = require('path');

// ✅ Charger les variables d'environnement
require('dotenv').config();

// ✅ Créer le fichier credentials/service-account.json depuis la variable d’environnement
const credentialsPath = path.resolve(__dirname, 'credentials/service-account.json');

if (!fs.existsSync(credentialsPath)) {
  console.log('✍️ Création du fichier credentials/service-account.json depuis la variable GOOGLE_SERVICE_ACCOUNT_JSON');
  let jsonContent = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonContent) {
    console.error('❌ Variable GOOGLE_SERVICE_ACCOUNT_JSON non définie');
    process.exit(1);
  }

  try {
    if (typeof jsonContent === 'string' && jsonContent.trim().startsWith('{')) {
      jsonContent = JSON.stringify(JSON.parse(jsonContent), null, 2);
    }
  } catch (e) {
    console.error('❌ Erreur de parsing du JSON de GOOGLE_SERVICE_ACCOUNT_JSON');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, jsonContent, 'utf8');
} else {
  console.log('✅ Fichier credentials/service-account.json déjà existant');
}

const express = require('express');
const cors = require('cors');
const logger = require('./logger');

const app = express();

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

// ✅ Dossiers auto-créés
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

// ✅ Lancement
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  logger.info(`✅ Serveur démarré sur http://localhost:${PORT} — 🕒 ${now}`);
});
