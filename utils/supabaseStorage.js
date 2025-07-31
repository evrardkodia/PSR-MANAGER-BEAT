const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadFileToSupabaseStorage(filePath, filename) {
  const bucket = 'uploads';  // Nom du bucket à créer dans Supabase Storage
  const fileBuffer = require('fs').readFileSync(filePath);

  // Upload du fichier dans Supabase Storage
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filename, fileBuffer, {
      cacheControl: '3600',
      upsert: true
    });

  if (error) {
    throw error;
  }

  // Retourne l'URL publique (ou une URL signée si nécessaire)
  const { publicURL, error: urlError } = supabase.storage.from(bucket).getPublicUrl(filename);
  if (urlError) throw urlError;

  return publicURL;
}

module.exports = {
  uploadFileToSupabaseStorage,
};
