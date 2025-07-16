// src/pages/Dashboard.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/auth');
      return;
    }

    // Vérification du token et récupération des informations de l'utilisateur
    axios.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => setUser(res.data))
      .catch(err => {
        console.error("Token invalide ou expiré", err);
        navigate('/auth');
      });
  }, [navigate]);

  // Fonction de déconnexion
  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/auth');
  };

  // Si l'utilisateur est en cours de chargement
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <p className="text-xl animate-pulse">Chargement...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <header className="bg-gray-900 p-4 flex justify-between items-center shadow-lg">
        <h1 className="text-2xl font-bold tracking-wide">🎹 PSR MANAGER STYLE</h1>
        <button
          onClick={handleLogout}
          className="bg-red-600 px-4 py-2 rounded hover:bg-red-700 transition"
        >
          Déconnexion
        </button>
      </header>

      <main className="p-6">
        <section className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Bienvenue, {user.username} 👋</h2>
          <p className="text-gray-400">Voici votre tableau de bord. Vous pouvez ajouter ou gérer vos beats ici :</p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Ajouter un beat */}
          <div
            onClick={() => navigate('/upload-beat')}
            className="cursor-pointer bg-gray-800 p-6 rounded-lg shadow hover:shadow-xl transition hover:bg-gray-700"
          >
            <h3 className="text-xl font-semibold">📤 Ajouter vos beats</h3>
            <p className="text-gray-400 mt-2">Téléversez vos fichiers Yamaha .sty</p>
          </div>

          {/* Gérer les beats */}
          <div
            onClick={() => navigate('/manage-beats')}
            className="cursor-pointer bg-gray-800 p-6 rounded-lg shadow hover:shadow-xl transition hover:bg-gray-700"
          >
            <h3 className="text-xl font-semibold">🎛️ Gérer vos beats</h3>
            <p className="text-gray-400 mt-2">Modifier, renommer ou supprimer vos créations</p>
          </div>

          {/* Lecteur STY intégré */}
          <div
            onClick={() => navigate('/sty-player')}
            className="cursor-pointer bg-gray-800 p-6 rounded-lg shadow hover:shadow-xl transition hover:bg-gray-700"
          >
            <h3 className="text-xl font-semibold">🎧 Lecteur STY intégré</h3>
            <p className="text-gray-400 mt-2">Lire vos beats comme sur un Yamaha SX700</p>
          </div>
        </div>
      </main>

      <footer className="bg-gray-900 p-4 text-center text-gray-500 mt-12">
        &copy; {new Date().getFullYear()} STY Platform. Tous droits réservés.
      </footer>
    </div>
  );
}
