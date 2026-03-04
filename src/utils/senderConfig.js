/**
 * Sender configuration — localStorage CRUD for configurable campaign senders.
 */

const STORAGE_KEY = 'alter5_campaign_senders';

const DEFAULT_SENDERS = [
  { name: 'Leticia Menendez', email: 'leticia@alter-5.com' },
  { name: 'Salvador Carrillo', email: 'salvador.carrillo@alter-5.com' },
  { name: 'Javier Ruiz', email: 'javier.ruiz@alter-5.com' },
];

export function getSenders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* fall through */ }
  return [...DEFAULT_SENDERS];
}

export function saveSenders(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function addSender({ name, email }) {
  const senders = getSenders();
  if (senders.some(s => s.email.toLowerCase() === email.toLowerCase())) return senders;
  const updated = [...senders, { name, email }];
  saveSenders(updated);
  return updated;
}

export function removeSender(email) {
  const senders = getSenders().filter(s => s.email.toLowerCase() !== email.toLowerCase());
  saveSenders(senders);
  return senders;
}
