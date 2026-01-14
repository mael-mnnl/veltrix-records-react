export const particlesOptions = {
  fullScreen: { enable: true, zIndex: -1 },
  background: { color: { value: "#050505" } },
  fpsLimit: 120,
  particles: {
    color: { value: "#ffffff" },
    links: { enable: false }, // Pas de lignes, juste des points (plus élégant)
    move: {
      enable: true,
      speed: 0.3, // Très lent
      direction: "none",
      random: true,
      straight: false,
      outModes: { default: "out" },
    },
    number: { density: { enable: true, area: 800 }, value: 60 },
    opacity: { value: 0.5, random: true },
    shape: { type: "circle" },
    size: { value: { min: 0.5, max: 1.5 } }, // Très fin
  },
  detectRetina: true,
};