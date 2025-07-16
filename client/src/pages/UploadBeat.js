import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function UploadBeat() {
  const [file, setFile] = useState(null);
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [tempo, setTempo] = useState('');
  const [description, setDescription] = useState('');
  const [timeSignature, setTimeSignature] = useState('');
  const [customSignature, setCustomSignature] = useState(false);
  const [customTop, setCustomTop] = useState('');
  const [customBottom, setCustomBottom] = useState('');
  const navigate = useNavigate();

  const handleFileUpload = (e) => {
    setFile(e.target.files[0]);
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!file || !title) {
      alert("Fichier et titre requis !");
      return;
    }

    const extension = file.name.split('.').pop();
    const newFileName = `${title.trim().replace(/[^\w\s-]/g, '_')}.${extension}`;
    const renamedFile = new File([file], newFileName, { type: file.type });

    const formData = new FormData();
    formData.append('beat', renamedFile);
    formData.append('title', title);
    formData.append('tempo', tempo);
    formData.append('description', description);

    const signature = customSignature ? `${customTop}/${customBottom}` : timeSignature;
    formData.append('signature', signature);

    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/beats/upload', formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });
      alert('Beat ajouté avec succès !');
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Erreur lors de l’envoi');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-xl mx-auto bg-gray-800 p-6 rounded-xl shadow-lg">
        <h2 className="text-2xl font-bold mb-4">Ajouter un nouveau beat</h2>

        {step === 1 && (
          <div>
            <label className="block mb-2">Charger un fichier .sty :</label>
            <input
              type="file"
              accept=".sty"
              onChange={handleFileUpload}
              className="w-full p-2 bg-gray-700 rounded"
              required
            />
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label>Nom du beat :</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 rounded bg-gray-700 border border-gray-600"
                required
              />
            </div>

            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={customSignature}
                  onChange={(e) => setCustomSignature(e.target.checked)}
                />
                <span>Signature rythmique personnalisée</span>
              </label>

              {!customSignature ? (
                <select
                  value={timeSignature}
                  onChange={(e) => setTimeSignature(e.target.value)}
                  className="w-full p-2 rounded bg-gray-700 border border-gray-600 mt-2"
                  required
                >
                  <option value="">Sélectionner</option>
                  <option value="4/4">4/4</option>
                  <option value="6/8">6/8</option>
                  <option value="12/8">12/8</option>
                  <option value="3/4">3/4</option>
                  <option value="6:8/4:4">6:8/4:4</option>
                  <option value="2/4">2/4</option>
                </select>
              ) : (
                <div className="flex items-center space-x-2 mt-2">
                  <input
                    type="number"
                    placeholder="Top"
                    value={customTop}
                    onChange={(e) => setCustomTop(e.target.value)}
                    className="w-1/2 p-2 rounded bg-gray-700 border border-gray-600"
                    required
                  />
                  <span>/</span>
                  <input
                    type="number"
                    placeholder="Bottom"
                    value={customBottom}
                    onChange={(e) => setCustomBottom(e.target.value)}
                    className="w-1/2 p-2 rounded bg-gray-700 border border-gray-600"
                    required
                  />
                </div>
              )}
            </div>

            <div>
              <label>Tempo :</label>
              <input
                type="number"
                value={tempo}
                onChange={(e) => setTempo(e.target.value)}
                className="w-full p-2 rounded bg-gray-700 border border-gray-600"
                required
              />
            </div>

            <div>
              <label>Description / Genre :</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full p-2 rounded bg-gray-700 border border-gray-600"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded font-bold"
            >
              Enregistrer le beat
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
