process.env.TZ = 'Europe/Bucharest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const config = require('./config.json');
const { createGpsTracker } = require('./src/gps/tracker');
const { createMecanizareStore, UserError } = require('./src/mecanizare');
const { createAccess, passwordProblem } = require('./src/access');
const { createLiveStream } = require('./src/live');

// Local settings live in .env; on a host the variables are set there.
try {
  process.loadEnvFile();
} catch {
  // No .env file.
}

const problem = passwordProblem(process.env.PAROLA_TV, process.env.PAROLA_LAPTOP);
if (problem) {
  console.error(`Panoul nu pornește fără parole: ${problem}`);
  process.exit(1);
}

const hosted = Boolean(process.env.PORT);

// A container forgets its files on every deploy, so a host needs a volume here.
const volume = process.env.DIR_DATE || process.env.RAILWAY_VOLUME_MOUNT_PATH;
const dataDir = volume || path.join(__dirname, 'date');
const persistent = !hosted || Boolean(volume);
fs.mkdirSync(dataDir, { recursive: true });
if (!persistent) console.warn('Atenție: serverul nu are volum, datele se pierd la următorul deploy.');

const gps = config.gps.activ ? createGpsTracker(config.gps, dataDir) : null;
const mecanizare = createMecanizareStore(config.mecanizare, dataDir);
const access = createAccess({ tvPassword: process.env.PAROLA_TV, adminPassword: process.env.PAROLA_LAPTOP });

const app = express();
app.disable('x-powered-by');
if (hosted) app.set('trust proxy', 1);

app.post('/intra', express.urlencoded({ extended: false, limit: '2kb' }), access.login);
app.post('/iesi', access.logout);
app.use(access.gate);

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/config', (req, res) => {
  res.json({
    rotatieSecunde: config.rotatieSecunde,
    harta: config.harta,
    gps: config.gps.activ,
    actualizareGpsSecunde: config.gps.actualizareSecunde,
    pragVitezaAtentie: config.gps.pragVitezaAtentie,
    pragVitezaCritic: config.gps.pragVitezaCritic,
    zileUrgent: config.mecanizare.zileUrgent,
    zileAtentie: config.mecanizare.zileAtentie,
  });
});
if (gps) app.get('/api/gps', (req, res) => res.json(gps.snapshot()));
app.get('/api/mecanizare', (req, res) => res.json(mecanizare.snapshot()));
app.get('/api/mecanizare/evenimente', createLiveStream(mecanizare.subscribe));

// Every change answers with the whole menu, so the page never shows a stale list.
function menuAction(run) {
  return async (req, res) => {
    try {
      await run(req);
      res.json({ ...mecanizare.menu(), persistent });
    } catch (err) {
      if (err instanceof UserError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'Eroare la server. Încearcă din nou.' });
    }
  };
}

const menu = express.Router();
menu.use(access.requireAdmin, express.json({ limit: '100kb' }));
menu.get('/', menuAction(() => {}));
menu.post('/probleme', menuAction((req) => mecanizare.addTask(req.body)));
menu.post('/lucrari/:id/preia', menuAction((req) => mecanizare.startTask(req.params.id, req.body)));
menu.post('/lucrari/:id/rezolvat', menuAction((req) => mecanizare.finishTask(req.params.id, req.body)));
menu.post('/lucrari/:id/inapoi', menuAction((req) => mecanizare.reopenTask(req.params.id)));
menu.delete('/lucrari/:id', menuAction((req) => mecanizare.deleteTask(req.params.id)));
menu.post('/acte/preia', menuAction((req) => mecanizare.takeDocument(req.body)));
menu.post('/acte/rezolvat', menuAction((req) => mecanizare.resolveDocument(req.body)));
menu.post('/acte/nu-se-aplica', menuAction((req) => mecanizare.setNotApplicable(req.body)));
menu.post(
  '/import',
  express.raw({ type: 'application/octet-stream', limit: '10mb' }),
  async (req, res, next) => {
    try {
      req.importResult = await mecanizare.importWorkbook(req.body);
      next();
    } catch (err) {
      if (err instanceof UserError) res.status(400).json({ error: err.message });
      else next(err);
    }
  },
  (req, res) => res.json({ ...mecanizare.menu(), persistent, importResult: req.importResult }),
);
app.use('/api/meniu', menu);

app.use('/meniu', access.requireAdmin, express.static(path.join(__dirname, 'meniu')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.status === 413 ? 'Fișierul este prea mare' : 'Eroare la server' });
});

if (gps) gps.start();

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
