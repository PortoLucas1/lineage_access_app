import { okOrThrow } from './api';

export type UcCatalog = {
  name: string;
  owner: string | null;
  comment: string | null;
};

export type UcSchema = {
  catalogName: string;
  name: string;
  fullName: string;
  owner: string | null;
  comment: string | null;
};

export type UcAsset = {
  catalogName: string;
  schemaName: string;
  name: string;
  fullName: string;
  tableType: string;
  owner: string | null;
  comment: string | null;
};

async function json<T>(url: string, label: string): Promise<T> {
  const response = await okOrThrow(await fetch(url), label);
  return response.json() as Promise<T>;
}

export function fetchUcCatalogs(search = ''): Promise<UcCatalog[]> {
  const query = new URLSearchParams();
  if (search.trim()) query.set('q', search.trim());
  return json(`/api/uc/catalogs?${query}`, '/api/uc/catalogs');
}

export function fetchUcSchemas(catalog: string): Promise<UcSchema[]> {
  const query = new URLSearchParams({ catalog });
  return json(`/api/uc/schemas?${query}`, '/api/uc/schemas');
}

export function fetchUcAssets(catalog: string, schema: string): Promise<UcAsset[]> {
  const query = new URLSearchParams({ catalog, schema });
  return json(`/api/uc/assets?${query}`, '/api/uc/assets');
}

export function searchUcAssets(
  search: string,
  catalog?: string,
  schema?: string,
): Promise<UcAsset[]> {
  const query = new URLSearchParams({ q: search.trim() });
  if (catalog) query.set('catalog', catalog);
  if (schema) query.set('schema', schema);
  return json(`/api/uc/search?${query}`, '/api/uc/search');
}
