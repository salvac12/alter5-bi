/**
 * Sistema de almacenamiento y cualificación de datos de empresas
 * Almacena datos manuales en localStorage
 */

const STORAGE_KEY = 'alter5_company_data';
const HIDDEN_COMPANIES_KEY = 'alter5_hidden_companies';
const ENRICHMENT_OVERRIDES_KEY = 'alter5_enrichment_overrides';

// Personal email domains (mirrors PERSONAL_DOMAINS in process_sheet_emails.py)
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "yahoo.com", "outlook.com",
  "live.com", "icloud.com", "yahoo.es", "hotmail.es",
  "googlemail.com", "protonmail.com", "me.com", "msn.com",
]);

/**
 * Detect if a company is suspicious (candidate for cleanup)
 * @returns {'personal_domain'|'low_value'|'no_enrichment'|null}
 */
export function isSuspiciousCompany(company) {
  if (PERSONAL_DOMAINS.has(company.domain)) return 'personal_domain';
  const isNoRelevante = company.role === 'No relevante' || company.group === 'Other' || company.group === 'No relevante';
  if (company.interactions <= 2 && isNoRelevante) return 'low_value';
  if (isNoRelevante && (!company.companyType || company.companyType === 'Other')) return 'no_enrichment';
  return null;
}

/**
 * Obtener todos los datos manuales de empresas
 */
export function getCompanyData() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Error loading company data:', error);
    return {};
  }
}

/**
 * Guardar datos manuales de una empresa
 */
export function saveCompanyData(domain, data) {
  try {
    const allData = getCompanyData();
    allData[domain] = {
      ...allData[domain],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    return true;
  } catch (error) {
    console.error('Error saving company data:', error);
    return false;
  }
}

/**
 * Obtener datos manuales de una empresa específica
 */
export function getCompanyDataByDomain(domain) {
  const allData = getCompanyData();
  return allData[domain] || {};
}

/**
 * Cualificar país basado en datos de la empresa
 * Por ahora retorna 'unknown', se implementará más adelante
 */
export function qualifyCountry(company) {
  // TODO: Implementar lógica de cualificación por idioma de correos
  // Por ahora verificamos si hay datos manuales guardados
  const manual = getCompanyDataByDomain(company.domain);
  if (manual.country) return manual.country;

  // Inferir por extensión de dominio
  if (company.domain.endsWith('.es')) return 'es';
  if (company.domain.endsWith('.fr')) return 'fr';
  if (company.domain.endsWith('.uk') || company.domain.endsWith('.co.uk')) return 'uk';
  if (company.domain.endsWith('.de')) return 'de';
  if (company.domain.endsWith('.it')) return 'it';
  if (company.domain.endsWith('.pt')) return 'pt';

  return 'unknown';
}

/**
 * Cualificar tamaño de empresa
 * Por ahora retorna 'unknown', se implementará más adelante con LinkedIn
 */
export function qualifyCompanySize(company) {
  // TODO: Implementar lógica de búsqueda en LinkedIn
  // Por ahora verificamos si hay datos manuales guardados
  const manual = getCompanyDataByDomain(company.domain);
  if (manual.employeesCount) {
    const count = manual.employeesCount;
    if (count <= 10) return 'micro';
    if (count <= 50) return 'small';
    if (count <= 200) return 'medium';
    if (count <= 500) return 'large';
    return 'xlarge';
  }

  return 'unknown';
}

/**
 * Exportar todas las funciones de cualificación
 */
export function qualifyCompany(company) {
  return {
    country: qualifyCountry(company),
    companySize: qualifyCompanySize(company),
  };
}

/**
 * Obtener lista de empresas ocultas
 */
export function getHiddenCompanies() {
  try {
    const data = localStorage.getItem(HIDDEN_COMPANIES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading hidden companies:', error);
    return [];
  }
}

/**
 * Ocultar/eliminar una empresa
 */
export function hideCompany(domain) {
  try {
    const hidden = getHiddenCompanies();
    if (!hidden.includes(domain)) {
      hidden.push(domain);
      localStorage.setItem(HIDDEN_COMPANIES_KEY, JSON.stringify(hidden));
    }
    return true;
  } catch (error) {
    console.error('Error hiding company:', error);
    return false;
  }
}

/**
 * Restaurar una empresa oculta
 */
export function unhideCompany(domain) {
  try {
    const hidden = getHiddenCompanies();
    const filtered = hidden.filter(d => d !== domain);
    localStorage.setItem(HIDDEN_COMPANIES_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error unhiding company:', error);
    return false;
  }
}

/**
 * Verificar si una empresa está oculta
 */
export function isCompanyHidden(domain) {
  const hidden = getHiddenCompanies();
  return hidden.includes(domain);
}

/**
 * Guardar contactos editados de una empresa
 */
export function saveCompanyContacts(domain, contacts) {
  try {
    const allData = getCompanyData();
    allData[domain] = {
      ...allData[domain],
      contacts: contacts,
      contactsUpdatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
    return true;
  } catch (error) {
    console.error('Error saving contacts:', error);
    return false;
  }
}

/**
 * Obtener contactos editados de una empresa (si existen)
 */
export function getCompanyContacts(domain) {
  const data = getCompanyDataByDomain(domain);
  return data.contacts || null;
}

/**
 * Obtener todos los overrides de enrichment (market roles, subtipo, fase)
 */
export function getAllEnrichmentOverrides() {
  try {
    const data = localStorage.getItem(ENRICHMENT_OVERRIDES_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Error loading enrichment overrides:', error);
    return {};
  }
}

/**
 * Guardar override de enrichment para una empresa
 * @param {string} domain
 * @param {{ mr?: string[], grp?: string, tp?: string, role?: string, seg?: string, tp2?: string, act?: string[], tech?: string[], geo?: string[] }} overrides
 */
export function saveEnrichmentOverride(domain, overrides) {
  try {
    const all = getAllEnrichmentOverrides();
    all[domain] = {
      ...all[domain],
      ...overrides,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(ENRICHMENT_OVERRIDES_KEY, JSON.stringify(all));
    return true;
  } catch (error) {
    console.error('Error saving enrichment override:', error);
    return false;
  }
}
