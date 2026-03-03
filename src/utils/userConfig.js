/**
 * Minimal user identity system based on localStorage
 * Used for permission checks (e.g. who can hide a company)
 */
import employees from '../data/employees.json';

const STORAGE_KEY = 'alter5_current_user';

export function getCurrentUser() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return null;
    const parsed = JSON.parse(data);
    // Validate that the employee still exists
    if (!employees.find(e => e.id === parsed.id)) return null;
    return parsed; // { id, name, isAdmin }
  } catch {
    return null;
  }
}

export function setCurrentUser(id, isAdmin = false) {
  const emp = employees.find(e => e.id === id);
  if (!emp) return null;
  const user = { id: emp.id, name: emp.name, isAdmin };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

export function isAdmin() {
  const user = getCurrentUser();
  return user?.isAdmin === true;
}

export function getEmployeeList() {
  return employees;
}
