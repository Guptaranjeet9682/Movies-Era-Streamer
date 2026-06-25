import mongoose from 'mongoose';
import crypto from 'crypto';
import cookie from 'cookie';

// ------------------- MongoDB Connection -------------------
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error('MONGODB_URI missing');

let cached = global.mongoose || { conn: null, promise: null };
global.mongoose = cached;

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// ------------------- Models -------------------
const playerSchema = new mongoose.Schema({
  playerCode: { type: String, required: true, unique: true },
  contentId: { type: String, required: true },
  type: { type: String, enum: ['movie', 'tv'], required: true },
  season: { type: Number, default: null },
  episode: { type: Number, default: null },
  title: { type: String, required: true },
  premium: { type: Boolean, default: false },
  clicks: { type: Number, default: 0 },
  maxClicks: { type: Number, default: 2 },
  validity: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
});

playerSchema.pre('save', function (next) {
  if (!this.premium && this.validity) {
    this.expiresAt = new Date(this.createdAt.getTime() + this.validity * 1000);
  } else {
    this.expiresAt = null;
  }
  next();
});

const rateLimitSchema = new mongoose.Schema({
  ip: { type: String, required: true },
  route: { type: String, required: true },
  count: { type: Number, default: 0 },
  resetAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const Player = mongoose.models.Player || mongoose.model('Player', playerSchema);
export const RateLimit = mongoose.models.RateLimit || mongoose.model('RateLimit', rateLimitSchema);

// ------------------- Utilities -------------------
export function generatePlayerCode() {
  return `MES_${crypto.randomBytes(16).toString('base64url')}`;
}

export async function checkRateLimit(ip, route, limit = 10, windowSec = 60) {
  await dbConnect();
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSec * 1000);
  const result = await RateLimit.findOneAndUpdate(
    { ip, route },
    { $inc: { count: 1 }, $setOnInsert: { resetAt } },
    { upsert: true, new: true }
  );
  if (now > result.resetAt) {
    await RateLimit.updateOne({ _id: result._id }, { count: 1, resetAt });
    return true;
  }
  return result.count <= limit;
}

const COOKIE_SECRET = process.env.COOKIE_SECRET || 'default-secret';

export function signCookieValue(value) {
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET);
  hmac.update(value);
  return `${value}.${hmac.digest('hex')}`;
}

export function verifyCookieValue(signed) {
  const parts = signed.split('.');
  if (parts.length !== 2) return null;
  const [value, signature] = parts;
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET);
  hmac.update(value);
  return hmac.digest('hex') === signature ? value : null;
}

export function parseCookies(req) {
  return cookie.parse(req.headers.cookie || '');
}

export function serializeCookie(name, value, options = {}) {
  return cookie.serialize(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...options,
  });
}
