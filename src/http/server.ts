import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';

export const server = Fastify({ logger: false });

let indexETag = Date.now().toString();
const indexPath = path.join(__dirname, '../../public/index.html');

chokidar.watch(indexPath).on('change', () => {
  indexETag = Date.now().toString();
  console.log('index.html changed, updating ETag for auto-reload');
});

server.get('/version', async (request, reply) => {
  reply.send({ version: indexETag });
});

server.register(fastifyStatic, {
  root: path.join(__dirname, '../../public'),
  prefix: '/',
});
