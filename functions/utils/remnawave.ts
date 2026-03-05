// RemnaWave API клиент для Cloudflare Workers с улучшенной обработкой JSON
export interface RemnaWaveConfig {
    baseUrl: string;
    apiKey: string;
    username: string;
    password: string;
    authType: string;
    secretKey?: string;
}

export interface RemnaWaveUser {
    uuid: string;
    short_uuid: string;
    username: string;
    status: 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';
    traffic_limit_bytes: number;
    traffic_limit_strategy: string;
    expire_at: string;
    telegram_id: number | null;
    subscription_url: string;
    used_traffic_bytes: number;
    lifetime_used_traffic_bytes: number;
    online_at: string | null;
    happ_link: string | null;
    happ_crypto_link: string | null;
    trojan_password: string | null;
    vless_uuid: string | null;
}

// Расширенная ошибка для API
export class RemnaWaveAPIError extends Error {
    constructor(
        message: string,
        public status: number,
        public statusText: string,
        public body?: string
    ) {
        super(message);
        this.name = 'RemnaWaveAPIError';
    }
}

export class RemnaWaveAPIClient {
    private config: RemnaWaveConfig;
    private cache = new Map<string, { data: any; timestamp: number }>();
    private readonly CACHE_TTL = 60000; // 1 минута кэша для часто запрашиваемых данных
    
    constructor(config: RemnaWaveConfig) {
        this.config = config;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'TelegramMiniApp/2026.0',
            'X-Api-Key': this.config.apiKey,
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-For': '127.0.0.1',
            'X-Real-IP': '127.0.0.1',
        };

        if (this.config.authType === 'basic') {
            const credentials = btoa(`${this.config.username}:${this.config.password}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }

        return headers;
    }

    private getCacheKey(endpoint: string, options?: RequestInit): string {
        return `${options?.method || 'GET'}:${endpoint}`;
    }

    private getCached<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.data as T;
        }
        this.cache.delete(key);
        return null;
    }

    private setCached(key: string, data: any): void {
        // Очищаем старые записи если кэш слишком большой
        if (this.cache.size > 100) {
            const oldest = [...this.cache.entries()]
                .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0];
            if (oldest) this.cache.delete(oldest[0]);
        }
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    private async request<T = any>(
        endpoint: string, 
        options: RequestInit = {},
        useCache: boolean = false
    ): Promise<T> {
        const url = `${this.config.baseUrl.replace(/\/$/, '')}/api${endpoint}`;
        const cacheKey = this.getCacheKey(endpoint, options);
        
        // Проверяем кэш для GET запросов
        if (useCache && options.method?.toUpperCase() === 'GET') {
            const cached = this.getCached<T>(cacheKey);
            if (cached) return cached;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...this.getHeaders(),
                    ...options.headers,
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Проверяем статус ответа
            if (!response.ok) {
                const text = await response.text();
                throw new RemnaWaveAPIError(
                    `RemnaWave API error: ${response.status}`,
                    response.status,
                    response.statusText,
                    text.substring(0, 500)
                );
            }

            // Проверяем на пустой ответ (204 No Content)
            if (response.status === 204) {
                return null as T;
            }

            // Проверяем Content-Type
            const contentType = response.headers.get('content-type');
            if (!contentType?.includes('application/json')) {
                const text = await response.text();
                console.warn('Non-JSON response from RemnaWave:', text.substring(0, 200));
                return null as T;
            }

            // Безопасно парсим JSON
            const text = await response.text();
            
            // Проверка на пустой ответ
            if (!text || text.trim() === '') {
                return null as T;
            }

            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error('Failed to parse RemnaWave response:', text.substring(0, 200));
                return null as T;
            }

            const result = (data.response || data) as T;
            
            // Кэшируем результат для GET запросов
            if (useCache && options.method?.toUpperCase() === 'GET' && result) {
                this.setCached(cacheKey, result);
            }

            return result;

        } catch (error: unknown) {
            clearTimeout(timeoutId);
            
            if (error instanceof RemnaWaveAPIError) {
                throw error;
            }
            
            if (error instanceof Error && error.name === 'AbortError') {
                throw new RemnaWaveAPIError('Request timeout', 408, 'Timeout');
            }
            
            throw new RemnaWaveAPIError(
                error instanceof Error ? error.message : 'Unknown error',
                500,
                'Internal Error'
            );
        }
    }

    async getUserByTelegramId(telegramId: number): Promise<RemnaWaveUser | null> {
        try {
            const users = await this.request<any[]>(`/users/by-telegram-id/${telegramId}`, {}, true);
            if (!users || users.length === 0) return null;
            return this.parseUser(users[0]);
        } catch (e) {
            console.error('RemnaWave getUser error:', e);
            return null;
        }
    }

    async getUserByUuid(uuid: string): Promise<RemnaWaveUser | null> {
        try {
            const user = await this.request<any>(`/users/${uuid}`, {}, true);
            if (!user) return null;
            return this.parseUser(user);
        } catch (e) {
            console.error('RemnaWave getUserByUuid error:', e);
            return null;
        }
    }

    async revokeUserSubscription(uuid: string): Promise<RemnaWaveUser> {
        const user = await this.request<any>(`/users/${uuid}/actions/revoke`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        
        if (!user) {
            throw new Error('Failed to revoke subscription: empty response');
        }
        
        return this.parseUser(user);
    }

    private parseUser(data: any): RemnaWaveUser {
        const userTraffic = data.userTraffic || {};
        
        return {
            uuid: data.uuid || '',
            short_uuid: data.shortUuid || '',
            username: data.username || '',
            status: data.status || 'DISABLED',
            traffic_limit_bytes: data.trafficLimitBytes || 0,
            traffic_limit_strategy: data.trafficLimitStrategy || 'NO_RESET',
            expire_at: data.expireAt || new Date().toISOString(),
            telegram_id: data.telegramId || null,
            subscription_url: data.subscriptionUrl || '',
            used_traffic_bytes: userTraffic.usedTrafficBytes || 0,
            lifetime_used_traffic_bytes: userTraffic.lifetimeUsedTrafficBytes || 0,
            online_at: userTraffic.onlineAt || null,
            happ_link: data.happ?.link || null,
            happ_crypto_link: data.happ?.cryptoLink || null,
            trojan_password: data.trojanPassword || null,
            vless_uuid: data.vlessUuid || null,
        };
    }

    // Новый метод: проверка здоровья API
    async healthCheck(): Promise<boolean> {
        try {
            const result = await this.request<{ status: string }>('/health', {}, true);
            return result?.status === 'ok';
        } catch {
            return false;
        }
    }
}