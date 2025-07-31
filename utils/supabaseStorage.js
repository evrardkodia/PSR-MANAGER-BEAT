const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const bucket = 'uploads';  // Assure-toi que ce bucket existe dans Supabase Storage

/**
 * Upload un fichier local dans Supabase Storage
 * @param {string} filePath - chemin local du fichier
 * @param {string} filename - nom du fichier dans le bucket
 * @returns {string} URL publique du fichier
 */
async function uploadFileToSupabaseStorage(filePath, filename) {
  const fileBuffer = fs.readFileSync(filePath);

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filename, fileBuffer, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'application/octet-stream', // ou 'audio/midi' si applicable
    });

  if (error) {
    console.error('Erreur upload Supabase:', error);
    throw error;
  }

  const { publicURL, error: urlError } = supabase.storage.from(bucket).getPublicUrl(filename);
  if (urlError) {
    console.error('Erreur récupération URL publique:', urlError);
    throw urlError;
  }

  return publicURL;
}

/**
 * Supprime un fichier dans Supabase Storage
 * @param {string} filename - nom du fichier à supprimer dans le bucket
 */
async function deleteFileFromSupabaseStorage(filename) {
  const { data, error } = await supabase.storage.from(bucket).remove([filename]);

  if (error) {
    console.error('Erreur suppression fichier Supabase:', error);
    throw error;
  }

  return data;
}

module.exports = {
  uploadFileToSupabaseStorage,
  deleteFileFromSupabaseStorage,
};
