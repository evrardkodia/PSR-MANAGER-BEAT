require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');

const app = express();

// Middleware pour logger chaque requête HTTP avec méthode, URL, temps de réponse
app.use(morgan('combined'));

// Logger corps des requêtes JSON (optionnel, attention données sensibles)
app.use(express.json());
app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('📥 Corps de la requête:', JSON.stringify(req.body));
  }
  next();
});

app.use(cors());

// Importation des routes
const authRoutes = require('./routes/auth');
const beatRoutes = require('./routes/beat');
const playerRoutes = require('./routes/player');

app.use('/api/auth', authRoutes);
app.use('/api/beats', beatRoutes);
app.use('/api/player', playerRoutes);

app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/soundfonts', express.static(path.join(__dirname, 'soundfonts')));

// Middleware global pour catcher les erreurs non gérées dans les routes
app.use((err, req, res, next) => {
  console.error('🔥 ERREUR INTERNE:', err.stack || err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Lancement serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  console.log(`✅ Server running on http://localhost:${PORT} — 🕒 Démarré à ${now}`);
});
