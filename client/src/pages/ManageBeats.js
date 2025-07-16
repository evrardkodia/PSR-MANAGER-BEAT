import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function ManageBeats() {
  const [beats, setBeats] = useState([]);
  const [selectedBeats, setSelectedBeats] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/auth');
      return;
    }

    axios.get('/api/beats/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => setBeats(response.data.beats))
      .catch((error) => {
        console.error('Erreur lors de la récupération des beats', error);
      });
  }, [navigate]);

  const handlePlayBeat = (beatId) => {
    console.log('Lecture du beat ID:', beatId);
  };

  const handleDeleteBeat = (beatId) => {
    const confirmed = window.confirm('Voulez-vous vraiment supprimer ce beat ?');
    if (!confirmed) return;

    const token = localStorage.getItem('token');
    axios.delete(`/api/beats/${beatId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(() => {
        setBeats(beats.filter(beat => beat.id !== beatId));
        alert('Beat supprimé avec succès');
      })
      .catch((error) => {
        console.error('Erreur lors de la suppression du beat', error);
      });
  };

  const handleCheckboxChange = (beatId) => {
    if (selectedBeats.includes(beatId)) {
      setSelectedBeats(selectedBeats.filter(id => id !== beatId));
    } else {
      setSelectedBeats([...selectedBeats, beatId]);
    }
  };

  const handleBulkDelete = () => {
    const confirmed = window.confirm('Êtes-vous sûr de vouloir supprimer tous les beats sélectionnés ?');
    if (!confirmed) return;

    const token = localStorage.getItem('token');
    selectedBeats.forEach((beatId) => {
      axios.delete(`/api/beats/${beatId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(() => {
          setBeats(prev => prev.filter(beat => beat.id !== beatId));
        })
        .catch((error) => {
          console.error('Erreur lors de la suppression des beats', error);
        });
    });

    setSelectedBeats([]);
    alert('Beats supprimés avec succès');
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto bg-gray-800 p-6 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold mb-4">Gérer vos beats</h2>

        <div className="mb-4">
          <button
            onClick={handleBulkDelete}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
          >
            🗑️ Supprimer les beats sélectionnés
          </button>
        </div>

        <table className="w-full table-auto">
          <thead>
            <tr className="text-center">
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Sélectionner</th>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Tempo</th>
              <th className="px-4 py-2">Signature</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2">Modifier</th>
              <th className="px-4 py-2">Supprimer</th>
              <th className="px-4 py-2"></th> {/* Play button column */}
            </tr>
          </thead>
          <tbody>
            {beats.map((beat, index) => (
              <tr
                key={beat.id}
                className="border-t border-gray-600 hover:scale-105 transform transition duration-300 text-center"
              >
                <td className="px-4 py-2">{index + 1}</td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selectedBeats.includes(beat.id)}
                    onChange={() => handleCheckboxChange(beat.id)}
                    className="form-checkbox w-6 h-6"
                  />
                </td>
                <td className="px-4 py-2">{beat.title}</td>
                <td className="px-4 py-2">{beat.tempo}</td>
                <td className="px-4 py-2">{beat.signature}</td>
                <td className="px-4 py-2">{beat.description || 'Aucune'}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => {
                      localStorage.setItem('beatToEdit', JSON.stringify(beat));
                      navigate(`/edit-beat/${beat.id}`);
                    }}
                    className="bg-yellow-500 hover:bg-yellow-600 px-4 py-2 rounded"
                  >
                    📝 Modifier
                  </button>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleDeleteBeat(beat.id)}
                    className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                  >
                    🗑️ Supprimer
                  </button>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handlePlayBeat(beat.id)}
                    className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
                  >
                    🎶 Play
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
