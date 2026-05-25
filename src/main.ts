import { server } from './http/server';
import './http/router';
import { authWatchManager } from './actions/auth-service';
import { appConfig } from './config';
import { runAutomationEngine } from './automation/engine/automation-engine';
import { loadAutomationState } from './automation/persistence';

async function main() {
  loadAutomationState();
  if (appConfig.dess.auth.username) {
    await authWatchManager();
  } else {
    console.warn('Auth credentials in env not found');
  }

  // Start automation engine loop
  setInterval(() => {
    runAutomationEngine().catch(err => console.error('Automation Engine Error:', err));
  }, 1000 * 60 * 10); // Run every 10 minutes
  
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
