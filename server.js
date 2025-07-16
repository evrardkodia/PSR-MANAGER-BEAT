// Chargement des variables d'environnement (.env)
require('dotenv').config();

// Importations
const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialisation de l'app Express
const app = express();

// Importation des routes
const authRoutes = require('./routes/auth');
const beatRoutes = require('./routes/beat');
const playerRoutes = require('./routes/player'); // <-- Ajout pour lecture audio .sty

// Middlewares globaux
app.use(cors());
app.use(express.json());

// Routes API
app.use('/api/auth', authRoutes);      // Authentification (login, register, etc.)
app.use('/api/beats', beatRoutes);     // Gestion des beats .sty
app.use('/api/player', playerRoutes);  // Lecture et conversion audio des .sty

// Dossier statique pour servir les fichiers audio temporaires si besoin
app.use('/static', express.static(path.join(__dirname, 'static')));

// Lancement du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
  console.log(`✅ Server running on http://localhost:${PORT} — 🕒 Démarré à ${now}`);
});
