import { dbConnect, Player, checkRateLimit, generatePlayerCode, parseCookies, verifyCookieValue, serializeCookie } from '../../lib/db';

export default async function handler(req, res) {
  const { slug } = req.query;
  const path = slug?.join('/') || '';

  // --- Route: /api/generate ---
  if (path === 'generate' && req.method === 'POST') {
    return handleGenerate(req, res);
  }

  // --- Route: /api/player ---
  if (path === 'player' && req.method === 'GET') {
    return handlePlayer(req, res);
  }

  res.status(404).json({ error: 'Not found' });
}

// ---------- Generate Handler ----------
async function handleGenerate(req, res) {
  const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const allowed = await checkRateLimit(ip, '/api/generate', 5, 60);
  if (!allowed) return res.status(429).json({ error: 'Too many requests' });

  await dbConnect();

  const { id, type, season, episode, title, validity, isPremium } = req.body;
  if (!id || !type || !title || !validity) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!['movie', 'tv'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (type === 'tv' && (season === undefined || episode === undefined)) {
    return res.status(400).json({ error: 'Season and episode required for TV' });
  }
  if (typeof validity !== 'number' || validity <= 0) {
    return res.status(400).json({ error: 'Validity must be a positive number' });
  }

  let playerCode;
  let exists = true;
  while (exists) {
    playerCode = generatePlayerCode();
    const existing = await Player.findOne({ playerCode });
    if (!existing) exists = false;
  }

  const newPlayer = new Player({
    playerCode,
    contentId: id,
    type,
    season: type === 'tv' ? season : null,
    episode: type === 'tv' ? episode : null,
    title,
    premium: isPremium || false,
    validity,
  });

  await newPlayer.save();

  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
  const url = `${baseUrl}/?play=${playerCode}`;

  res.status(200).json({
    success: true,
    playerCode,
    url,
    title,
    expiresIn: validity,
  });
}

// ---------- Player Handler ----------
async function handlePlayer(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Missing player code' });
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const allowed = await checkRateLimit(ip, '/api/player', 20, 60);
  if (!allowed) return res.status(429).json({ error: 'Too many requests' });

  await dbConnect();

  const player = await Player.findOne({ playerCode: code });
  if (!player) {
    return res.status(404).json({ error: 'Invalid or expired link' });
  }

  // Premium: ignore restrictions
  if (player.premium) {
    return res.status(200).json(buildPlayerResponse(player));
  }

  // Check expiration
  if (player.expiresAt && new Date() > player.expiresAt) {
    await Player.deleteOne({ _id: player._id });
    return res.status(410).json({ error: 'Link expired' });
  }

  // Check cookie for refresh
  const cookies = parseCookies(req);
  let isRefresh = false;
  const mesStream = cookies.mes_stream;
  if (mesStream) {
    const decoded = verifyCookieValue(mesStream);
    if (decoded) {
      try {
        const data = JSON.parse(decoded);
        if (data.playerCode === code) isRefresh = true;
      } catch (e) {}
    }
  }

  if (!isRefresh) {
    // New visit: increment clicks
    const updated = await Player.findOneAndUpdate(
      { _id: player._id },
      { $inc: { clicks: 1 } },
      { new: true }
    );
    if (!updated) {
      return res.status(410).json({ error: 'Link expired' });
    }

    if (updated.clicks >= updated.maxClicks) {
      await Player.deleteOne({ _id: updated._id });
      return res.status(410).json({ error: 'Link expired (max clicks)' });
    }

    // Set cookie
    const cookieValue = JSON.stringify({ playerCode: code });
    const signed = signCookieValue(cookieValue);
    const expiryDate = updated.expiresAt ? new Date(updated.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    res.setHeader('Set-Cookie', serializeCookie('mes_stream', signed, { expires: expiryDate }));

    return res.status(200).json(buildPlayerResponse(updated));
  } else {
    // Refresh – no click increment
    return res.status(200).json(buildPlayerResponse(player));
  }
}

function buildPlayerResponse(player) {
  return {
    success: true,
    contentId: player.contentId,
    type: player.type,
    season: player.season,
    episode: player.episode,
    title: player.title,
    premium: player.premium,
  };
}
