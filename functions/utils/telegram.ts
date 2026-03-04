// Валидация Telegram initData
export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

export interface InitData {
    user: TelegramUser;
    auth_date: number;
    query_id?: string;
    chat_type?: string;
    chat_instance?: string;
    start_param?: string;
}

export async function validateInitData(initData: string, botToken: string): Promise<{ valid: boolean; data?: InitData }> {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        
        if (!hash) {
            return { valid: false };
        }

        // Проверка времени (24 часа)
        const authDate = parseInt(params.get('auth_date') || '0');
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 86400) {
            return { valid: false };
        }

        // Создаем data_check_string
        params.delete('hash');
        const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
        const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

        // HMAC-SHA256
        const encoder = new TextEncoder();
        
        // secret_key = HMAC_SHA256("WebAppData", bot_token)
        const secretKeyData = await crypto.subtle.importKey(
            'raw',
            encoder.encode('WebAppData'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const secretKey = await crypto.subtle.sign('HMAC', secretKeyData, encoder.encode(botToken));
        
        // hash = HMAC_SHA256(secret_key, data_check_string)
        const key = await crypto.subtle.importKey(
            'raw',
            secretKey,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataCheckString));
        const calculatedHash = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        if (calculatedHash !== hash) {
            return { valid: false };
        }

        // Парсим user
        const userStr = params.get('user');
        if (!userStr) return { valid: false };

        const user: TelegramUser = JSON.parse(decodeURIComponent(userStr));
        
        return {
            valid: true,
            data: {
                user,
                auth_date: authDate,
                query_id: params.get('query_id') || undefined,
                chat_type: params.get('chat_type') || undefined,
                chat_instance: params.get('chat_instance') || undefined,
                start_param: params.get('start_param') || undefined
            }
        };

    } catch (e) {
        return { valid: false };
    }
}