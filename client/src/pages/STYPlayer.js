import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function STYPlayer() {
  const [beats, setBeats] = useState([]);
  const [selectedBeat, setSelectedBeat] = useState(null);
  const [page, setPage] = useState(0);
  const [controls, setControls] = useState({
    acmp: false,
    autofill: false,
    intro: '',
    main: 'A',
    ending: '',
    play: false,
  });
  const [mainBlinking, setMainBlinking] = useState(null);
  const [playColor, setPlayColor] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const playTimerRef = useRef(null);
  const audioRef = useRef(null);
  const navigate = useNavigate();
  const ITEMS_PER_PAGE = 20;

  const getIconPath = (title) => {
    const iconCount = 10;
    let sum = 0;
    for (let i = 0; i < title.length; i++) sum += title.charCodeAt(i);
    const index = (sum % iconCount) + 1;
    return `/icons/${index}.png`;
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return navigate('/auth');

    axios
      .get('/api/beats/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const sorted = res.data.beats.sort((a, b) => a.title.localeCompare(b.title));
        setBeats(sorted);
      })
      .catch((err) => {
        console.error('❌ Erreur chargement beats :', err);
        navigate('/auth');
      });
  }, [navigate]);

  useEffect(() => {
    if (!controls.play || !selectedBeat) {
      clearTimeout(playTimerRef.current);
      setPlayColor(null);
      return;
    }

    const sequence = ['blue', null, 'orange', null, 'orange', null, 'orange', null];
    let index = 0;

    const beatDuration = 60000 / (selectedBeat.tempo || 120);
    const stepDuration = beatDuration * 1.5;
    const colorDuration = stepDuration * 0.4;
    const offDuration = stepDuration * 0.6;

    const animate = () => {
      setPlayColor(sequence[index]);
      const nextDelay = sequence[index] === null ? offDuration : colorDuration;
      index = (index + 1) % sequence.length;
      playTimerRef.current = setTimeout(animate, nextDelay);
    };

    animate();
    return () => clearTimeout(playTimerRef.current);
  }, [controls.play, selectedBeat]);

  const togglePlay = async () => {
    if (!selectedBeat || isLoading) {
      alert('⚠️ Aucun beat sélectionné ou chargement en cours.');
      return;
    }

    if (controls.play && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      setControls((prev) => ({ ...prev, play: false }));
      setPlayColor(null);
      clearTimeout(playTimerRef.current);
      return;
    }

    setIsLoading(true);
    const token = localStorage.getItem('token');
    const section = `Main ${controls.main}`;

    console.log(`📡 Lecture demandée : ${selectedBeat.title} — Section ${section}`);

    try {
      const response = await axios.post(
        '/api/player/play-section',
        { beatId: selectedBeat.id, section },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          responseType: 'blob',
        }
      );

      const blob = new Blob([response.data], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      console.log('🎧 URL générée :', url);

      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.load(); // 🔥 important
        audioRef.current.currentTime = 0;
        audioRef.current.loop = true;
        await audioRef.current.play();
      }

      setControls((prev) => ({ ...prev, play: true }));
    } catch (err) {
      console.error('❌ Erreur lecture beat :', err.message || err);
      alert('❌ Lecture échouée. Fichier .sty peut-être manquant ou invalide.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectBeat = (beat) => {
    setSelectedBeat(beat);
    setControls({ acmp: false, autofill: false, intro: '', main: 'A', ending: '', play: false });
    setMainBlinking(null);
    setPlayColor(null);
    clearTimeout(playTimerRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  };

  const handleControlClick = (type, value = null) => {
    if (type === 'main') {
      setMainBlinking(value);
      setTimeout(() => {
        setControls((prev) => ({ ...prev, main: value }));
        setMainBlinking(null);
      }, 2000);
      return;
    }

    if (type === 'play') {
      togglePlay();
      return;
    }

    setControls((prev) => {
      const updated = { ...prev };
      if (type === 'acmp' || type === 'autofill') {
        updated[type] = !prev[type];
      } else if (type === 'intro') {
        updated.intro = prev.intro === value ? '' : value;
      } else if (type === 'ending') {
        updated.ending = prev.ending === value ? '' : value;
      }
      return updated;
    });
  };

  const startIndex = page * ITEMS_PER_PAGE;
  const currentPageBeats = beats.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  const leftColumn = currentPageBeats.slice(0, 10);
  const rightColumn = currentPageBeats.slice(10, 20);

  const renderBeatCard = (beat) => (
    <div
      key={beat.id}
      onClick={() => handleSelectBeat(beat)}
      className={`flex items-center gap-3 cursor-pointer p-2 mb-2 rounded-md transition hover:bg-blue-700 ${
        selectedBeat?.id === beat.id ? 'bg-blue-800' : 'bg-[#3a3a3a]'
      }`}
    >
      <div className="w-10 h-10 bg-white flex items-center justify-center rounded-sm">
        <img src={getIconPath(beat.title)} alt="icon" className="w-8 h-8 object-contain" />
      </div>
      <div>
        <p className="font-semibold">{beat.title}</p>
        <p className="text-sm text-gray-400">
          {beat.signature} - {beat.tempo} BPM
        </p>
      </div>
    </div>
  );

  const renderButton = (type, label, isActive, onClick, isBlinking = false) => {
    let colorClass = 'bg-transparent';
    if (type === 'acmp' || type === 'autofill') {
      colorClass = isActive ? 'bg-orange-400 glow' : 'bg-black';
    } else if (type === 'main') {
      colorClass = isBlinking ? 'animate-orange-blue-blink' : isActive ? 'bg-blue-500 glow' : 'bg-orange-400';
    } else {
      colorClass = isActive ? 'bg-orange-400 glow' : 'bg-transparent';
    }

    return (
      <div onClick={onClick} className="flex flex-col items-center cursor-pointer">
        <div className={`w-8 h-2 mb-1 rounded-sm transition-all duration-300 ${colorClass}`} />
        <button
          className="text-white bg-[#333] w-16 h-[60px] rounded-md font-bold"
          style={{ fontSize: type === 'main' ? '1.2rem' : '0.65rem' }}
        >
          {label}
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white p-6">
      <audio ref={audioRef} hidden />
      <h1 className="text-3xl font-bold text-center mb-4">🎧 PSR MANAGER STYLE</h1>

      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#2a2a2a] p-4 rounded-xl shadow-inner">
          {leftColumn.length === 0 ? (
            <p className="text-gray-400 text-center">Aucun beat disponible</p>
          ) : (
            leftColumn.map(renderBeatCard)
          )}
        </div>
        <div className="bg-[#2a2a2a] p-4 rounded-xl shadow-inner">
          {rightColumn.length === 0 ? (
            <p className="text-gray-400 text-center">Rien à afficher</p>
          ) : (
            rightColumn.map(renderBeatCard)
          )}
        </div>
      </div>

      {beats.length > ITEMS_PER_PAGE && (
        <div className="flex justify-center mb-6">
          <button
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded font-bold"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={startIndex + ITEMS_PER_PAGE >= beats.length}
          >
            ➔ SUIVANT
          </button>
        </div>
      )}

      {selectedBeat && (
        <div className="bg-[#2a2a2a] p-4 rounded-xl text-center space-y-3">
          <h2 className="text-xl font-semibold">{selectedBeat.title}</h2>
          <p className="text-gray-400">Tempo : {selectedBeat.tempo} BPM</p>
          <p className="text-gray-400">Signature : {selectedBeat.signature}</p>
          <p className="text-gray-400">Description : {selectedBeat.description || 'Aucune'}</p>

          <div className="flex flex-nowrap overflow-x-auto justify-center gap-2 mt-6 bg-[#1c1c1c] p-3 rounded-lg">
            {renderButton('acmp', 'ACMP', controls.acmp, () => handleControlClick('acmp'))}
            {renderButton('autofill', 'AUTO-FILL', controls.autofill, () => handleControlClick('autofill'))}
            {['A', 'B', 'C', 'D'].map((i) => renderButton('intro', `INTRO ${i}`, controls.intro === i, () => handleControlClick('intro', i)))}
            {['A', 'B', 'C', 'D'].map((m) => renderButton('main', m, controls.main === m, () => handleControlClick('main', m), mainBlinking === m))}
            {['A', 'B', 'C', 'D'].map((i) => renderButton('ending', `END ${i}`, controls.ending === i, () => handleControlClick('ending', i)))}

            <div className="flex flex-col items-center cursor-pointer" onClick={() => handleControlClick('play')}>
              <div
                className={`w-8 h-2 mb-1 rounded-sm ${
                  playColor === 'blue' ? 'bg-blue-500 glow' :
                  playColor === 'orange' ? 'bg-orange-400 glow' : 'bg-black'
                }`}
              />
              <button
                className="text-[10px] bg-gray-300 hover:bg-gray-400 text-black w-16 h-[60px] rounded-md font-bold"
                disabled={isLoading}
              >
                {isLoading ? '⏳' : controls.play ? '⏹ STOP' : '▶️ PLAY'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!selectedBeat && (
        <p className="text-red-500 text-center mt-4 font-semibold">
          🎵 Veuillez sélectionner un beat avant de lancer la lecture.
        </p>
      )}

      <style>
        {`
          .animate-orange-blue-blink {
            animation: blink-orange-blue 0.4s steps(1, end) infinite;
          }

          @keyframes blink-orange-blue {
            0%, 100% { background-color: #f97316; }
            50% { background-color: #3b82f6; }
          }

          .glow {
            box-shadow: 0 0 8px 3px currentColor;
          }
        `}
      </style>
    </div>
  );
}
