import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  addDoc, 
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  MapPin, 
  Calendar, 
  Train, 
  Plus, 
  Trash2, 
  Map as MapIcon, 
  Search,
  Clock,
  Navigation2,
  X,
  Zap,
  Camera,
  ShoppingBag,
  Info,
  Compass,
  ArrowRight,
  Loader2
} from 'lucide-react';

// --- Firebase Konfiguration ---
// Diese Werte werden in der Vercel-Umgebung automatisch bereitgestellt
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cologne-vercel-app';
const apiKey = ""; // Wird zur Laufzeit gesetzt

// --- Vordefinierte Spots für 14-Jährige ---
const MASTER_SPOTS = [
  { id: 's1', name: 'Ehrenfeld Street Art', cat: 'Vibe', lat: 50.9472, lng: 6.9189, desc: 'Beste Graffitis & Fotospots.', neighborhood: 'Ehrenfeld' },
  { id: 's2', name: 'Picknweight Vintage', cat: 'Shopping', lat: 50.9392, lng: 6.9365, desc: 'Vintage Klamotten nach Kilo.', neighborhood: 'Belgisches Viertel' },
  { id: 's3', name: 'Hohenzollernbrücke', cat: 'Insta', lat: 50.9413, lng: 6.9644, desc: 'Die klassische Love-Lock-Brücke.', neighborhood: 'Altstadt-Nord' },
  { id: 's4', name: 'Kap 676 Skatepark', cat: 'Chill', lat: 50.9231, lng: 6.9667, desc: 'Skaten & Chillen am Rhein.', neighborhood: 'Rheinauhafen' },
  { id: 's5', name: 'Cologne Beach Club', cat: 'Vibe', lat: 50.9475, lng: 6.9715, desc: 'Sand & Skyline-Blick.', neighborhood: 'Deutz' }
];

const App = () => {
  const [user, setUser] = useState(null);
  const [tripId, setTripId] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [activeTab, setActiveTab] = useState('itinerary');
  const [myRole, setMyRole] = useState('Tochter');
  
  const [itinerary, setItinerary] = useState([]);
  const [locations, setLocations] = useState([]);
  const [currentPos, setCurrentPos] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // --- Auth & Sync Logik ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isJoined) return;

    // Zeitplan Synchronisation
    const unsubItin = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', `itin_${tripId}`),
      (snap) => {
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setItinerary(items.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00')));
      },
      (err) => console.error("Firestore Error:", err)
    );

    // Standort Synchronisation
    const unsubLocs = onSnapshot(
      collection(db, 'artifacts', appId, 'public', 'data', `loc_${tripId}`),
      (snap) => setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Location Error:", err)
    );

    // Live GPS Tracking
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCurrentPos(coords);
        setDoc(doc(db, 'artifacts', appId, 'public', 'data', `loc_${tripId}`, user.uid), {
          name: myRole,
          ...coords,
          updatedAt: Date.now()
        });
      },
      (err) => console.warn("GPS nicht verfügbar"),
      { enableHighAccuracy: true }
    );

    return () => { unsubItin(); unsubLocs(); navigator.geolocation.clearWatch(watchId); };
  }, [user, isJoined, tripId, myRole]);

  // --- Event Suche via Gemini ---
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Suche coole Events oder Orte für Teenager (14 Jahre) in Köln. Suchbegriff: ${searchQuery}. Gib die Ergebnisse als JSON-Liste zurück mit: name, description, category, recommended_time.` }] }],
          tools: [{ "google_search": {} }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = await response.json();
      const results = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
      setSearchResults(Array.isArray(results) ? results : (results.events || []));
    } catch (e) {
      console.error("Suche fehlgeschlagen", e);
    } finally {
      setIsSearching(false);
    }
  };

  const addToPlan = async (spot) => {
    if (!user) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', `itin_${tripId}`), {
      name: spot.name,
      category: spot.cat || spot.category || 'Event',
      time: spot.recommended_time || "12:00",
      notes: spot.desc || spot.description || "",
      order: Date.now()
    });
    setActiveTab('itinerary');
  };

  const removeFromPlan = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', `itin_${tripId}`, id));
  };

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-8 font-sans">
        <div className="w-full max-w-sm space-y-10 animate-in fade-in duration-700">
          <div className="text-center space-y-4">
            <div className="w-24 h-24 bg-gradient-to-tr from-indigo-600 to-purple-500 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl rotate-6">
              <Compass size={48} className="text-white" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter">KÖLN SYNC</h1>
            <p className="text-slate-400 font-medium">Der Vercel Trip-Planer</p>
          </div>
          
          <div className="bg-slate-900/50 p-6 rounded-3xl border border-slate-800 space-y-4 backdrop-blur-md">
            <input 
              type="text" placeholder="TRIP-CODE (z.B. PAPA-LISA)"
              className="w-full bg-slate-800 border-none p-5 rounded-2xl text-center font-mono tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none uppercase transition-all"
              value={tripId} onChange={(e) => setTripId(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setMyRole('Vater')} className={`p-4 rounded-2xl font-bold border-2 transition-all ${myRole === 'Vater' ? 'bg-indigo-600 border-indigo-400' : 'bg-slate-800 border-transparent text-slate-400'}`}>👨 Vater</button>
              <button onClick={() => setMyRole('Tochter')} className={`p-4 rounded-2xl font-bold border-2 transition-all ${myRole === 'Tochter' ? 'bg-indigo-600 border-indigo-400' : 'bg-slate-800 border-transparent text-slate-400'}`}>👧 Tochter</button>
            </div>
            <button 
              disabled={!tripId}
              onClick={() => setIsJoined(true)} 
              className="w-full bg-white text-black py-5 rounded-3xl font-black text-xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
            >
              Starten
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-28 font-sans">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl sticky top-0 z-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-200">
            <Zap size={18} />
          </div>
          <h2 className="font-black tracking-tighter uppercase">{tripId}</h2>
        </div>
        <div className="flex -space-x-2">
          {locations.map(l => (
            <div key={l.id} className={`w-10 h-10 rounded-full border-2 border-white flex items-center justify-center text-xl shadow-md ${l.name === 'Vater' ? 'bg-blue-100' : 'bg-pink-100'}`}>
              {l.name === 'Vater' ? '👨' : '👧'}
            </div>
          ))}
        </div>
      </header>

      <main className="p-6 max-w-xl mx-auto space-y-8">
        {activeTab === 'itinerary' && (
          <div className="space-y-6 animate-in slide-in-from-left duration-500">
            <h3 className="text-3xl font-black">Der Plan</h3>
            {itinerary.length === 0 ? (
              <div className="bg-white p-12 rounded-[40px] text-center border-2 border-dashed border-slate-200 space-y-4">
                <Calendar size={48} className="mx-auto text-slate-300" />
                <p className="text-slate-400 font-bold">Noch keine Pläne geschmiedet.</p>
                <button onClick={() => setActiveTab('explore')} className="text-indigo-600 font-black uppercase text-xs tracking-widest">Spots finden</button>
              </div>
            ) : (
              <div className="space-y-4">
                {itinerary.map((item, idx) => (
                  <div key={item.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-lg">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-black bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded uppercase tracking-widest">{item.category}</span>
                        <span className="text-[9px] font-bold text-slate-400"><Clock size={10} className="inline mr-1"/>{item.time} Uhr</span>
                      </div>
                      <h4 className="font-bold">{item.name}</h4>
                    </div>
                    <button onClick={() => removeFromPlan(item.id)} className="text-slate-200 hover:text-red-500 transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'explore' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-3xl font-black">Suchen</h3>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                <input 
                  type="text" placeholder="z.B. Bubble Tea, Street Art..."
                  className="w-full bg-white border-none p-4 pl-12 rounded-2xl shadow-sm focus:ring-2 focus:ring-indigo-500"
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <button 
                onClick={handleSearch} disabled={isSearching}
                className="bg-indigo-600 text-white px-6 rounded-2xl font-bold shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="animate-spin" size={24} /> : 'Suche'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {(searchResults.length > 0 ? searchResults : MASTER_SPOTS).map((spot, i) => (
                <div key={i} className="bg-white p-5 rounded-[2.5rem] shadow-sm border border-slate-100 flex justify-between items-center group active:scale-95 transition-all">
                  <div className="flex gap-4 items-center">
                    <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center">
                      {spot.cat === 'Shopping' ? <ShoppingBag className="text-pink-500"/> : spot.cat === 'Insta' ? <Camera className="text-red-500"/> : <Zap className="text-indigo-500"/>}
                    </div>
                    <div>
                      <h4 className="font-black text-slate-900 leading-tight">{spot.name}</h4>
                      <p className="text-xs text-slate-400 font-medium mt-1">{spot.desc || spot.description}</p>
                    </div>
                  </div>
                  <button onClick={() => addToPlan(spot)} className="bg-indigo-50 text-indigo-600 p-3 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all">
                    <Plus size={24} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'map' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <h3 className="text-3xl font-black italic">Live Karte</h3>
            <div className="bg-slate-200 h-[450px] rounded-[3rem] relative border-4 border-white shadow-2xl overflow-hidden">
              <div className="absolute inset-0 bg-indigo-50/20 grid grid-cols-10 grid-rows-10 opacity-30 pointer-events-none">
                {[...Array(100)].map((_, i) => <div key={i} className="border border-indigo-200/50"></div>)}
              </div>
              
              {/* Nutzer Icons auf der Karte */}
              {locations.map(loc => (
                <div 
                  key={loc.id} className="absolute transform -translate-x-1/2 -translate-y-1/2 z-20 transition-all duration-1000 ease-out"
                  style={{ 
                    top: loc.lat ? `${(50.96 - loc.lat) * 12000}%` : '50%', 
                    left: loc.lng ? `${(loc.lng - 6.91) * 2000}%` : '50%' 
                  }}
                >
                  <div className="flex flex-col items-center gap-1 group">
                    <div className="bg-white px-3 py-1 rounded-full text-[10px] font-black shadow-xl ring-2 ring-indigo-100">
                      {loc.name.toUpperCase()}
                    </div>
                    <div className={`w-8 h-8 rounded-full border-4 border-white shadow-2xl flex items-center justify-center animate-pulse ${loc.name === 'Vater' ? 'bg-indigo-600' : 'bg-pink-600'}`}>
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-6 left-6 right-6 h-20 bg-white/90 backdrop-blur-2xl border border-slate-100 rounded-[2.5rem] flex justify-around items-center px-4 shadow-2xl z-50">
        <button onClick={() => setActiveTab('itinerary')} className={`p-4 rounded-2xl transition-all ${activeTab === 'itinerary' ? 'text-indigo-600 bg-indigo-50 scale-110 shadow-sm' : 'text-slate-300'}`}>
          <Calendar size={28} />
        </button>
        <button onClick={() => setActiveTab('explore')} className={`p-4 rounded-2xl transition-all ${activeTab === 'explore' ? 'text-indigo-600 bg-indigo-50 scale-110 shadow-sm' : 'text-slate-300'}`}>
          <Search size={28} />
        </button>
        <button onClick={() => setActiveTab('map')} className={`p-4 rounded-2xl transition-all ${activeTab === 'map' ? 'text-indigo-600 bg-indigo-50 scale-110 shadow-sm' : 'text-slate-300'}`}>
          <MapIcon size={28} />
        </button>
        <button 
          onClick={() => { if (currentPos) window.open(`https://www.google.com/maps/search/KVB+Haltestelle/@${currentPos.lat},${currentPos.lng},16z`, '_blank'); }}
          className="p-4 rounded-2xl text-slate-300 hover:text-indigo-600"
        >
          <Train size={28} />
        </button>
      </nav>
    </div>
  );
};

export default App;
