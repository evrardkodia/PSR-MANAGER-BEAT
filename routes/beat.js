const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// 📂 Dossier de destination pour les fichiers uploadés
const uploadDir = path.resolve(process.cwd(), 'uploads');
console.log('📂 Dossier upload utilisé (uploadDir) :', uploadDir);

// Crée le dossier s’il n’existe pas
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    console.log('🟢 Nom original du fichier reçu :', file.originalname);
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9-_\\.]/g, '_');

    // Ajout .sty si nécessaire
    if (!path.extname(sanitized)) {
      console.warn('⚠️ Aucun extension détectée ! Ajout automatique de .sty');
      return cb(null, sanitized + '.sty');
    }

    cb(null, sanitized);
  }
});

const upload = multer({ storage });

// Middleware JWT d’authentification
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// 📂 ROUTE pour lister les fichiers dans le dossier /uploads
router.get('/uploads-list', authMiddleware, (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      console.error('Erreur lecture dossier uploads:', err);
      return res.status(500).json({ error: 'Erreur lecture dossier', details: err.message });
    }
    res.json({ files });
  });
});

// 🟢 GET tous les beats publics
router.get('/public', async (req, res) => {
  try {
    const beats = await prisma.beat.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } }
    });

    console.log('Beats récupérés:', beats.map(b => ({ id: b.id, title: b.title, filename: b.filename })));
    res.json({ beats });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ⬆️ POST upload beat
router.post('/upload', authMiddleware, upload.single('beat'), async (req, res) => {
  const file = req.file;
  const { title, tempo, description, signature } = req.body;

  if (!file) return res.status(400).json({ error: 'Aucun fichier fourni' });

  try {
    const beat = await prisma.beat.create({
      data: {
        title,
        tempo: parseInt(tempo),
        description,
        signature,
        filename: file.filename,
        userId: req.user.userId
      }
    });

    res.status(201).json({ message: 'Beat uploadé avec succès', beat });
  } catch (err) {
    console.error("Erreur enregistrement beat :", err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// 👤 GET beats de l'utilisateur connecté
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const beats = await prisma.beat.findMany({
      where: { userId: req.user.userId },
      orderBy: { title: 'asc' }
    });
    res.json({ beats });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// 🆔 GET beat par ID — ENVOIE LE FICHIER .sty
router.get('/:id', authMiddleware, async (req, res) => {
  const beatId = parseInt(req.params.id);

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });

    if (!beat || beat.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès interdit ou beat introuvable' });
    }

    const filePath = path.join(uploadDir, beat.filename);
    console.log('Chemin complet du fichier demandé :', filePath);
    console.log('Fichier existe ? ', fs.existsSync(filePath));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Fichier .sty non trouvé' });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ❌ DELETE beat
router.delete('/:id', authMiddleware, async (req, res) => {
  const beatId = parseInt(req.params.id);

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });

    if (!beat || beat.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès interdit ou beat introuvable' });
    }

    const filepath = path.join(uploadDir, beat.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    await prisma.beat.delete({ where: { id: beatId } });

    res.json({ message: 'Beat supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ✏️ PUT update beat
router.put('/:id', authMiddleware, upload.single('beat'), async (req, res) => {
  const beatId = parseInt(req.params.id);
  const { title, tempo, description, signature } = req.body;

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });

    if (!beat || beat.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès interdit ou beat introuvable' });
    }

    const updateData = {
      title,
      tempo: parseInt(tempo),
      description,
      signature,
    };

    if (req.file) {
      const oldFilePath = path.join(uploadDir, beat.filename);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

      updateData.filename = req.file.filename;
    }

    await prisma.beat.update({
      where: { id: beatId },
      data: updateData,
    });

    res.json({ message: 'Beat mis à jour avec succès' });
  } catch (err) {
    console.error('Erreur mise à jour beat :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

module.exports = router;
