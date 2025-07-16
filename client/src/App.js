import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import UploadBeat from './pages/UploadBeat';
import ManageBeats from './pages/ManageBeats';
import EditBeat from './pages/EditBeat';
import STYPlayer from './pages/STYPlayer'; // ✅ Nouvelle page importée

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100 text-gray-800 font-sans">
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload-beat" element={<UploadBeat />} />
          <Route path="/edit-beat/:id" element={<EditBeat />} />
          <Route path="/manage-beats" element={<ManageBeats />} />
          <Route path="/sty-player" element={<STYPlayer />} /> {/* ✅ Route ajoutée */}

          {/* Page 404 */}
          <Route
            path="*"
            element={
              <div className="flex flex-col items-center justify-center h-screen">
                <h1 className="text-4xl font-bold text-red-500 mb-4">404</h1>
                <p className="text-xl">Page introuvable</p>
              </div>
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
