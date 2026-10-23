import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { loadConfig } from './config.js';
import { KtClient } from './kt/client.js';

test('domain configuration handles empty Compose values, aliases, and explicit precedence', t => {
  const originalEnv = process.env;
  t.after(() => { process.env = originalEnv; });
  const cases = [
    { domain: undefined, baseUrl: undefined, expected: 'kaloricketabulky.cz' },
    { domain: '', baseUrl: '', expected: 'kaloricketabulky.cz' },
    { domain: '  ', baseUrl: undefined, expected: 'kaloricketabulky.cz' },
    { domain: undefined, baseUrl: 'https://www.kaloricketabulky.sk', expected: 'https://www.kaloricketabulky.sk' },
    { domain: '', baseUrl: 'https://www.kaloricketabulky.sk', expected: 'https://www.kaloricketabulky.sk' },
    { domain: '  ', baseUrl: ' https://www.kaloricketabulky.sk/ ', expected: 'https://www.kaloricketabulky.sk/' },
    { domain: ' kaloricketabulky.sk ', baseUrl: 'https://www.kaloricketabulky.cz', expected: 'kaloricketabulky.sk' },
  ];
  for (const { domain, baseUrl, expected } of cases) {
    const environment: NodeJS.ProcessEnv = {
      KT_EMAIL: 'test@example.invalid', KT_PASSWORD: 'test',
      MCP_AUTH_PASSWORD: 'test-only-passphrase', PUBLIC_URL: 'https://mcp.example.invalid',
    };
    if (domain !== undefined) environment['KT_DOMAIN'] = domain;
    if (baseUrl !== undefined) environment['KT_BASE_URL'] = baseUrl;
    process.env = environment;
    const config = loadConfig();
    assert.equal(config.ktDomain, expected);
    const client = new KtClient({ email: config.ktEmail, password: config.ktPassword, domain: config.ktDomain });
    assert.equal(client.baseUrl, expected.includes('.sk') ? 'https://www.kaloricketabulky.sk' : 'https://www.kaloricketabulky.cz');
  }
});
