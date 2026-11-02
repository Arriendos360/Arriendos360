// Tokens de marca: apps/web/src/ui/marca.md. Los valores viven en src/ui/tokens.css
// como variables CSS; aquí sólo se nombran para que Tailwind los exponga.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      indigo: {
        profundo: 'var(--indigo-profundo)',
        medio: 'var(--indigo-medio)',
        hover: 'var(--indigo-hover)',
      },
      lavanda: 'var(--lavanda)',
      chip: 'var(--chip-pastel)',
      superficie: 'var(--superficie)',
      borde: 'var(--borde)',
      velo: 'var(--velo)',
      texto: {
        DEFAULT: 'var(--texto)',
        suave: 'var(--texto-suave)',
        label: 'var(--texto-label)',
      },
      // Semánticos: sólo los usa src/ui/Badge y el «Cerrar sesión» del dock (marca.md).
      verde: { DEFAULT: 'var(--verde)', texto: 'var(--verde-texto)', tenue: 'var(--verde-tenue)' },
      ambar: { DEFAULT: 'var(--ambar)', texto: 'var(--ambar-texto)', tenue: 'var(--ambar-tenue)' },
      rojo: { DEFAULT: 'var(--rojo)', texto: 'var(--rojo-texto)', tenue: 'var(--rojo-tenue)' },
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
    },
    // Peso máximo 500 en toda la aplicación.
    fontWeight: { normal: '400', medium: '500' },
    borderRadius: {
      none: '0',
      chip: 'var(--radio-chip)',
      logo: '9px',
      control: 'var(--radio-control)',
      tarjeta: 'var(--radio-tarjeta)',
      app: 'var(--radio-app)',
      dock: '1rem',
      full: '9999px',
    },
    // Sin sombras ni degradados, salvo la sombra del dock (marca.md).
    boxShadow: { dock: '0 8px 30px rgba(0, 0, 0, 0.12)' },
    backgroundImage: {},
    extend: {
      letterSpacing: { label: '0.45px' },
    },
  },
  plugins: [],
};
