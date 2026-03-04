// RemnaWave API клиент для Cloudflare Workers
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

export class RemnaWaveAPIClient {
    private config: RemnaWaveConfig;
    
    constructor(config: RemnaWaveConfig) {
        this.config = config;
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Api-Key': this.config.apiKey,
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-For': '127.0.0.1',
            'X-Real-IP': '127.0.0.1',
        };

        // Basic auth если нужно
        if (this.config.authType === 'basic') {
            const credentials = btoa(`${this.config.username}:${this.config.password}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }

        return headers;
    }

    private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.config.baseUrl.replace(/\/$/, '')}/api${endpoint}`;
        
        const response = await fetch(url, {
            ...options,
            headers: {
                ...this.getHeaders(),
                ...options.headers,
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`RemnaWave API error: ${response.status} - ${text}`);
        }

        const data = await response.json();
        return data.response || data;
    }

    async getUserByTelegramId(telegramId: number): Promise<RemnaWaveUser | null> {
        try {
            const users = await this.request(`/users/by-telegram-id/${telegramId}`);
            if (!users || users.length === 0) return null;
            return this.parseUser(users[0]);
        } catch (e) {
            console.error('RemnaWave getUser error:', e);
            return null;
        }
    }

    async getUserByUuid(uuid: string): Promise<RemnaWaveUser | null> {
        try {
            const user = await this.request(`/users/${uuid}`);
            return this.parseUser(user);
        } catch (e) {
            console.error('RemnaWave getUserByUuid error:', e);
            return null;
        }
    }

    async revokeUserSubscription(uuid: string): Promise<RemnaWaveUser> {
        const user = await this.request(`/users/${uuid}/actions/revoke`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        return this.parseUser(user);
    }

    private parseUser(data: any): RemnaWaveUser {
        const userTraffic = data.userTraffic || {};
        
        return {
            uuid: data.uuid,
            short_uuid: data.shortUuid,
            username: data.username,
            status: data.status,
            traffic_limit_bytes: data.trafficLimitBytes || 0,
            traffic_limit_strategy: data.trafficLimitStrategy || 'NO_RESET',
            expire_at: data.expireAt,
            telegram_id: data.telegramId,
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
}