import { server } from './http/server';
import './http/router';
import { authWatchManager } from './actions/auth-service';
import { appConfig } from './config';
import { runAutomationEngine } from './automation/engine/automation-engine';
import { loadAutomationState } from './automation/persistence';
import { automationState } from './automation/state';
import { tuyaManager } from './automation/nodes/tuya.node';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  loadAutomationState();
  await tuyaManager.init();

  // Auto-refetch forecast cache if solar/weather settings changed
  const CACHE_FILE = join(__dirname, '../data/stats/forecast-cache.json');
  if (existsSync(CACHE_FILE)) {
    try {
      const cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      const w = automationState.settings.weather;
      const s = automationState.settings.solar;
      const cur = { tilt: s?.tilt ?? 0, azimuth: s?.azimuth ?? 0, kwp: s?.kwp ?? 0, lat: Number(w?.lat) || 0, lon: Number(w?.lon) || 0 };
      const cached = { tilt: Number(cache.tilt) ?? null, azimuth: Number(cache.azimuth) ?? null, kwp: Number(cache.kwp) ?? null, lat: Number(cache.lat) || 0, lon: Number(cache.lon) || 0 };
      if (JSON.stringify(cur) !== JSON.stringify(cached)) {
        console.log('[Startup] Settings changed — re-fetching forecast cache');
        console.log('  Cached:', JSON.stringify(cached));
        console.log('  Current:', JSON.stringify(cur));
        execSync(`python3 "${join(__dirname, '../scripts/refetch_forecast.py')}"`, { stdio: 'inherit', timeout: 60000 });
        console.log('[Startup] Forecast cache refreshed');
      } else {
        console.log('[Startup] Forecast cache settings match');
      }
    } catch (e) {
      console.warn('[Startup] Forecast cache check error:', (e as Error).message);
    }
  }
  
  // Register Bonjour/mDNS via macOS dns-sd (built-in, reliable)
  const port = Number.parseInt(process.env.PORT || '8000');
  const mdnsProcess = spawn('dns-sd', ['-R', 'desmonitor', '_http._tcp', 'local', String(port)], {
    stdio: 'ignore',
    detached: false
  });
  mdnsProcess.on('error', () => { /* dns-sd not available */ });
  mdnsProcess.on('exit', () => { /* will be restarted by launchd */ });
  process.on('exit', () => { mdnsProcess.kill(); });
  console.log(`mDNS: Rozgłaszanie jako desmonitor.local (port ${port})`);

  if (appConfig.dess.auth.username) {
    await authWatchManager();
  } else {
    console.warn('Auth credentials in env not found');
  }

  // Start automation engine loop
  setInterval(() => {
    runAutomationEngine().catch(err => console.error('Automation Engine Error:', err));
  }, 1000 * 30); // Run every 30 seconds
  
  // Initial run
  runAutomationEngine().catch(err => console.error('Automation Engine Initial Error:', err));

  server.listen(
    {
      port: Number.parseInt(process.env.PORT || '8000'),
      host: process.env.HOST || '0.0.0.0',
    },
    (err, address) => {
      if (err) {
        server.log.error(err);
        console.error(err);
        process.exit(1);
      } else {
        const url = address.replace('0.0.0.0', 'localhost');
        console.log(`Server started at ${url}`);
      }
    },
  );
}

main();
