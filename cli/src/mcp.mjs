/**
 * Cliente mínimo do servidor MCP do Delta (Streamable HTTP, ADR 0026).
 * Aceita resposta JSON ou SSE, guarda o id de sessão e a versão do protocolo negociada.
 */
export const PROTOCOL_VERSION = '2025-06-18';

export class McpError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class McpClient {
  #id = 0;
  #session = null;
  #protocol = null;

  constructor({ url, token, fetchImpl = globalThis.fetch, clientVersion = '0.1.0' }) {
    if (!url) throw new McpError('Falta o endereço do servidor (delta login --url ...).');
    if (!token) throw new McpError('Falta o token (delta login --token ...).');
    this.url = url.replace(/\/+$/, '').endsWith('/mcp') ? url.replace(/\/+$/, '') : `${url.replace(/\/+$/, '')}/mcp`;
    this.token = token;
    this.fetch = fetchImpl;
    this.clientVersion = clientVersion;
  }

  async connect() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'delta-cli', version: this.clientVersion },
    });
    this.#protocol = result?.protocolVersion ?? PROTOCOL_VERSION;
    await this.notify('notifications/initialized');
    return result;
  }

  async listTools() {
    return (await this.request('tools/list', {}))?.tools ?? [];
  }

  /** Chama a ferramenta e devolve o conteúdo já decodificado (JSON quando for JSON). */
  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    const text = (result?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (result?.isError) throw new McpError(text || `A ferramenta ${name} falhou.`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async getPrompt(name, args = {}) {
    return this.request('prompts/get', { name, arguments: args });
  }

  async listPrompts() {
    return (await this.request('prompts/list', {}))?.prompts ?? [];
  }

  async request(method, params) {
    const id = ++this.#id;
    const response = await this.#post({ jsonrpc: '2.0', id, method, params });
    const message = await this.#read(response, id);
    if (message.error) {
      throw new McpError(message.error.message ?? 'Erro do servidor MCP.', { code: message.error.code });
    }
    return message.result;
  }

  async notify(method, params) {
    await this.#post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  async #post(body) {
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.#session) headers['Mcp-Session-Id'] = this.#session;
    if (this.#protocol) headers['MCP-Protocol-Version'] = this.#protocol;

    let response;
    try {
      response = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (error) {
      throw new McpError(`Não foi possível falar com ${this.url} (${error?.cause?.code ?? error.message}).`);
    }

    const session = response.headers.get('mcp-session-id');
    if (session) this.#session = session;

    if (response.status === 401) throw new McpError('Token inválido, expirado ou revogado. Rode "delta login" de novo.', { status: 401 });
    if (response.status === 403) throw new McpError('O token não tem o escopo "mcp:tools". Crie um token com ele em Configurações › API e webhooks.', { status: 403 });
    if (response.status === 429) throw new McpError('Limite de chamadas atingido (120 por minuto por token). Tente em instantes.', { status: 429 });
    if (!response.ok && response.status !== 202) {
      const text = await response.text().catch(() => '');
      throw new McpError(`O servidor respondeu ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}.`, { status: response.status });
    }
    return response;
  }

  async #read(response, id) {
    const type = response.headers.get('content-type') ?? '';
    const text = await response.text();
    const messages = type.includes('text/event-stream')
      ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5).trim()))
      : [JSON.parse(text)];
    const message = messages.find((m) => m && m.id === id);
    if (!message) throw new McpError('Resposta do servidor MCP sem o resultado esperado.');
    return message;
  }
}
