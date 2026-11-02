process.env.TZ = 'Europe/Bucharest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const config = require('./config.json');
const { createGpsTracker } = require('./src/gps/tracker');
const { createMecanizareStore, UploadError } = require('./src/mecanizare');
const { createAccessGate } = require('./src/access');

// Local settings live in .env; on a host the variables are set there.
try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const hosted = Boolean(process.env.PORT);
const accessKey = process.env.CHEIE_ACCES;
if (hosted && !accessKey) {
  console.error('Panoul nu pornește pe internet fără cheie de acces. Setează variabila CHEIE_ACCES.');
  process.exit(1);
}

// A container forgets its files on every deploy, so a host needs a volume here.
const dataDir = process.env.DIR_DATE || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'date');
fs.mkdirSync(dataDir, { recursive: true });

const gps = createGpsTracker(config.gps, dataDir);
const mecanizare = createMecanizareStore({
  ...config.mecanizare,
  fisierExpirari: process.env.FISIER_EXPIRARI || config.mecanizare.fisierExpirari,
}, dataDir);

const app = express();
app.disable('x-powered-by');

if (accessKey) app.use(createAccessGate(accessKey));
else console.warn('Atenție: panoul nu are cheie de acces (variabila CHEIE_ACCES).');

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/config', (req, res) => {
  res.json({
    rotatieSecunde: config.rotatieSecunde,
    harta: config.harta,
    actualizareGpsSecunde: config.gps.actualizareSecunde,
    pragVitezaAtentie: config.gps.pragVitezaAtentie,
    pragVitezaCritic: config.gps.pragVitezaCritic,
    zileUrgent: config.mecanizare.zileUrgent,
    zileAtentie: config.mecanizare.zileAtentie,
  });
});
app.get('/api/gps', (req, res) => res.json(gps.snapshot()));
app.get('/api/mecanizare', (req, res) => res.json(mecanizare.snapshot()));

app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/incarca', express.raw({ type: () => true, limit: '10mb' }), async (req, res) => {
  try {
    res.json(await mecanizare.saveUpload(req.body));
  } catch (err) {
    if (err instanceof UploadError) {
      res.status(400).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Fișierul nu a putut fi salvat' });
  }
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.status === 413 ? 'Fișierul este prea mare' : 'Eroare la server' });
});

gps.start();
mecanizare.start();

const port = process.env.PORT || config.port;
const host = hosted ? '0.0.0.0' : config.gazda;

app.listen(port, host, (err) => {
  if (err) throw err;
  console.log(`Panou mecanizare: http://localhost:${port}`);
  if (hosted || host !== '0.0.0.0') return;
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const { family, internal, address } of addresses) {
      if (family === 'IPv4' && !internal) console.log(`  ${name}: http://${address}:${port}`);
    }
  }
});
