'use strict';

// V-HUB Social - dependency-free Node.js server (Node 22.13+)
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'vhub.sqlite');
const PORT = Number(process.env.PORT || 3000);
const COOKIE_NAME = 'vhub_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 256 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('like', 'comment', 'follow')),
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(id DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

const stmt = {
  userById: db.prepare('SELECT id, username, email, display_name, bio, avatar_url, created_at FROM users WHERE id = ?'),
  userByUsername: db.prepare('SELECT id, username, email, display_name, bio, avatar_url, created_at FROM users WHERE username = ? COLLATE NOCASE'),
  userByLogin: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)'),
  findSession: db.prepare('SELECT token_hash, user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  addNotification: db.prepare('INSERT INTO notifications (recipient_id, actor_id, type, post_id) VALUES (?, ?, ?, ?)')
};

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function safeUser(user, includeEmail = false) {
  if (!user) return null;
  const result = { id: user.id, username: user.username, displayName: user.display_name, bio: user.bio, avatarUrl: user.avatar_url, createdAt: user.created_at };
  if (includeEmail) result.email = user.email || '';
  return result;
}
function cleanText(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return url.href.slice(0, 1000);
  } catch { return null; }
}
function parseCookies(header = '') {
  const out = {};
  for (const bit of header.split(';')) {
    const idx = bit.indexOf('=');
    if (idx < 0) continue;
    const key = bit.slice(0, idx).trim();
    try { out[key] = decodeURIComponent(bit.slice(idx + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return out;
}
function setCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}${secure}`);
}
function newSession(res, userId = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL;
  stmt.insertSession.run(tokenHash, userId, csrfToken, expiresAt);
  setCookie(res, token);
  return { token_hash: tokenHash, user_id: userId, csrf_token: csrfToken, expires_at: expiresAt };
}
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, status, message) { sendJson(res, status, { error: message }); }
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Dữ liệu gửi lên quá lớn.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Dữ liệu JSON không hợp lệ.'), { status: 400 }); }
}
function requireUser(session) { return Boolean(session && session.user_id); }
function getPosts(currentUserId, filter = 'all', targetUserId = null) {
  let where = '';
  const params = [currentUserId || 0];
  if (targetUserId) {
    where = 'WHERE p.user_id = ?';
    params.push(targetUserId);
  } else if (filter === 'following') {
    where = 'WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR p.user_id = ?';
    params.push(currentUserId, currentUserId);
  }
  const rows = db.prepare(`
    SELECT p.id, p.user_id, p.body, p.image_url, p.created_at,
      u.username, u.display_name, u.avatar_url,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id ${where}
    ORDER BY p.id DESC LIMIT 60
  `).all(...params);
  return rows.map(row => ({
    id: row.id, body: row.body, imageUrl: row.image_url, createdAt: row.created_at,
    likeCount: row.like_count, commentCount: row.comment_count, liked: Boolean(row.liked),
    isMine: Boolean(currentUserId && currentUserId === row.user_id),
    author: { id: row.user_id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url }
  }));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}
function verifyPassword(password, stored) {
  try {
    const [algorithm, saltHex, hashHex] = stored.split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function seedDatabase() {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return;
  const insert = db.prepare('INSERT INTO users (username, email, password_hash, display_name, bio) VALUES (?, ?, ?, ?, ?)');
  const demoHash = hashPassword('Demo1234!');
  const ids = {};
  for (const user of [
    ['demo', 'demo@vhub.local', 'V-HUB Demo', 'Đây là tài khoản trải nghiệm V-HUB. Chào mừng bạn đến với cộng đồng!'],
    ['minhkhoi', 'khoi@vhub.local', 'Minh Khôi', 'Thích công nghệ, âm nhạc và những ý tưởng mới.'],
    ['linhchi', 'chi@vhub.local', 'Linh Chi', 'Ghi lại những điều nhỏ xinh mỗi ngày ✨']
  ]) ids[user[0]] = Number(insert.run(user[0], user[1], demoHash, user[2], user[3]).lastInsertRowid);
  const post = db.prepare('INSERT INTO posts (user_id, body, image_url) VALUES (?, ?, ?)');
  post.run(ids.minhkhoi, 'Chào mọi người! Đây là góc nhỏ để chia sẻ ý tưởng, học hỏi và kết nối. V-HUB bắt đầu từ đây 🚀', '');
  post.run(ids.linhchi, 'Một ngày mới, một mục tiêu mới. Chúc cả nhà có một ngày thật nhiều năng lượng! 🌿', '');
  post.run(ids.demo, 'Xin chào! Mình là bài đăng đầu tiên trên V-HUB. Hãy tạo tài khoản và cùng xây dựng cộng đồng nhé 💜', '');
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(ids.demo, ids.minhkhoi);
  db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(ids.demo, ids.linhchi);
}
seedDatabase();

const authAttempts = new Map();
function checkAuthLimit(req) {
  const key = req.socket.remoteAddress || 'local';
  const now = Date.now();
  const item = authAttempts.get(key) || { count: 0, started: now };
  if (now - item.started > 15 * 60 * 1000) { item.count = 0; item.started = now; }
  item.count += 1;
  authAttempts.set(key, item);
  return item.count <= 20;
}

async function routeApi(req, res, url, session, body) {
  const method = req.method;
  const pathname = url.pathname;
  const userId = session.user_id;

  if (method === 'GET' && pathname === '/api/bootstrap') {
    const user = userId ? stmt.userById.get(userId) : null;
    const suggestions = db.prepare('SELECT id, username, email, display_name, bio, avatar_url, created_at FROM users WHERE (? = 0 OR id <> ?) ORDER BY id LIMIT 5').all(userId || 0, userId || 0).map(safeUser);
    return sendJson(res, 200, { user: safeUser(user), csrfToken: session.csrf_token, suggestions });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    if (!checkAuthLimit(req)) return sendError(res, 429, 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.');
    const username = cleanText(body.username, 20).toLowerCase();
    const email = cleanText(body.email, 120).toLowerCase();
    const displayName = cleanText(body.displayName, 40);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return sendError(res, 400, 'Tên người dùng cần từ 3–20 ký tự, chỉ gồm chữ thường, số và dấu gạch dưới.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return sendError(res, 400, 'Email chưa hợp lệ.');
    if (displayName.length < 2) return sendError(res, 400, 'Tên hiển thị cần ít nhất 2 ký tự.');
    if (password.length < 8 || password.length > 72) return sendError(res, 400, 'Mật khẩu cần từ 8 đến 72 ký tự.');
    try {
      const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, email, hashPassword(password), displayName);
      stmt.deleteSession.run(session.token_hash);
      const newSess = newSession(res, Number(result.lastInsertRowid));
      return sendJson(res, 201, { user: safeUser(stmt.userById.get(Number(result.lastInsertRowid)), true), csrfToken: newSess.csrf_token });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return sendError(res, 409, 'Tên người dùng hoặc email đã được sử dụng.');
      throw error;
    }
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!checkAuthLimit(req)) return sendError(res, 429, 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.');
    const login = cleanText(body.login, 120);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = stmt.userByLogin.get(login, login);
    if (!user || !verifyPassword(password, user.password_hash)) return sendError(res, 401, 'Tên đăng nhập/email hoặc mật khẩu chưa chính xác.');
    stmt.deleteSession.run(session.token_hash);
    const newSess = newSession(res, user.id);
    return sendJson(res, 200, { user: safeUser(stmt.userById.get(user.id), true), csrfToken: newSess.csrf_token });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    stmt.deleteSession.run(session.token_hash);
    const newSess = newSession(res);
    return sendJson(res, 200, { ok: true, csrfToken: newSess.csrf_token });
  }

  if (method === 'GET' && pathname === '/api/feed') {
    const filter = url.searchParams.get('filter') === 'following' && userId ? 'following' : 'all';
    return sendJson(res, 200, { posts: getPosts(userId, filter) });
  }

  if (method === 'POST' && pathname === '/api/posts') {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập để thực hiện chức năng này.');
    const text = cleanText(body.body, 1000);
    const imageUrl = validImageUrl(cleanText(body.imageUrl, 1000));
    if (!text) return sendError(res, 400, 'Bạn chưa viết nội dung bài đăng.');
    if (imageUrl === null) return sendError(res, 400, 'Đường dẫn ảnh không hợp lệ. Hãy dùng URL http hoặc https.');
    const result = db.prepare('INSERT INTO posts (user_id, body, image_url) VALUES (?, ?, ?)').run(userId, text, imageUrl);
    return sendJson(res, 201, { post: getPosts(userId).find(post => post.id === Number(result.lastInsertRowid)) });
  }

  let match = pathname.match(/^\/api\/posts\/(\d+)$/);
  if (method === 'DELETE' && match) {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const result = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(Number(match[1]), userId);
    if (!result.changes) return sendError(res, 404, 'Không tìm thấy bài đăng hoặc bạn không có quyền xóa.');
    return sendJson(res, 200, { ok: true });
  }

  match = pathname.match(/^\/api\/posts\/(\d+)\/like$/);
  if (method === 'POST' && match) {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const postId = Number(match[1]);
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
    if (!post) return sendError(res, 404, 'Bài đăng không tồn tại.');
    const existing = db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(userId, postId);
    if (existing) db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(userId, postId);
    else {
      db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)').run(userId, postId);
      if (post.user_id !== userId) stmt.addNotification.run(post.user_id, userId, 'like', postId);
    }
    const count = db.prepare('SELECT COUNT(*) AS count FROM likes WHERE post_id = ?').get(postId).count;
    return sendJson(res, 200, { liked: !existing, likeCount: count });
  }

  match = pathname.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (method === 'GET' && match) {
    const postId = Number(match[1]);
    if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(postId)) return sendError(res, 404, 'Bài đăng không tồn tại.');
    const comments = db.prepare(`SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.display_name, u.avatar_url
      FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 100`).all(postId)
      .map(c => ({ id: c.id, body: c.body, createdAt: c.created_at, isMine: c.user_id === userId, author: { id: c.user_id, username: c.username, displayName: c.display_name, avatarUrl: c.avatar_url } }));
    return sendJson(res, 200, { comments });
  }
  if (method === 'POST' && match) {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const postId = Number(match[1]);
    const text = cleanText(body.body, 500);
    const post = db.prepare('SELECT id, user_id FROM posts WHERE id = ?').get(postId);
    if (!post) return sendError(res, 404, 'Bài đăng không tồn tại.');
    if (!text) return sendError(res, 400, 'Bình luận không được để trống.');
    const result = db.prepare('INSERT INTO comments (user_id, post_id, body) VALUES (?, ?, ?)').run(userId, postId, text);
    if (post.user_id !== userId) stmt.addNotification.run(post.user_id, userId, 'comment', postId);
    return sendJson(res, 201, { id: Number(result.lastInsertRowid), body: text });
  }

  match = pathname.match(/^\/api\/comments\/(\d+)$/);
  if (method === 'DELETE' && match) {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const result = db.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?').run(Number(match[1]), userId);
    if (!result.changes) return sendError(res, 404, 'Không tìm thấy bình luận hoặc bạn không có quyền xóa.');
    return sendJson(res, 200, { ok: true });
  }

  match = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (method === 'GET' && match) {
    const username = decodeURIComponent(match[1]);
    const user = stmt.userByUsername.get(username);
    if (!user) return sendError(res, 404, 'Không tìm thấy người dùng.');
    const followers = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?').get(user.id).count;
    const following = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?').get(user.id).count;
    const postsCount = db.prepare('SELECT COUNT(*) AS count FROM posts WHERE user_id = ?').get(user.id).count;
    const isFollowing = userId ? Boolean(db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(userId, user.id)) : false;
    return sendJson(res, 200, { profile: { ...safeUser(user), followers, following, postsCount, isFollowing, isMine: userId === user.id }, posts: getPosts(userId, 'all', user.id) });
  }

  match = pathname.match(/^\/api\/users\/(\d+)\/follow$/);
  if (method === 'POST' && match) {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const targetId = Number(match[1]);
    if (targetId === userId) return sendError(res, 400, 'Bạn không thể theo dõi chính mình.');
    const target = stmt.userById.get(targetId);
    if (!target) return sendError(res, 404, 'Không tìm thấy người dùng.');
    const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(userId, targetId);
    if (existing) db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(userId, targetId);
    else {
      db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(userId, targetId);
      stmt.addNotification.run(targetId, userId, 'follow', null);
    }
    const followers = db.prepare('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?').get(targetId).count;
    return sendJson(res, 200, { following: !existing, followers });
  }

  if (method === 'PATCH' && pathname === '/api/me') {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const displayName = cleanText(body.displayName, 40);
    const bio = cleanText(body.bio, 160);
    const avatarUrl = validImageUrl(cleanText(body.avatarUrl, 1000));
    if (displayName.length < 2) return sendError(res, 400, 'Tên hiển thị cần ít nhất 2 ký tự.');
    if (avatarUrl === null) return sendError(res, 400, 'Đường dẫn ảnh đại diện không hợp lệ.');
    db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?').run(displayName, bio, avatarUrl, userId);
    return sendJson(res, 200, { user: safeUser(stmt.userById.get(userId), true) });
  }

  if (method === 'GET' && pathname === '/api/search') {
    const term = cleanText(url.searchParams.get('q'), 50);
    if (!term) return sendJson(res, 200, { users: [] });
    const escaped = term.replace(/[\\%_]/g, ch => `\\${ch}`);
    const pattern = `%${escaped}%`;
    const users = db.prepare(`SELECT id, username, display_name, bio, avatar_url FROM users
      WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY display_name LIMIT 10`).all(pattern, pattern)
      .map(u => ({ id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, avatarUrl: u.avatar_url }));
    return sendJson(res, 200, { users });
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    const notifications = db.prepare(`SELECT n.id, n.type, n.post_id, n.is_read, n.created_at,
      u.username, u.display_name, u.avatar_url FROM notifications n JOIN users u ON u.id = n.actor_id
      WHERE n.recipient_id = ? ORDER BY n.id DESC LIMIT 40`).all(userId)
      .map(n => ({ id: n.id, type: n.type, postId: n.post_id, isRead: Boolean(n.is_read), createdAt: n.created_at, actor: { username: n.username, displayName: n.display_name, avatarUrl: n.avatar_url } }));
    const unread = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND is_read = 0').get(userId).count;
    return sendJson(res, 200, { notifications, unread });
  }
  if (method === 'POST' && pathname === '/api/notifications/read') {
    if (!requireUser(session)) return sendError(res, 401, 'Bạn cần đăng nhập.');
    db.prepare('UPDATE notifications SET is_read = 1 WHERE recipient_id = ?').run(userId);
    return sendJson(res, 200, { ok: true });
  }

  return sendError(res, 404, 'Không tìm thấy API này.');
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon'
};
function sendStatic(res, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return sendError(res, 400, 'Đường dẫn không hợp lệ.'); }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendError(res, 403, 'Không được phép truy cập đường dẫn này.');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) return sendError(res, 404, 'Không tìm thấy tệp.');
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendError(res, 400, 'Địa chỉ yêu cầu không hợp lệ.'); }

  if (url.pathname.startsWith('/api/')) {
    const cookies = parseCookies(req.headers.cookie || '');
    const incomingToken = cookies[COOKIE_NAME];
    const session = incomingToken ? stmt.findSession.get(hashToken(incomingToken), Date.now()) : null;
    const activeSession = session || newSession(res);
    if (Math.random() < 0.02) db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.headers['x-csrf-token'];
      if (!csrf || csrf !== activeSession.csrf_token) return sendError(res, 403, 'Phiên làm việc không hợp lệ. Hãy tải lại trang và thử lại.');
    }
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return sendError(res, 405, 'Phương thức không được hỗ trợ.');
    let body = {};
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      try { body = await readJson(req); }
      catch (error) { return sendError(res, error.status || 400, error.message); }
    }
    try { return await routeApi(req, res, url, activeSession, body); }
    catch (error) {
      console.error('API error:', error);
      return sendError(res, 500, 'Máy chủ gặp lỗi. Vui lòng thử lại.');
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') return sendStatic(res, url.pathname);
  return sendError(res, 405, 'Phương thức không được hỗ trợ.');
});

server.listen(PORT, () => {
  console.log(`\nV-HUB Social đang chạy tại: http://localhost:${PORT}`);
  console.log('Nhấn Ctrl + C để dừng máy chủ.\n');
});
function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
