const fs = require('fs');
const path = require('path');
const midi = require('midi-file');

const inputMidPath = './temp/test_extraction.mid';
const outputMidPath = './temp/Main_A.mid';

// Charger le fichier MIDI
const inputData = fs.readFileSync(inputMidPath);
const parsed = midi.parseMidi(inputData);

// Filtrer les pistes contenant "Main A"
const sectionName = 'Main A';
const filteredTracks = parsed.tracks.map(track => {
  let insideSection = false;
  let outputEvents = [];

  for (let i = 0; i < track.length; i++) {
    const event = track[i];

    if (event.type === 'meta' && event.subtype === 'marker') {
      const marker = event.text.toLowerCase();
      if (marker.includes('main a')) {
        insideSection = true;
        outputEvents.push(event); // Ajouter le marker lui-même
        continue;
      }
      if (insideSection && !marker.includes('main a')) {
        // Fin de la section Main A
        break;
      }
    }

    if (insideSection && (event.type === 'noteOn' || event.type === 'noteOff' || event.type === 'meta')) {
      outputEvents.push(event);
    }
  }

  return outputEvents.length > 0 ? outputEvents : null;
}).filter(track => track !== null);

// Si rien trouvé, on sort
if (filteredTracks.length === 0) {
  console.error("❌ Aucun événement trouvé pour la section 'Main A'");
  process.exit(1);
}

// Créer un objet MIDI valide
const outputMidi = {
  header: parsed.header,
  tracks: filteredTracks
};

// Sauvegarder le nouveau fichier MIDI
const outputData = midi.writeMidi(outputMidi);
fs.writeFileSync(outputMidPath, Buffer.from(outputData));

console.log(`✅ Section "${sectionName}" extraite avec succès : ${outputMidPath}`);
