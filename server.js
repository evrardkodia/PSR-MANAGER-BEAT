require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
const fs = require('fs');

const app = express();

// 🛡️ CORS: autorise le frontend déployé sur Render
const allowedOrigins = [
  'https://psr-managers-style.onrender.com', // ✅ ton frontend React Render
  'http://localhost:3000' // 🔧 utile si tu testes en local aussi
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// 📋 Logger chaque requête HTTP
app.use(morgan('combined'));

// 📥 Logger corps des requêtes JSON (optionnel)
app.use(express.json());
app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📥 Corps de la requête:', JSON.stringify(req.body));
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
  console.log('📁 Dossier uploads créé automatiquement');
} else {
  console.log('📁 Dossier uploads déjà existant');
}

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log('📁 Dossier temp créé automatiquement');
} else {
  console.log('📁 Dossier temp déjà existant');
}

// ⚠️ Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('🔥 ERREUR INTERNE:', err.stack || err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// 🚀 Lancement du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  console.log(`✅ Server running on http://localhost:${PORT} — 🕒 Démarré à ${now}`);
});
