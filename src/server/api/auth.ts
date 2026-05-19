import { Router, Request, Response } from 'express';
import {
  isAdminConfigured,
  getAdminUsername,
  setAdminCredentials,
  verifyPassword,
  createSession,
  deleteSession,
  getSessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  getSettingValue,
} from '../auth.js';

const router = Router();

// Tells the frontend whether anyone's logged in and whether the system
// is still in open mode (no admin configured yet).
router.get('/me', (req: Request, res: Response) => {
  const adminRequired = isAdminConfigured();
  const session = getSessionFromRequest(req);
  res.json({
    admin_required: adminRequired,
    logged_in: !!session,
    username: session?.username ?? null,
  });
});

// First-run setup — only succeeds when no admin exists yet. After the
// initial admin is created, password change must go through PUT /password
// (which requires the current admin to be logged in).
router.post('/setup', (req: Request, res: Response) => {
  if (isAdminConfigured()) {
    return res.status(409).json({ error: 'Admin already configured. Use /password to change it.' });
  }
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  setAdminCredentials(username.trim(), password);
  // Log the new admin in immediately so they can keep going.
  const token = createSession(username.trim());
  setSessionCookie(res, token);
  res.status(201).json({ ok: true, username: username.trim() });
});

router.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const expected = getAdminUsername();
  const storedHash = getSettingValue('admin_password_hash');
  if (username.trim() !== expected || !verifyPassword(password, storedHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = createSession(expected);
  setSessionCookie(res, token);
  res.json({ ok: true, username: expected });
});

router.post('/logout', (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (session) deleteSession(session.token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.put('/password', (req: Request, res: Response) => {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Admin login required' });
  const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
  const storedHash = getSettingValue('admin_password_hash');
  if (!current_password || !verifyPassword(current_password, storedHash)) {
    return res.status(403).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'new password must be at least 8 characters' });
  }
  setAdminCredentials(session.username, new_password);
  res.json({ ok: true });
});

export default router;
