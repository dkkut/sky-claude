// Клиент otpmock (https://otpmock.com) для сквозных тестов: читает SMS-коды из тестового ящика.
// Без зависимостей, Node 18+. Включается только когда заданы OTPMOCK_URL и OTPMOCK_API_KEY (тестовое окружение).
// Ключ берётся из переменной окружения и нигде не хранится.
export class OtpMock {
  constructor({ baseUrl = process.env.OTPMOCK_URL, apiKey = process.env.OTPMOCK_API_KEY } = {}) {
    if (!baseUrl || !apiKey) throw new Error('otpmock: задайте OTPMOCK_URL и OTPMOCK_API_KEY');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  /** Свой номер на каждый тест — параллельные тесты не читают чужие коды. */
  randomPhone(prefix = '+1555') {
    const rest = Array.from({ length: 12 - prefix.replace(/\D/g, '').length }, () => Math.floor(Math.random() * 10)).join('');
    return prefix + rest;
  }

  /** since — время (мс) ДО действия, которое отправляет SMS; старые коды игнорируются. */
  async waitForCode(phone, { since = Date.now() - 5_000, timeout = 15_000, interval = 300 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const res = await this.#request(`/v1/inbox/${encodeURIComponent(phone)}/code?since=${since}`);
      if (res.ok) return res.json();
      if (res.status !== 404) throw new Error(`otpmock: ${res.status} ${await res.text()}`);
      if (Date.now() >= deadline) throw new Error(`otpmock: для ${phone} код не пришёл за ${timeout} мс`);
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  async clear(phone) {
    await this.#request(`/v1/inbox/${encodeURIComponent(phone)}`, { method: 'DELETE' });
  }

  #request(path, init = {}) {
    return fetch(this.baseUrl + path, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${this.apiKey}` } });
  }
}
