export class TenantAuthenticator {
  private readonly keys: Map<string, string>;

  constructor(serializedKeys = process.env.API_KEYS ?? '') {
    this.keys = new Map(serializedKeys.split(',').map((entry) => entry.trim().split(':', 2) as [string, string]).filter(([key, tenant]) => Boolean(key && tenant)));
  }

  isConfigured(): boolean { return this.keys.size > 0; }

  authenticate(apiKey: string | undefined, tenantId: string | undefined): boolean {
    if (!this.isConfigured()) return Boolean(tenantId);
    return Boolean(apiKey && tenantId && this.keys.get(apiKey) === tenantId);
  }
}
