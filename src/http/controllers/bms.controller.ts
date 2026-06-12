import { server } from '../server';
import { jkBmsInstance } from '../../devices/models/jkbms.bms';
import { createBMS } from '../../devices/registry';
import { automationState } from '../../automation/state';
import { saveAutomationState } from '../../automation/persistence';
import fs from 'fs';
import path from 'path';

export function registerBMSRoutes(): void {
  // POST /api/bms/data — ESP32 pushes BMS snapshot here
  server.post('/api/bms/data', async (request: any, reply: any) => {
    try {
      const body = request.body;
      if (!body) {
        return reply.status(400).send({ error: 'Missing request body' });
      }

      const snapshot = {
        timestamp: new Date(body.timestamp || Date.now()),
        totalVoltage: Number(body.totalVoltage) || 0,
        power: Number(body.power) || 0,
        cellVoltages: Array.isArray(body.cellVoltages) ? body.cellVoltages.map(Number) : [],
        cellMinVoltage: Number(body.cellMinVoltage) || 0,
        cellMaxVoltage: Number(body.cellMaxVoltage) || 0,
        cellDelta: Number(body.cellDelta) || 0,
        soc: Number(body.soc) || 0,
        current: Number(body.current) || 0,
        temperatures: Array.isArray(body.temperatures) ? body.temperatures.map(Number) : [],
        balancing: Boolean(body.balancing),
        balancingCurrent: Number(body.balancingCurrent) || 0,
        cycleCount: Number(body.cycleCount) || 0,
        capacityRemainingAh: Number(body.capacityRemainingAh) || 0,
        capacityFullAh: Number(body.capacityFullAh) || 0,
      };

      jkBmsInstance.setSnapshot(snapshot);

      // Also store in automation state so nodes can reference it
      const bmsNodes = Object.values(automationState.nodes).filter(n => n.type === 'bms');
      bmsNodes.forEach(node => {
        node.data = { ...snapshot, deviceId: body.deviceId || '' };
        node.lastUpdate = Date.now();
        node.lastVal = `${snapshot.soc}% ${snapshot.totalVoltage}V`;
      });

      reply.send({ success: true });
    } catch (error: any) {
      console.error('[BMS] Error processing data:', error.message);
      reply.status(500).send({ error: error.message });
    }
  });

  // GET /api/bms/data — latest BMS snapshot
  server.get('/api/bms/data', async (request: any, reply: any) => {
    const snap = jkBmsInstance.lastSnapshot;
    if (!snap) {
      return reply.send({ error: 'No BMS data received yet' });
    }
    reply.send(snap);
  });

  // GET /api/bms/config — read BMS settings from automation state
  server.get('/api/bms/config', async (request: any, reply: any) => {
    reply.send({
      bms: automationState.settings.bms,
    });
  });

  // PUT /api/bms/config — update BMS settings
  server.put('/api/bms/config', async (request: any, reply: any) => {
    try {
      const body = request.body;
      if (body) {
        Object.assign(automationState.settings.bms, body);
        saveAutomationState();
      }
      reply.send({ success: true });
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // POST /api/bms/logs — ESP32 pushes logs here
  server.post('/api/bms/logs', async (request: any, reply: any) => {
    try {
      const body = request.body;
      const deviceId = body?.deviceId || 'unknown';
      const logs = body?.logs || '';

      const logDir = path.join(process.cwd(), 'data', 'bms-logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logFile = path.join(logDir, `${deviceId}.log`);
      const timestamp = new Date().toISOString();
      const entry = `\n--- ${timestamp} ---\n${logs}`;
      fs.appendFileSync(logFile, entry);

      reply.send({ success: true });
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  // GET /api/bms/logs — retrieve BMS device logs
  server.get('/api/bms/logs', async (request: any, reply: any) => {
    try {
      const deviceId = (request.query as any).deviceId || '';
      const logDir = path.join(process.cwd(), 'data', 'bms-logs');

      if (!deviceId) {
        // List available log files
        if (fs.existsSync(logDir)) {
          const files = fs.readdirSync(logDir);
          return reply.send({ devices: files.map(f => f.replace('.log', '')) });
        }
        return reply.send({ devices: [] });
      }

      const logFile = path.join(logDir, `${deviceId}.log`);
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8');
        const lines = content.split('\n');
        const tail = lines.slice(-200).join('\n');
        return reply.send({ logs: tail });
      }

      reply.send({ logs: 'No logs found for this device' });
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
