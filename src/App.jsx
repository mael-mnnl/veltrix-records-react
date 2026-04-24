import React, { useState, useEffect, useCallback, useRef } from 'react';
import CuratorApp from './curator/App';
import Particles from "react-tsparticles";
import { loadSlim } from "tsparticles-slim";
import { motion, AnimatePresence } from "framer-motion";
import Lenis from 'lenis';
import { particlesOptions } from './config/particlesConfig';
import './styles/App.css';

// --- IMPORTS IMAGES ---
import logoImg from './assets/logovtx.png';
import pxroducerImg from './assets/pxroducer.png';
import axelitohmnImg from './assets/axelitohmn.jpg';
import confessImg from './assets/confess.png';
import badhappeningImg from './assets/badhappenning.png';
import nobatidaoImg from './assets/nobatidao.png';
import gozaloImg from './assets/gozalo.png';
import dirtyshoesImg from './assets/dirtyshoes.png';
import top100phonkImg from './assets/top100phonk.png';
import millionairemodeImg from './assets/millionairemode.png';
import miauImg from './assets/miau.png';
import perfectgirlImg from './assets/perfectgirl.png';
import amostraImg from './assets/amostra.png';

// --- IMPORTS AUDIO ---
import cinderellaTrack from './assets/audio/CINDERELLA.mp3';
import discordTrack from './assets/audio/DISCORD.mp3';
import doorsTrack from './assets/audio/DOORS.mp3';
import engradaTrack from './assets/audio/ENGRADA.mp3';
import radianteTrack from './assets/audio/RADIANTE.mp3';

// ─────────────────────────────────────────────
// MAGNETIC
// ─────────────────────────────────────────────
const Magnetic = ({ children }) => {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isTouchDevice = useRef(
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
  const handleMouse = (e) => {
    if (isTouchDevice.current) return;
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    setPosition({ x: (clientX - (left + width / 2)) * 0.15, y: (clientY - (top + height / 2)) * 0.15 });
  };
  const reset = () => setPosition({ x: 0, y: 0 });
  return (
    <motion.div ref={ref} onMouseMove={handleMouse} onMouseLeave={reset}
      animate={position} transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      style={{ display: 'inline-block' }}>
      {children}
    </motion.div>
  );
};

// ─────────────────────────────────────────────
// MARQUEE
// ─────────────────────────────────────────────
const Marquee = ({ text }) => (
  <div className="marquee-container">
    <motion.div className="marquee-track"
      animate={{ x: [0, -1000] }}
      transition={{ repeat: Infinity, duration: 25, ease: "linear" }}>
      <span>{text} — {text} — {text} — </span>
    </motion.div>
  </div>
);

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
function App() {
  const particlesInit = useCallback(async engine => await loadSlim(engine), []);

  const isTouchDevice = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // ── SMOOTH SCROLL ──
  useEffect(() => {
    if (window.location.pathname.startsWith('/curator') || window.location.pathname === '/callback') return;
    const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  // ── CURSOR ──
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  // Ripple for touch
  const [ripples, setRipples] = useState([]);
  useEffect(() => {
    if (!isTouchDevice) {
      const move = (e) => {
        setCursorPos({ x: e.clientX, y: e.clientY });
        setHovered(['A', 'BUTTON', 'INPUT', 'TEXTAREA'].includes(e.target.tagName));
      };
      window.addEventListener('mousemove', move);
      return () => window.removeEventListener('mousemove', move);
    } else {
      const touch = (e) => {
        const t = e.touches[0];
        const id = Date.now();
        setRipples(r => [...r, { id, x: t.clientX, y: t.clientY }]);
        setTimeout(() => setRipples(r => r.filter(rp => rp.id !== id)), 600);
      };
      window.addEventListener('touchstart', touch);
      return () => window.removeEventListener('touchstart', touch);
    }
  }, [isTouchDevice]);

  // ── RADIO ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [showVolume, setShowVolume] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef(null);
  const volumeWrapRef = useRef(null);

  const radioPlaylist = [
    { title: "CINDERELLA", artist: "Veltrix Exclusive", src: cinderellaTrack },
    { title: "DISCORD",    artist: "Veltrix Exclusive", src: discordTrack },
    { title: "DOORS",      artist: "Veltrix Exclusive", src: doorsTrack },
    { title: "ENGRADA",    artist: "Veltrix Exclusive", src: engradaTrack },
    { title: "RADIANTE",   artist: "Veltrix Exclusive", src: radianteTrack },
  ];

  const toggleRadio = () => {
    if (isPlaying) audioRef.current.pause(); else audioRef.current.play();
    setIsPlaying(p => !p);
  };
  const nextTrack = () => setCurrentTrackIndex(p => (p + 1) % radioPlaylist.length);
  const prevTrack = () => setCurrentTrackIndex(p => p === 0 ? radioPlaylist.length - 1 : p - 1);
  useEffect(() => { if (isPlaying) audioRef.current.play().catch(() => {}); }, [currentTrackIndex]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // Audio time update
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    setAudioProgress(audioRef.current.currentTime);
    setAudioDuration(audioRef.current.duration || 0);
  };
  const handleSeek = (e) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = ratio * audioDuration;
  };

  // Click outside volume
  useEffect(() => {
    if (!showVolume) return;
    const handler = (e) => {
      if (volumeWrapRef.current && !volumeWrapRef.current.contains(e.target)) {
        setShowVolume(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showVolume]);

  // ── TOAST ──
  const [toasts, setToasts] = useState([]);
  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  // ── FORM ──
  const [formData, setFormData] = useState({ artist: '', title: '', link: '', contact: '' });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const handleSubmit = (e) => {
    e.preventDefault();
    const { title, artist, link, contact } = formData;
    const subject = encodeURIComponent('New Veltrix Demo Submission');
    const body = encodeURIComponent(`Title: ${title}\nArtist: ${artist}\nLink: ${link}\nContact: ${contact}`);
    const mob = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
    if (mob) window.location.href = `mailto:veltrixdemo@gmail.com?subject=${subject}&body=${body}`;
    else window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=veltrixdemo@gmail.com&su=${subject}&body=${body}`, '_blank');
    addToast("DEMO SENT ✓ — We'll be in touch.");
    setFormData({ artist: '', title: '', link: '', contact: '' });
  };

  // ── SCROLL PROGRESS ──
  const [scrollProgress, setScrollProgress] = useState(0);
  useEffect(() => {
    const h = () => {
      const total = document.documentElement.scrollTop;
      const win = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      setScrollProgress(total / win);
    };
    window.addEventListener('scroll', h);
    return () => window.removeEventListener('scroll', h);
  }, []);

  // ── MOBILE MENU ──
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

  // ── DATA ──
  const playlists = [
    { id: '01', name: 'CONFESS PLAYLIST',    link: 'https://open.spotify.com/playlist/70yxbbN9TWzybcRq3BKnQi', img: confessImg },
    { id: '02', name: 'BAD HAPPENING',       link: 'https://open.spotify.com/playlist/5rtWccfLieWNpeUMdfrC4m', img: badhappeningImg },
    { id: '03', name: 'NO BATIDÃO',          link: 'https://open.spotify.com/playlist/6hY8ougu8uNgcJ2cnuBVla', img: nobatidaoImg },
    { id: '04', name: 'GOZALO',              link: 'https://open.spotify.com/playlist/3w3i91jtb9qwJK7epHGDq9', img: gozaloImg },
    { id: '05', name: 'DIRTY SHOES',         link: 'https://open.spotify.com/playlist/307jWAzi3gIjYpQ0jVl2LJ', img: dirtyshoesImg },
    { id: '06', name: 'TOP 100 VIRAL PHONK', link: 'https://open.spotify.com/playlist/1Zkue3HQqFrQabZZFrdgfx', img: top100phonkImg },
    { id: '07', name: 'MILLIONAIRE MODE',    link: 'https://open.spotify.com/playlist/2xJyQdJYQASidY6KQpciCE', img: millionairemodeImg },
    { id: '08', name: 'MONTAGEM MIAU',       link: 'https://open.spotify.com/playlist/23eMxh0hLd9uFMzRVcUuwy', img: miauImg },
    { id: '09', name: 'PERFECT GIRL',        link: 'https://open.spotify.com/playlist/3qgRDXrPiqACP5A8KyWLTB', img: perfectgirlImg },
    { id: '10', name: 'MONTAGEM AMOSTRA',    link: 'https://open.spotify.com/playlist/2M5btLtcNbl7XNO3mqSZm5', img: amostraImg },
  ];

  const starterFeatures = [
    { icon: '◈', label: 'VTX Bot',      detail: 'Discord automation, A&R voting, demo submissions, release announcements' },
    { icon: '◈', label: 'VTX Forms',    detail: 'Branded release submission portal — no more Google Forms' },
    { icon: '◈', label: 'VTX Links',    detail: 'Smart multi-link per release (Spotify, Apple Music, Deezer…)' },
    { icon: '◈', label: 'VTX Calendar', detail: 'Shared release planning with your team, deadline tracking' },
    { icon: '◈', label: 'Discord support', detail: '' },
  ];

  const proFeatures = [
    { icon: '◈', label: 'Everything in Starter', detail: '', gold: true },
    { icon: '◈', label: 'VTX Site',         detail: 'Custom label website on vtxplatform.com or your own domain', gold: true },
    { icon: '◈', label: 'VTX Promo',        detail: 'Auto-generated Instagram posts, stories & banners per release', gold: true },
    { icon: '◈', label: 'VTX Royalties',    detail: 'CSV split parsing, monthly statements, artist earnings portals', gold: true },
    { icon: '◈', label: 'VTX Contracts',    detail: 'One-click split agreements — signed, stored as PDF', gold: true },
    { icon: '◈', label: 'VTX Artist Portal',detail: 'Each artist gets their own login, white-labeled with your branding', gold: true },
    { icon: '◈', label: 'Priority support', detail: '', gold: true },
  ];

  const fadeInUp = { hidden: { opacity: 0, y: 60 }, visible: { opacity: 1, y: 0, transition: { duration: 1 } } };
  const staggerContainer = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };

  const navItems = [
    { href: '#about',     label: 'About' },
    { href: '#owners',    label: 'Team' },
    { href: '#playlists', label: 'Playlists' },
    { href: '#services',  label: 'Services' },
    { href: '#demo',      label: 'Submit' },
    { href: 'https://www.veltrix-records.com/curator', label: 'CuratorOS', external: true },
  ];

  const progressPct = audioDuration ? (audioProgress / audioDuration) * 100 : 0;

  if (window.location.pathname.startsWith('/curator') || window.location.pathname === '/callback') {
    document.body.style.cursor = 'auto';
    return <CuratorApp />;
  }

  return (
    <div className="app-container cursor-none">

      {/* ── TOUCH RIPPLES ── */}
      {isTouchDevice && ripples.map(r => (
        <motion.div key={r.id} className="touch-ripple"
          style={{ left: r.x, top: r.y }}
          initial={{ scale: 0, opacity: 0.6 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }} />
      ))}

      {/* ── TOASTS ── */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id}
              className={`toast toast-${t.type}`}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.3 }}>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* SCROLL PROGRESS */}
      <div className="progress-bar-wrapper">
        <div className="progress-bar-fill" style={{ transform: `scaleX(${scrollProgress})` }} />
      </div>

      <div className="noise-overlay"></div>

      {/* CURSOR */}
      {!isTouchDevice && (
        <div className={`custom-cursor ${hovered ? 'hovered' : ''}`}
          style={{ left: cursorPos.x, top: cursorPos.y }} />
      )}

      {/* ── RADIO BAR ── */}
      <div className="radio-bar">
        <div className="radio-controls">
          <Magnetic><button className="control-btn" onClick={prevTrack}>|◁</button></Magnetic>
          <Magnetic><button className="control-btn play-btn" onClick={toggleRadio}>{isPlaying ? "❚❚" : "▶"}</button></Magnetic>
          <Magnetic><button className="control-btn" onClick={nextTrack}>▷|</button></Magnetic>
        </div>

        <div className="radio-center">
          <div className="radio-info">
            <span className="track-title">{radioPlaylist[currentTrackIndex].title}</span>
            <span className="track-artist">{radioPlaylist[currentTrackIndex].artist}</span>
          </div>
          {/* PROGRESS BAR */}
          <div className="audio-progress-wrap" onClick={handleSeek} title="Seek">
            <div className="audio-progress-track">
              <div className="audio-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="audio-time">
              {formatTime(audioProgress)} / {formatTime(audioDuration)}
            </div>
          </div>
        </div>

        {/* VOLUME */}
        <div className="volume-wrap" ref={volumeWrapRef}>
          <Magnetic>
            <button className="control-btn volume-icon-btn"
              onClick={() => setShowVolume(v => !v)} title="Volume">
              {volume === 0 ? '🔇' : volume < 0.4 ? '🔈' : volume < 0.75 ? '🔉' : '🔊'}
            </button>
          </Magnetic>
          <AnimatePresence>
            {showVolume && (
              <motion.div className="volume-popup"
                initial={{ opacity: 0, y: 8, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.92 }}
                transition={{ duration: 0.18 }}>
                <span className="vol-label">VOL</span>
                <input type="range" min="0" max="1" step="0.02"
                  value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="vol-range"
                  style={{ '--vol': `${Math.round(volume * 100)}%` }} />
                <span className="vol-pct">{Math.round(volume * 100)}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <audio ref={audioRef} src={radioPlaylist[currentTrackIndex].src}
          onEnded={nextTrack} onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleTimeUpdate} />
      </div>

      <Particles id="tsparticles" init={particlesInit} options={particlesOptions} />

      {/* NAVBAR */}
      <nav className="navbar">
        <div className="nav-brand">VELTRIX RECORDS</div>
        <div className="nav-links">
          {navItems.map(item => (
            <Magnetic key={item.href}>
              <a href={item.href} {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={item.external ? { color: '#1DB954', fontWeight: 700 } : {}}>
                {item.label}
              </a>
            </Magnetic>
          ))}
        </div>
        <button className={`nav-hamburger ${mobileMenuOpen ? 'open' : ''}`}
          onClick={() => setMobileMenuOpen(v => !v)} aria-label="Menu">
          <span /><span /><span />
        </button>
      </nav>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div className="mobile-menu"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
            {navItems.map((item, i) => (
              <motion.a key={item.href} href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                style={item.external ? { color: '#1DB954', fontWeight: 700 } : {}}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}>
                {item.label}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO */}
      <header className="hero">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.5 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '48px' }}>
          <img src={logoImg} alt="Veltrix Logo" className="main-logo" loading="eager" />
          <motion.a href="#demo" className="hero-submit-btn"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0, boxShadow: ['0 0 0px rgba(255,255,255,0.0)', '0 0 22px rgba(255,255,255,0.18)', '0 0 0px rgba(255,255,255,0.0)'] }}
            transition={{ opacity: { delay: 1.2, duration: 0.8 }, y: { delay: 1.2, duration: 0.8 }, boxShadow: { delay: 2, duration: 2.4, repeat: Infinity, ease: 'easeInOut' } }}
            whileHover={{ scale: 1.06, backgroundColor: '#ffffff', color: '#000' }}
            whileTap={{ scale: 0.97 }}
            onClick={e => { e.preventDefault(); document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <motion.span animate={{ y: [0, 4, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ display: 'inline-block', marginRight: '10px' }}>↓</motion.span>
            SUBMIT YOUR DEMO
          </motion.a>
        </motion.div>
        <motion.div className="scroll-indicator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}>
          <span>MAKING HITS GO VIRAL</span>
          <div className="line"></div>
        </motion.div>
      </header>

      {/* CURATOR NOTICE */}
      <div style={{
        textAlign: 'center', padding: '18px 24px',
        background: 'rgba(29,185,84,0.06)', borderTop: '1px solid rgba(29,185,84,0.15)', borderBottom: '1px solid rgba(29,185,84,0.15)',
        fontSize: '13px', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em',
      }}>
        <span style={{ color: '#1DB954', fontWeight: 700 }}>CuratorOS</span>
        {' '}is reserved for Veltrix Records members only — it will not work unless you have been personally invited by{' '}
        <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>pxroducer</span>.
      </div>

      {/* MARQUEE */}
      <div className="marquee-section">
        <Marquee text="VELTRIX RECORDS • SHAPE THE NOISE • SUBMIT YOUR DEMO • VIRAL HITS ONLY •" />
      </div>

      {/* ABOUT */}
      <section id="about" className="section-padding">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
          <h2 className="section-title">INFO</h2>
          <div className="story-text">
            <p>Founded in 2025 by two passionate Frenchmen.</p>
            <p>We focus on promoting and discovering new viral hits.</p>
            <p className="small-text-block">Veltrix is a team of marketing, A&R, and designers — we know how to make your music blow up.</p>
          </div>

        </motion.div>
      </section>

      {/* OWNERS */}
      <section id="owners" className="section-padding">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <h2 className="section-title">THE OWNERS</h2>
          <div className="owners-grid">
            <motion.div className="owner-card" variants={fadeInUp}>
              <div className="owner-img-container">
                <img src={pxroducerImg} alt="pxroducer" loading="lazy" />
              </div>
              <h3>pxroducer</h3>
              <p>"I make music, and it's one of my biggest passions."</p>
              <div className="owner-socials"><a href="https://youtube.com/@pxroducer">YouTube</a></div>
            </motion.div>
            <motion.div className="owner-card" variants={fadeInUp}>
              <div className="owner-img-container">
                <img src={axelitohmnImg} alt="Axelitohmn" loading="lazy" />
              </div>
              <h3>Axelitohmn</h3>
              <p>"We're all going to do our best."</p>
              <div className="owner-socials"><a href="https://youtube.com/@axelitohmn">YouTube</a></div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* PLAYLISTS */}
      <section id="playlists" className="section-padding">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <h2 className="section-title">OUR BIGGEST PLAYLISTS</h2>
          <div className="playlist-grid">
            {playlists.map((playlist) => (
              <motion.a key={playlist.id} href={playlist.link} target="_blank"
                className="playlist-item" variants={fadeInUp}>
                <div className="pl-image-layer">
                  <img src={playlist.img} alt={playlist.name} loading="lazy" />
                </div>
                <div className="pl-content-layer">
                  <div className="pl-number">{playlist.id}</div>
                  <div className="pl-info">
                    <span className="pl-name">{playlist.name}</span>
                    <span className="pl-arrow">LISTEN ↗</span>
                  </div>
                </div>
              </motion.a>
            ))}
          </div>
        </motion.div>
      </section>

      {/* VTX SERVICES */}
      <section id="services" className="section-padding services-section">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <div className="services-title-row">
            <h2 className="section-title">VTX SERVICES</h2>
            <span className="coming-soon-badge">COMING SOON</span>
          </div>
          <motion.div className="services-intro" variants={fadeInUp}>
            <p className="services-tagline">One account. Every tool your label needs.</p>
            <p className="services-sub">Stop paying for 5–10 tools that don't talk to each other. VTX brings everything into one platform — built by label owners, for label owners. No commission on your royalties. Cancel anytime.</p>
          </motion.div>

          <div className="plans-grid">
            <motion.div className="plan-card" variants={fadeInUp}>
              <div className="plan-header">
                <span className="plan-badge">STARTER</span>
                <div className="plan-price"><span className="price-amount">9.99€</span><span className="price-period">/mo</span></div>
              </div>
              <p className="plan-desc">Everything you need to launch your label professionally.</p>
              <ul className="plan-features">
                {starterFeatures.map((f, i) => (
                  <li key={i}>
                    <span className="feat-icon">{f.icon}</span>
                    <span className="feat-text"><strong>{f.label}</strong>{f.detail && <em> — {f.detail}</em>}</span>
                  </li>
                ))}
              </ul>
              <div className="plan-cta"><Magnetic><span className="plan-btn plan-btn-outline plan-btn-disabled">COMING SOON</span></Magnetic></div>
            </motion.div>

            <motion.div className="plan-card plan-card-featured" variants={fadeInUp}>
              <div className="plan-glow"></div>
              <div className="plan-header">
                <span className="plan-badge plan-badge-gold">PRO ★ RECOMMENDED</span>
                <div className="plan-price"><span className="price-amount price-gold">19.99€</span><span className="price-period">/mo</span></div>
              </div>
              <p className="plan-desc">Your label looks like a major. Every tool, fully integrated.</p>
              <ul className="plan-features">
                {proFeatures.map((f, i) => (
                  <li key={i}>
                    <span className={`feat-icon ${f.gold ? 'feat-gold' : ''}`}>{f.icon}</span>
                    <span className="feat-text"><strong>{f.label}</strong>{f.detail && <em> — {f.detail}</em>}</span>
                  </li>
                ))}
              </ul>
              <div className="plan-cta"><Magnetic><span className="plan-btn plan-btn-filled plan-btn-disabled">COMING SOON</span></Magnetic></div>
            </motion.div>
          </div>

          <motion.div className="modules-row" variants={staggerContainer}>
            {[
              { name: 'VTX BOT',      desc: 'Discord bot for demo submissions, A&R voting, automated channels & release announcements.' },
              { name: 'VTX FORMS',    desc: 'Branded release submission forms. Files stored in your dashboard. No more Google Forms.' },
              { name: 'VTX SITE',     desc: 'Template-based label website. Your logo, your colors. Hosted on vtxplatform.com or your domain.' },
              { name: 'VTX LINKS',    desc: 'One smart link per release redirecting to Spotify, Apple Music, Deezer. Branded. No extra sub.' },
              { name: 'VTX PROMO',    desc: 'Auto-generated Instagram posts, stories & banners from your cover art. Instant.' },
              { name: 'VTX ROYALTIES',desc: 'Upload DistroKid / TuneCore CSV. Splits calculated, statements sent, artist portals live.' },
            ].map((mod, i) => (
              <motion.div className="module-item" key={i} variants={fadeInUp}>
                <span className="module-num">0{i + 1}</span>
                <div className="module-body"><h4>{mod.name}</h4><p>{mod.desc}</p></div>
              </motion.div>
            ))}
          </motion.div>

          <motion.p className="services-footnote" variants={fadeInUp}>
            First month free for early adopters · No credit card required · No commission · Cancel anytime
          </motion.p>
        </motion.div>
      </section>

      {/* DEMO FORM */}
      <section id="demo" className="section-padding">
        <motion.div className="content-wrapper small-width" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
          <h2 className="section-title">SUBMIT DEMO</h2>
          <form onSubmit={handleSubmit} className="minimal-form">
            <div className="input-wrap"><input type="text" name="title" placeholder="TRACK TITLE" value={formData.title} onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="text" name="artist" placeholder="ARTIST NAME" value={formData.artist} onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="url" name="link" placeholder="DEMO LINK" value={formData.link} onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="text" name="contact" placeholder="CONTACT" value={formData.contact} onChange={handleChange} required /></div>
            <Magnetic><button type="submit" className="submit-btn">SEND TO VELTRIX</button></Magnetic>
          </form>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer className="footer-section">
        <motion.div className="footer-content" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <div className="social-grid">
            <Magnetic>
              <a href="https://www.instagram.com/veltrix.records" target="_blank" aria-label="Instagram">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
              </a>
            </Magnetic>
            <Magnetic>
              <a href="https://www.tiktok.com/@veltrix.records" target="_blank" aria-label="TikTok">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93v6.16c0 2.52-1.12 4.84-2.9 6.48-1.48 1.39-3.52 2.16-5.63 2.15-4.78.03-8.8-4.01-8.58-9.09.18-4.17 3.44-7.58 7.55-7.9v4.02c-2.45.28-4.22 2.45-3.87 4.92.29 2.06 2.07 3.53 4.15 3.49 1.91-.03 3.63-1.45 3.99-3.32.09-.45.09-.91.09-1.37V.02z"/></svg>
              </a>
            </Magnetic>
            <Magnetic>
              <a href="https://discord.gg/xK4A3Tpkdw" target="_blank" aria-label="Discord">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
              </a>
            </Magnetic>
            <Magnetic>
              <a href="https://www.youtube.com/@veltrix.records" target="_blank" aria-label="YouTube">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
            </Magnetic>
          </div>
          <div className="footer-bottom">
            <span>© 2025 VELTRIX RECORDS</span>
            <span>ALL RIGHTS RESERVED</span>
            <span>FRANCE</span>
          </div>
        </motion.div>
      </footer>

    </div>
  );
}

// ── HELPERS ──
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default App;