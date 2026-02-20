/**
 * Sistema de almacenamiento y cualificación de datos de empresas
 * Almacena datos manuales en localStorage
 */

const STORAGE_KEY = 'alter5_company_data';

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
