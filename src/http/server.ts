import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';

export const server = Fastify({ logger: false });

const frontendDist = path.join(process.cwd(), 'frontend', 'dist');
const publicDir = path.join(process.cwd(), 'public');
const hasSvelteBuild = fs.existsSync(frontendDist);

const indexPath = hasSvelteBuild
  ? path.join(frontendDist, 'index.html')
  : path.join(publicDir, 'index.html');

let indexETag = Date.now().toString();

chokidar.watch(indexPath).on('change', () => {
  indexETag = Date.now().toString();
  console.log('index.html changed, updating ETag for auto-reload');
});

server.get('/version', async (request, reply) => {
  reply.send({ version: indexETag });
});

// Serve static files from Svelte build (or public/ as fallback)
server.register(fastifyStatic, {
  root: hasSvelteBuild ? frontendDist : publicDir,
  prefix: '/',
});

// SPA fallback — serve index.html for any unmatched route
server.setNotFoundHandler((request, reply) => {
  reply.type('text/html').send(fs.readFileSync(indexPath));
});
