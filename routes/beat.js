const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { uploadFileToSupabaseStorage, deleteFileFromSupabaseStorage } = require('../utils/supabaseStorage');

const JWT_SECRET = process.env.JWT_SECRET;
const supabaseAdmin = createClient(
  'https://swtbkiudmfvnywcgpzfe.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY // ⚠️ clé service côté backend uniquement
);
// 📂 Dossier de destination temporaire pour les fichiers uploadés
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
    // Upload sur Supabase Storage
    const supabaseUrl = await uploadFileToSupabaseStorage(file.path, file.filename);
    console.log('✅ Upload Supabase Storage :', supabaseUrl);

    // Supprime le fichier local après upload
    fs.unlinkSync(file.path);

    // Enregistre en base
    const beat = await prisma.beat.create({
      data: {
        title,
        tempo: parseInt(tempo),
        description,
        signature,
        filename: file.filename,
        userId: req.user.userId,
        url: supabaseUrl // ✅ enregistrer l’URL dans le champ `url`
      }
    });

   res.status(201).json({
  message: 'Beat uploadé avec succès',
  id: beat.id, // ✅ renvoyer directement l'ID
  beat
});

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

// 🏢 GET beat par ID — fichier local (fallback)
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
      return res.status(404).json({ error: 'Fichier .sty non trouvé localement. Utilise plutôt l’URL de stockage.' });
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

    // 1️⃣ Supprime le fichier .sty du bucket principal
    await deleteFileFromSupabaseStorage(beat.filename);

    // 2️⃣ Supprime aussi tout le dossier beatId du bucket midiAndWav
    const { error: deleteFolderError } = await supabaseAdmin
      .storage
      .from('midiAndWav')
      .remove([`${beatId}/`]); // Supprime tout le dossier

    if (deleteFolderError) {
      console.error(`⚠️ Erreur suppression dossier midiAndWav/${beatId} :`, deleteFolderError);
    } else {
      console.log(`📂 Dossier midiAndWav/${beatId} supprimé`);
    }

    // 3️⃣ Supprime localement le .sty s'il existe
    const filepath = path.join(uploadDir, beat.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

    // 4️⃣ Supprime en base
    await prisma.beat.delete({ where: { id: beatId } });

    res.json({ message: 'Beat et fichiers associés supprimés avec succès' });
  } catch (err) {
    console.error('Erreur suppression beat:', err);
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
      // Supprime ancien fichier local
      const oldFilePath = path.join(uploadDir, beat.filename);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);

      updateData.filename = req.file.filename;

      // Upload nouveau fichier sur Supabase
      const supabaseUrl = await uploadFileToSupabaseStorage(req.file.path, req.file.filename);
      updateData.url = supabaseUrl; // ✅ mise à jour du champ url

      // Supprime fichier local temporaire
      fs.unlinkSync(req.file.path);
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

router.get('/', authMiddleware, async (req, res) => {
  try {
    const beats = await prisma.beat.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true } } }
    });
    res.json({ beats });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur', details: err.message });
  }
});


module.exports = router;


// Client Supabase avec Service Role Key pour la suppression


// ❌ DELETE beat

