// Construit optispace-landing-3d.html, un fichier autonome, à partir de src/.
// Usage : npm run build   (depuis le dossier landing/)
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const D = __dirname, src = (p) => fs.readFileSync(path.join(D, 'src', p), 'utf8');
const all = (s, a, b) => s.split(a).join(b);

// Les fichiers JS partagent une seule portée : ils sont concaténés dans un <script type="module">.
const JS = ['01-scene.js', '02-personnages.js', '03-histoire.js', '04-lecture.js', '05-hero.js', '06-demain.js'];
const mainJs = JS.map((f) => src('js/' + f)).join('\n');

// Typographie française : espaces insécables, dans le texte visible du <body> uniquement
function fr(t) {
  for (const [a, b] of [[' ?', ' ?'], [' :', ' :'], ['« ', '« '], [' »', ' »'], [' %', ' %'], [' €', ' €'], [' min', ' min']]) t = all(t, a, b);
  return t;
}
let h = all(src('page.html'), '__GRAIN__', src('assets/grain.b64').trim());
const a = h.indexOf('<body'), z = h.indexOf('<script src="https://cdnjs');
h = h.slice(0, a) + h.slice(a, z).replace(/>([^<>]+)</g, (m, g) => '>' + fr(g) + '<') + h.slice(z);
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'src/assets/logo-3istor.png')).toString('base64');
h = all(h, '__LOGO__', logo);
h = all(h, '__BUILD_SVG__', src('assets/batiment-svg.txt'));
h = h.split('__MAIN_JS__').join(mainJs);
if (h.includes('\u2014')) throw new Error('Tiret cadratin (U+2014) interdit dans la page.');

// Tailwind 3.4 compilé et intégré (pas de CDN Tailwind en production)
fs.mkdirSync(path.join(D, '.build'), { recursive: true });
fs.writeFileSync(path.join(D, '.build/scan.html'), h);
execSync('npx tailwindcss -c tailwind.config.js -i tailwind.in.css -o .build/tw.css --minify', { cwd: D, stdio: 'pipe' });
const css = all(fs.readFileSync(path.join(D, '.build/tw.css'), 'utf8'), '</style', '<\\/style');
h = h.split('/*__TAILWIND__*/').join(css);
fs.writeFileSync(path.join(D, 'optispace-landing-3d.html'), h);
console.log('optispace-landing-3d.html :', Math.round(h.length / 1024), 'Ko');
