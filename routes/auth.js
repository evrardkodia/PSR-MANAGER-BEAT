const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { google } = require('googleapis');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://psr-backend-sdwl.onrender.com/oauth2callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://psr-managers-styles.onrender.com';

if (!JWT_SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('⚠️ Assure-toi que JWT_SECRET, GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET sont définis dans .env');
}

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

// --- ROUTE INSCRIPTION ---
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  console.log("📥 Reçu pour register:", req.body);

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email déjà utilisé.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { username, email, password: hashedPassword }
    });

    console.log("✅ Nouvel utilisateur inscrit :", user);

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    console.error("❌ Erreur lors de l'inscription :", err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- ROUTE CONNEXION ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log("🔐 Tentative de connexion pour :", email);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    // Pour les utilisateurs OAuth sans password (password vide), refuser login classique
    if (!user.password) {
      return res.status(400).json({ error: 'Utilisateur enregistré via OAuth, utilisez la connexion Google.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    console.log("✅ Connexion réussie pour :", user.email);

    res.json({
      message: 'Connexion réussie',
      token
    });
  } catch (err) {
    console.error("❌ Erreur lors de la connexion :", err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- Middleware vérification JWT ---
const verifyToken = (req, res, next) => {
  const header = req.headers['authorization'];
  const token = header && header.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403);
    req.userId = decoded.userId;
    next();
  });
};

// --- ROUTE GET USER ME ---
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, username: true }
    });

    res.json(user);
  } catch (err) {
    console.error("❌ Erreur dans /me :", err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// --- ROUTE POUR OBTENIR URL AUTH GOOGLE ---
router.get('/google/url', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });

  res.json({ url });
});

// --- ROUTE CALLBACK GOOGLE OAUTH2 ---
router.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Cherche un utilisateur existant par email
    let user = await prisma.user.findUnique({ where: { email: userInfo.data.email } });

    // Si pas trouvé, créer un utilisateur avec un password vide (OAuth)
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: userInfo.data.email,
          username: userInfo.data.name || userInfo.data.email,
          password: '',  // vide car connexion via OAuth
        }
      });
      console.log('✅ Utilisateur OAuth créé:', user.email);
    }

    // Générer JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1d' });

    // Rediriger vers frontend avec token dans query (à adapter selon frontend)
    res.redirect(`${FRONTEND_URL}/?token=${token}`);
  } catch (err) {
    console.error('❌ Erreur OAuth2 Google:', err);
    res.status(500).send('Erreur OAuth Google');
  }
});

module.exports = router;
