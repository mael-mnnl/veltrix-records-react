import React, { useState, useEffect, useCallback, useRef } from 'react';
import Particles from "react-tsparticles";
import { loadSlim } from "tsparticles-slim";
import { motion, AnimatePresence } from "framer-motion";
import Lenis from 'lenis'; // Smooth Scroll
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

// --- COMPOSANT MAGNÉTIQUE (CORRIGÉ) ---
const Magnetic = ({ children }) => {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.15, y: middleY * 0.15 }); 
  };

  const reset = () => {
    setPosition({ x: 0, y: 0 });
  };

  const { x, y } = position;
  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x, y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      style={{ display: 'inline-block' }}
    >
      {children}
    </motion.div>
  );
};

// --- COMPOSANT MARQUEE (BANDEAU) ---
const Marquee = ({ text }) => {
  return (
    <div className="marquee-container">
      <motion.div 
        className="marquee-track"
        animate={{ x: [0, -1000] }}
        transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
      >
        <span>{text} — {text} — {text} — </span>
      </motion.div>
    </div>
  );
};

function App() {
  const particlesInit = useCallback(async engine => await loadSlim(engine), []);

  // 1. SMOOTH SCROLL
  useEffect(() => {
    const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smooth: true });
    function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  // 2. CURSOR LOGIC
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const moveCursor = (e) => {
      setCursorPosition({ x: e.clientX, y: e.clientY });
      const target = e.target;
      if (['A', 'BUTTON', 'INPUT', 'TEXTAREA'].includes(target.tagName)) setHovered(true);
      else setHovered(false);
    };
    window.addEventListener('mousemove', moveCursor);
    return () => window.removeEventListener('mousemove', moveCursor);
  }, []);

  // 3. RADIO LOGIC
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const audioRef = useRef(null);

  const radioPlaylist = [
    { title: "CINDERELLA", artist: "Veltrix Exclusive", src: cinderellaTrack },
    { title: "DISCORD", artist: "Veltrix Exclusive", src: discordTrack },
    { title: "DOORS", artist: "Veltrix Exclusive", src: doorsTrack },
    { title: "ENGRADA", artist: "Veltrix Exclusive", src: engradaTrack },
    { title: "RADIANTE", artist: "Veltrix Exclusive", src: radianteTrack },
  ];

  const toggleRadio = () => {
    if (isPlaying) audioRef.current.pause(); else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };
  const nextTrack = () => setCurrentTrackIndex((prev) => (prev + 1) % radioPlaylist.length);
  const prevTrack = () => setCurrentTrackIndex((prev) => prev === 0 ? radioPlaylist.length - 1 : prev - 1);
  useEffect(() => { if (isPlaying) audioRef.current.play().catch(e => console.log(e)); }, [currentTrackIndex]);

  // 4. SECRET ROOM & FORM
  const [showSecret, setShowSecret] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [formData, setFormData] = useState({ artist: '', title: '', link: '', contact: '' });

  const checkPassword = (e) => {
    e.preventDefault();
    if (password === "VTX2026") setUnlocked(true);
    else { alert("ACCESS DENIED"); setPassword(""); }
  };

  const handleChange = (e) => setFormData({...formData, [e.target.name]: e.target.value});
  const handleSubmit = (e) => {
    e.preventDefault();
    const { title, artist, link, contact } = formData;
    const subject = encodeURIComponent('New Veltrix Demo Submission');
    const body = encodeURIComponent(`Title: ${title}\nArtist: ${artist}\nLink: ${link}\nContact: ${contact}`);
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent);
    if (isMobile) window.location.href = `mailto:veltrixdemo@gmail.com?subject=${subject}&body=${body}`;
    else window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=veltrixdemo@gmail.com&su=${subject}&body=${body}`, '_blank');
  };

  // --- 5. SCROLL PROGRESS LOGIC (BARRE DE PROGRESSION) ---
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollTop;
      const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const scroll = `${totalScroll / windowHeight}`;
      setScrollProgress(Number(scroll));
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const playlists = [
    { id: '01', name: 'CONFESS PLAYLIST', link: 'https://open.spotify.com/playlist/70yxbbN9TWzybcRq3BKnQi?si=870263eed46345f1', img: confessImg },
    { id: '02', name: 'BAD HAPPENING', link: 'https://open.spotify.com/playlist/5rtWccfLieWNpeUMdfrC4m?si=05cc10eb74af4c98', img: badhappeningImg },
    { id: '03', name: 'NO BATIDÃO', link: 'https://open.spotify.com/playlist/6hY8ougu8uNgcJ2cnuBVla?si=182f473459534b45', img: nobatidaoImg },
    { id: '04', name: 'GOZALO', link: 'https://open.spotify.com/playlist/3w3i91jtb9qwJK7epHGDq9?si=83d0fc7d8fdd4f40', img: gozaloImg },
    { id: '05', name: 'DIRTY SHOES', link: 'https://open.spotify.com/playlist/307jWAzi3gIjYpQ0jVl2LJ?si=c4149364977d4e75', img: dirtyshoesImg },
    { id: '06', name: 'TOP 100 VIRAL PHONK', link: 'https://open.spotify.com/playlist/1Zkue3HQqFrQabZZFrdgfx?si=9c4604ffe04d439c', img: top100phonkImg },
    { id: '07', name: 'MILLIONAIRE MODE', link: 'https://open.spotify.com/playlist/2xJyQdJYQASidY6KQpciCE?si=8923289671434602', img: millionairemodeImg },
    { id: '08', name: 'MONTAGEM MIAU', link: 'https://open.spotify.com/playlist/23eMxh0hLd9uFMzRVcUuwy?si=81b1efc879c94d99', img: miauImg },
    { id: '09', name: 'PERFECT GIRL', link: 'https://open.spotify.com/playlist/3qgRDXrPiqACP5A8KyWLTB?si=223751e1228e481a', img: perfectgirlImg },
    { id: '10', name: 'MONTAGEM AMOSTRA', link: 'https://open.spotify.com/playlist/2M5btLtcNbl7XNO3mqSZm5?si=dd8bb7b203fd44d1', img: amostraImg },
  ];

  const fadeInUp = { hidden: { opacity: 0, y: 60 }, visible: { opacity: 1, y: 0, transition: { duration: 1 } } };
  const staggerContainer = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.1 } } };

  return (
    <div className="app-container">
      
      {/* --- C'EST ICI QU'ON AJOUTE LA BARRE DE PROGRESSION ! --- */}
      <div className="progress-bar-wrapper">
        <div 
          className="progress-bar-fill" 
          style={{ transform: `scaleX(${scrollProgress})` }} 
        />
      </div>

      <div className="noise-overlay"></div>
      <div className={`custom-cursor ${hovered ? 'hovered' : ''}`} style={{ left: cursorPosition.x, top: cursorPosition.y }}></div>

      {/* RADIO */}
      <div className="radio-bar">
        <div className="radio-controls">
           <Magnetic><button className="control-btn" onClick={prevTrack}>|◁</button></Magnetic>
           <Magnetic><button className="control-btn play-btn" onClick={toggleRadio}>{isPlaying ? "❚❚" : "▶"}</button></Magnetic>
           <Magnetic><button className="control-btn" onClick={nextTrack}>▷|</button></Magnetic>
        </div>
        <div className="radio-info">
          <span className="track-title">{radioPlaylist[currentTrackIndex].title}</span>
          <span className="track-artist">{radioPlaylist[currentTrackIndex].artist}</span>
        </div>
        <audio ref={audioRef} src={radioPlaylist[currentTrackIndex].src} onEnded={nextTrack} />
      </div>

      <Particles id="tsparticles" init={particlesInit} options={particlesOptions} />

      {/* NAVBAR MAGNÉTIQUE */}
      <nav className="navbar">
        <div className="nav-brand">VELTRIX RECORDS</div>
        <div className="nav-links">
          <Magnetic><a href="#about">About</a></Magnetic>
          <Magnetic><a href="#owners">Team</a></Magnetic>
          <Magnetic><a href="#playlists">Playlists</a></Magnetic>
          <Magnetic><a href="#demo">Submit</a></Magnetic>
        </div>
      </nav>

      {/* HERO */}
      <header className="hero">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.5 }}>
          <img src={logoImg} alt="Veltrix Logo" className="main-logo" />
        </motion.div>
        <motion.div className="scroll-indicator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}>
          <span>MAKING HITS GO VIRAL</span>
          <div className="line"></div>
        </motion.div>
      </header>

      {/* MARQUEE */}
      <div className="marquee-section">
        <Marquee text="VELTRIX RECORDS • SHAPE THE NOISE • SUBMIT YOUR DEMO • VIRAL HITS ONLY •" />
      </div>

      {/* SECTIONS */}
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

      <section id="owners" className="section-padding">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <h2 className="section-title">THE OWNERS</h2>
          <div className="owners-grid">
            <motion.div className="owner-card" variants={fadeInUp}>
              <div className="owner-img-container"><img src={pxroducerImg} alt="pxroducer" /></div>
              <h3>pxroducer</h3>
              <p>"I make music, and it's one of my biggest passions."</p>
              <div className="owner-socials"><a href="https://youtube.com/@pxroducer">YouTube</a></div>
            </motion.div>
            <motion.div className="owner-card" variants={fadeInUp}>
              <div className="owner-img-container"><img src={axelitohmnImg} alt="Axelitohmn" /></div>
              <h3>Axelitohmn</h3>
              <p>"We're all going to do our best."</p>
              <div className="owner-socials"><a href="https://youtube.com/@axelitohmn">YouTube</a></div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      <section id="playlists" className="section-padding">
        <motion.div className="content-wrapper" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <h2 className="section-title">OUR BIGGEST PLAYLISTS</h2>
          <div className="playlist-grid">
            {playlists.map((playlist) => (
              <motion.a key={playlist.id} href={playlist.link} target="_blank" className="playlist-item" variants={fadeInUp}>
                <div className="pl-image-layer"><img src={playlist.img} alt={playlist.name} /></div>
                <div className="pl-content-layer">
                  <div className="pl-number">{playlist.id}</div>
                  <div className="pl-info"><span className="pl-name">{playlist.name}</span><span className="pl-arrow">LISTEN ↗</span></div>
                </div>
              </motion.a>
            ))}
          </div>
        </motion.div>
      </section>

      <section id="demo" className="section-padding">
        <motion.div className="content-wrapper small-width" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeInUp}>
          <h2 className="section-title">SUBMIT DEMO</h2>
          <form onSubmit={handleSubmit} className="minimal-form">
            <div className="input-wrap"><input type="text" name="title" placeholder="TRACK TITLE" onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="text" name="artist" placeholder="ARTIST NAME" onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="url" name="link" placeholder="DEMO LINK" onChange={handleChange} required /></div>
            <div className="input-wrap"><input type="text" name="contact" placeholder="CONTACT" onChange={handleChange} required /></div>
            <Magnetic><button type="submit" className="submit-btn">SEND TO VELTRIX</button></Magnetic>
          </form>
        </motion.div>
      </section>

      <footer className="footer-section">
        <motion.div className="footer-content" initial="hidden" whileInView="visible" viewport={{ once: true }} variants={staggerContainer}>
          <div className="social-grid">
            {/* INSTAGRAM */}
            <Magnetic>
              <a href="https://www.instagram.com/veltrix.records" target="_blank" aria-label="Instagram">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
              </a>
            </Magnetic>

            {/* TIKTOK */}
            <Magnetic>
              <a href="https://www.tiktok.com/@veltrix.records" target="_blank" aria-label="TikTok">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg">
                  <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93v6.16c0 2.52-1.12 4.84-2.9 6.48-1.48 1.39-3.52 2.16-5.63 2.15-4.78.03-8.8-4.01-8.58-9.09.18-4.17 3.44-7.58 7.55-7.9v4.02c-2.45.28-4.22 2.45-3.87 4.92.29 2.06 2.07 3.53 4.15 3.49 1.91-.03 3.63-1.45 3.99-3.32.09-.45.09-.91.09-1.37V.02z"/>
                </svg>
              </a>
            </Magnetic>

            {/* DISCORD */}
            <Magnetic>
              <a href="https://discord.gg/xK4A3Tpkdw" target="_blank" aria-label="Discord">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
              </a>
            </Magnetic>

            {/* YOUTUBE */}
            <Magnetic>
              <a href="https://www.youtube.com/@veltrix.records" target="_blank" aria-label="YouTube">
                <svg viewBox="0 0 24 24" fill="currentColor" className="social-svg">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
              </a>
            </Magnetic>
          </div>
          <div className="footer-bottom">
            <span>© 2025 VELTRIX RECORDS</span>
            <span className="secret-trigger" onClick={() => setShowSecret(true)}>ACCESS : RESTRICTED</span>
            <span>FRANCE</span>
          </div>
        </motion.div>
      </footer>

      <AnimatePresence>
        {showSecret && (
          <motion.div className="secret-modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="secret-content">
              {!unlocked ? (
                <>
                  <h2>SYSTEM LOCKED</h2><p>ENTER PASSCODE: VTX2026</p>
                  <form onSubmit={checkPassword} className="minimal-form">
                    <input type="password" placeholder="XXXXXXX" value={password} onChange={(e) => setPassword(e.target.value)} style={{textAlign: 'center', letterSpacing: '10px'}} autoFocus />
                    <button type="submit" className="submit-btn" style={{marginTop:'20px'}}>DECRYPT</button>
                  </form>
                </>
              ) : (
                <div className="unlocked-content">
                  <h2 style={{color:'cyan'}}>ACCESS GRANTED</h2>
                  <a href="#" className="download-link">DOWNLOAD SAMPLES</a>
                </div>
              )}
              <button className="close-btn" onClick={() => {setShowSecret(false); setUnlocked(false); setPassword("");}}>CLOSE</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;