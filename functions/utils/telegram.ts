// Валидация Telegram initData для 2026
export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    allows_write_to_pm?: boolean;
    photo_url?: string;
}

export interface InitData {
    user: TelegramUser;
    auth_date: number;
    query_id?: string;
    chat_type?: string;
    chat_instance?: string;
    start_param?: string;
    can_send_after?: number;
    hash: string;
}

export class ValidationError extends Error {
    constructor(message: string, public code: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

export async function validateInitData(
    initData: string, 
    botToken: string,
    maxAge: number = 86400 // 24 часа по умолчанию
): Promise<{ valid: true; data: InitData } | { valid: false; error: ValidationError }> {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        
        if (!hash) {
            return { 
                valid: false, 
                error: new ValidationError('Missing hash', 'MISSING_HASH')
            };
        }

        // Проверка времени
        const authDate = parseInt(params.get('auth_date') || '0');
        const now = Math.floor(Date.now() / 1000);
        
        if (authDate === 0) {
            return { 
                valid: false, 
                error: new ValidationError('Missing auth_date', 'MISSING_AUTH_DATE')
            };
        }
        
        if (now - authDate > maxAge) {
            return { 
                valid: false, 
                error: new ValidationError('Init data expired', 'EXPIRED')
            };
        }

        // Создаем data_check_string
        params.delete('hash');
        const entries = Array.from(params.entries())
            .filter(([key]) => !key.startsWith('_')) // Игнорируем приватные поля
            .sort(([a], [b]) => a.localeCompare(b));
            
        const dataCheckString = entries
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');

        // HMAC-SHA256 с использованием Web Crypto API
        const encoder = new TextEncoder();
        
        // secret_key = HMAC_SHA256("WebAppData", bot_token)
        const secretKeyData = await crypto.subtle.importKey(
            'raw',
            encoder.encode('WebAppData'),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const secretKey = await crypto.subtle.sign(
            'HMAC', 
            secretKeyData, 
            encoder.encode(botToken)
        );
        
        // hash = HMAC_SHA256(secret_key, data_check_string)
        const key = await crypto.subtle.importKey(
            'raw',
            secretKey,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        const signature = await crypto.subtle.sign(
            'HMAC', 
            key, 
            encoder.encode(dataCheckString)
        );
        
        const calculatedHash = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        if (calculatedHash !== hash) {
            return { 
                valid: false, 
                error: new ValidationError('Invalid hash signature', 'INVALID_HASH')
            };
        }

        // Парсим user
        const userStr = params.get('user');
        if (!userStr) {
            return { 
                valid: false, 
                error: new ValidationError('Missing user data', 'MISSING_USER')
            };
        }

        const user: TelegramUser = JSON.parse(decodeURIComponent(userStr));
        
        // Дополнительная валидация пользователя
        if (!user.id || !user.first_name) {
            return { 
                valid: false, 
                error: new ValidationError('Invalid user data', 'INVALID_USER')
            };
        }

        return {
            valid: true,
            data: {
                user,
                auth_date: authDate,
                query_id: params.get('query_id') || undefined,
                chat_type: params.get('chat_type') || undefined,
                chat_instance: params.get('chat_instance') || undefined,
                start_param: params.get('start_param') || undefined,
                can_send_after: params.get('can_send_after') 
                    ? parseInt(params.get('can_send_after')!) 
                    : undefined,
                hash
            }
        };

    } catch (e) {
        return { 
            valid: false, 
            error: new ValidationError(
                e instanceof Error ? e.message : 'Unknown validation error',
                'VALIDATION_FAILED'
            )
        };
    }
}

// Вспомогательная функция для безопасного парсинга initData на клиенте
export function parseInitData(initData: string): Partial<InitData> {
    try {
        const params = new URLSearchParams(initData);
        const result: Partial<InitData> = {};
        
        for (const [key, value] of params.entries()) {
            if (key === 'user') {
                try {
                    result.user = JSON.parse(decodeURIComponent(value));
                } catch {
                    // Игнорируем ошибку парсинга user
                }
            } else if (key === 'auth_date') {
                result.auth_date = parseInt(value);
            } else if (key === 'can_send_after') {
                result.can_send_after = parseInt(value);
            } else if (key === 'hash') {
                result.hash = value;
            } else {
                (result as any)[key] = value;
            }
        }
        
        return result;
    } catch {
        return {};
    }
}