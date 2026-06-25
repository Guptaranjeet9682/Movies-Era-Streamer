import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();
  const { play } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerData, setPlayerData] = useState(null);
  const [selectedServer, setSelectedServer] = useState('1');
  const [embedUrl, setEmbedUrl] = useState('');

  // Load preferred server from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('preferredServer');
      if (saved) setSelectedServer(saved);
    }
  }, []);

  // Fetch player data
  useEffect(() => {
    if (!play) {
      setLoading(false);
      return;
    }

    fetch(`/api/player?code=${play}`)
      .then(res => {
        if (!res.ok) {
          return res.json().then(data => { throw new Error(data.error || 'Failed to load'); });
        }
        return res.json();
      })
      .then(data => {
        setPlayerData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [play]);

  // Build embed URL
  useEffect(() => {
    if (!playerData) return;
    const { contentId, type, season, episode } = playerData;
    const serverUrl = selectedServer === '1'
      ? process.env.NEXT_PUBLIC_STREAMER1 || 'https://vaplayer.ru'
      : process.env.NEXT_PUBLIC_STREAMER2 || 'https://vidsrc-embed.ru';
    let base = serverUrl;
    let path = type === 'movie'
      ? `/embed/movie/${contentId}`
      : `/embed/tv/${contentId}/${season}/${episode}`;
    setEmbedUrl(`${base}${path}`);
  }, [playerData, selectedServer]);

  const switchServer = (server) => {
    setSelectedServer(server);
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferredServer', server);
    }
  };

  // Block popups and redirects
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.open = function() { return null; };
    const preventNewWindow = (e) => {
      const target = e.target.closest('a');
      if (target && target.target === '_blank') {
        e.preventDefault();
        return false;
      }
    };
    document.addEventListener('click', preventNewWindow);
    window.location.replace = function() {};
    window.location.assign = function() {};
    return () => document.removeEventListener('click', preventNewWindow);
  }, []);

  const handleIframeError = () => {
    if (selectedServer === '1') switchServer('2');
  };

  if (!play) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Movies Era Streamer</h1>
          <p className="text-gray-400">Use a valid play link to start streaming.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-black text-white text-xl">Loading player...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="text-red-500 text-2xl mb-2">⛔ Error</div>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!playerData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="text-red-500 text-2xl mb-2">⛔ Invalid Link</div>
          <p>The link you followed may be expired or invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-4 bg-gray-900 shadow-md flex flex-wrap items-center justify-between">
        <h1 className="text-xl font-semibold truncate">{playerData.title}</h1>
        <div className="flex space-x-2 mt-2 sm:mt-0">
          <button
            onClick={() => switchServer('1')}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              selectedServer === '1' ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            Server 1
          </button>
          <button
            onClick={() => switchServer('2')}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              selectedServer === '2' ? 'bg-red-600 text-white' : 'bg-gray-700 hover:bg-gray-600'
            }`}
          >
            Server 2
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 flex items-center justify-center">
        <div className="w-full max-w-5xl aspect-video bg-gray-800 rounded-lg overflow-hidden shadow-2xl relative">
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-forms"
            onError={handleIframeError}
            title="Video Player"
          />
        </div>
      </main>

      <footer className="p-2 text-center text-gray-500 text-sm">
        {playerData.premium ? '🔒 Premium (unlimited)' : '🔓 Standard (2 views)'}
      </footer>
    </div>
  );
}
