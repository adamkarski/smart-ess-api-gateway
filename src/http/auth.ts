import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { server } from './server';

const USERS_FILE = join(process.cwd(), 'data', 'users.json');
const JWT_SECRET_FILE = join(process.cwd(), 'data', '.jwt_secret');
const USERS_DIR = join(process.cwd(), 'data');

interface User {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  settings?: Record<string, any>;
  createdAt: string;
}

interface UsersStore {
  users: Record<string, User>; // keyed by email
}

function ensureDir() {
  if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });
}

function loadUsers(): UsersStore {
  try {
    ensureDir();
    if (existsSync(USERS_FILE)) {
      return JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Auth] Load users error:', (e as Error).message);
  }
  return { users: {} };
}

function saveUsers(store: UsersStore) {
  try {
    ensureDir();
    writeFileSync(USERS_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('[Auth] Save users error:', (e as Error).message);
  }
}

function getJwtSecret(): string {
  try {
    ensureDir();
    if (existsSync(JWT_SECRET_FILE)) {
      return readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
    }
  } catch {}
  // Generate a random secret on first run
  const crypto = require('crypto');
  const secret = crypto.randomBytes(64).toString('hex');
  try {
    writeFileSync(JWT_SECRET_FILE, secret);
  } catch {}
  return secret;
}

const JWT_SECRET = getJwtSecret();

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Middleware
export interface AuthRequest {
  userId: string;
  email: string;
}

export function verifyToken(token: string): AuthRequest | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export function registerAuthRoutes() {
  // Register
  server.post('/auth/register', async (request, reply) => {
    const { email, password, name } = request.body as any;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }
    if (password.length < 4) {
      return reply.status(400).send({ error: 'Password too short (min 4)' });
    }
    const store = loadUsers();
    if (store.users[email]) {
      return reply.status(409).send({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user: User = {
      id: generateId(),
      email,
      passwordHash,
      name: name || '',
      settings: {},
      createdAt: new Date().toISOString(),
    };
    store.users[email] = user;
    saveUsers(store);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    reply.send({ token, user: { id: user.id, email: user.email, name: user.name, settings: user.settings } });
  });

  // Login
  server.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as any;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }
    const store = loadUsers();
    const user = store.users[email];
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    reply.send({ token, user: { id: user.id, email: user.email, name: user.name, settings: user.settings } });
  });

  // Get current user (requires auth)
  server.get('/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'No token' });
    }
    const auth = verifyToken(authHeader.slice(7));
    if (!auth) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
    const store = loadUsers();
    const user = store.users[auth.email];
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    reply.send({ id: user.id, email: user.email, name: user.name, settings: user.settings });
  });

  // Update profile
  server.put('/auth/profile', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'No token' });
    }
    const auth = verifyToken(authHeader.slice(7));
    if (!auth) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
    const store = loadUsers();
    const user = store.users[auth.email];
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const { name, settings } = request.body as any;
    if (name !== undefined) user.name = name;
    if (settings !== undefined) user.settings = { ...(user.settings || {}), ...settings };
    saveUsers(store);
    reply.send({ id: user.id, email: user.email, name: user.name, settings: user.settings });
  });

  // Password reset (forgot password) – no old password required (simple local flow)
  server.post('/auth/reset-password', async (request, reply) => {
    const { email, newPassword } = request.body as any;
    if (!email || !newPassword) {
      return reply.status(400).send({ error: 'Email and newPassword required' });
    }
    if (newPassword.length < 4) {
      return reply.status(400).send({ error: 'Password too short (min 4)' });
    }
    const store = loadUsers();
    const user = store.users[email];
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    saveUsers(store);
    reply.send({ success: true });
  });

  // User‑specific dashboard widgets – stored in user.settings.dashboard_widgets
  server.get('/user/widgets', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'No token' });
    }
    const auth = verifyToken(authHeader.slice(7));
    if (!auth) return reply.status(401).send({ error: 'Invalid token' });
    const store = loadUsers();
    const user = store.users[auth.email];
    if (!user) return reply.status(404).send({ error: 'User not found' });
    const widgets = (user.settings && (user.settings as any).dashboard_widgets) || [];
    reply.send({ widgets });
  });

  server.post('/user/widgets', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'No token' });
    }
    const auth = verifyToken(authHeader.slice(7));
    if (!auth) return reply.status(401).send({ error: 'Invalid token' });
    const { widgets } = request.body as any;
    if (!Array.isArray(widgets)) {
      return reply.status(400).send({ error: 'Invalid widgets data' });
    }
    const store = loadUsers();
    const user = store.users[auth.email];
    if (!user) return reply.status(404).send({ error: 'User not found' });
    user.settings = { ...(user.settings || {}), dashboard_widgets: widgets };
    saveUsers(store);
    reply.send({ success: true });
  });
}
