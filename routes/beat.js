const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// 📦 Multer : configuration stockage des fichiers
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // ✅ Nom sans timestamp si besoin : cb(null, file.originalname)
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9-_\\.]/g, '_'); // nettoyage
    cb(null, sanitized);
  }
});

const upload = multer({ storage });

// 🔐 Middleware d'authentification
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

// ✅ Route POST /api/beats/upload
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
    console.error("❌ Erreur enregistrement beat :", err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ✅ Route GET /api/beats/me
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

// ✅ Route GET /api/beats/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const beatId = parseInt(req.params.id);

  try {
    const beat = await prisma.beat.findUnique({
      where: { id: beatId }
    });

    if (!beat || beat.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès interdit ou beat introuvable' });
    }

    const filePath = path.join(__dirname, '../uploads', beat.filename);
    res.json({ filePath });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ✅ Route DELETE /api/beats/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const beatId = parseInt(req.params.id);

  try {
    const beat = await prisma.beat.findUnique({
      where: { id: beatId }
    });

    if (!beat || beat.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Accès interdit ou beat introuvable' });
    }

    const filepath = path.join(__dirname, '../uploads', beat.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    await prisma.beat.delete({ where: { id: beatId } });

    res.json({ message: 'Beat supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

// ✅ Route PUT /api/beats/:id
router.put('/:id', authMiddleware, upload.single('beat'), async (req, res) => {
  const beatId = parseInt(req.params.id);
  const { title, tempo, description, signature } = req.body;

  try {
    const beat = await prisma.beat.findUnique({
      where: { id: beatId }
    });

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
      const oldFilePath = path.join(__dirname, '../uploads', beat.filename);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

      updateData.filename = req.file.filename;
    }

    await prisma.beat.update({
      where: { id: beatId },
      data: updateData,
    });

    res.json({ message: 'Beat mis à jour avec succès' });
  } catch (err) {
    console.error('❌ Erreur mise à jour beat :', err);
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});

module.exports = router;
