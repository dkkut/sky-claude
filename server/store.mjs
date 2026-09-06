import crypto from 'node:crypto';

const users = [
  { id: 'acc-luna', phone: '+79005550101', username: 'luna_nova', passwordHash: hash('demo1234') },
  { id: 'acc-neo', phone: '+79005550102', username: 'neon_driver', passwordHash: hash('demo1234') },
];

const refreshSessions = new Map();

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export const userStore = {
  findByPhone(phone) {
    return users.find((u) => u.phone === phone) || null;
  },
  verifyPassword(user, password) {
    return user.passwordHash === hash(password);
  },
};

export const sessionStore = {
  put(session) {
    refreshSessions.set(session.id, session);
  },
  get(id) {
    return refreshSessions.get(id) || null;
  },
  revoke(id) {
    refreshSessions.delete(id);
  },
};
