import { validateInitData } from '../utils/telegram';
import { createDBClient, getUserByTelegramId, calculateDaysLeft, isExpired } from '../utils/db';
import { RemnaWaveAPIClient, RemnaWaveAPIError } from '../utils/remnawave';

interface Env {
    BOT_TOKEN: string;
    DATABASE_URL: string;
    REMNAWAVE_API_URL: string;
    REMNAWAVE_API_KEY: string;
    REMNAWAVE_USERNAME: string;
    REMNAWAVE_PASSWORD: string;
    REMNAWAVE_AUTH_TYPE: string;
    REMNAWAVE_SECRET_KEY?: string;
}

interface ProfileRequest {
    init_data: string;
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
};

export const onRequestOptions: PagesFunction<Env> = async () => {
    return new Response(null, { 
        status: 204,
        headers: corsHeaders 
    });
};

export const onRequest: PagesFunction<Env> = async (context) => {
    const { request, env } = context;
    const requestId = crypto.randomUUID();

    // Только POST
    if (request.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed', requestId }),
            { status: 405, headers: corsHeaders }
        );
    }

    try {
        // Безопасно парсим тело запроса
        let body: ProfileRequest;
        try {
            const text = await request.text();
            if (!text || text.trim() === '') {
                return new Response(
                    JSON.stringify({ error: 'Empty request body', requestId }),
                    { status: 400, headers: corsHeaders }
                );
            }
            body = JSON.parse(text);
        } catch (e) {
            return new Response(
                JSON.stringify({ error: 'Invalid JSON in request body', requestId }),
                { status: 400, headers: corsHeaders }
            );
        }

        const { init_data } = body;

        if (!init_data) {
            return new Response(
                JSON.stringify({ error: 'No init_data provided', requestId }),
                { status: 400, headers: corsHeaders }
            );
        }

        // Валидация Telegram
        const validation = await validateInitData(init_data, env.BOT_TOKEN);
        if (!validation.valid || !validation.data) {
            return new Response(
                JSON.stringify({ error: 'Invalid Telegram init data', requestId }),
                { status: 401, headers: corsHeaders }
            );
        }

        const tgUser = validation.data.user;

        // Подключение к БД
        const sql = createDBClient(env.DATABASE_URL);
        
        // Получаем пользователя
        const user = await getUserByTelegramId(sql, tgUser.id);
        
        if (!user) {
            return new Response(
                JSON.stringify({
                    exists: false,
                    telegram_user: {
                        id: tgUser.id,
                        first_name: tgUser.first_name,
                        username: tgUser.username
                    },
                    message: 'Пользователь не найден. Обратитесь к боту для регистрации.',
                    requestId
                }),
                { headers: corsHeaders }
            );
        }

        // Проверяем бан
        if (user.is_banned) {
            return new Response(
                JSON.stringify({
                    exists: false,
                    message: 'Аккаунт заблокирован.',
                    requestId
                }),
                { status: 403, headers: corsHeaders }
            );
        }

        // Подключение к RemnaWave
        const rwClient = new RemnaWaveAPIClient({
            baseUrl: env.REMNAWAVE_API_URL,
            apiKey: env.REMNAWAVE_API_KEY,
            username: env.REMNAWAVE_USERNAME,
            password: env.REMNAWAVE_PASSWORD,
            authType: env.REMNAWAVE_AUTH_TYPE,
            secretKey: env.REMNAWAVE_SECRET_KEY
        });

        // Получаем данные RemnaWave
        const rwUser = await rwClient.getUserByUuid(user.remnawave_uuid);
        
        // Рассчитываем дни
        const daysLeft = calculateDaysLeft(user.expire_at);
        const expired = isExpired(user.expire_at);

        return new Response(
            JSON.stringify({
                exists: true,
                user: {
                    id: user.id,
                    telegram_id: user.telegram_id,
                    username: user.username,
                    first_name: user.first_name || tgUser.first_name,
                    last_name: user.last_name || tgUser.last_name,
                    language_code: tgUser.language_code,
                    balance: user.balance / 100,
                    tariff: user.tariff,
                    tariff_name: user.tariff_name || user.tariff,
                    devices_limit: user.devices_limit,
                    devices_count: user.devices_count,
                    days_left: daysLeft,
                    is_expired: expired,
                    is_active: user.is_active && !expired,
                    subscription_url: user.subscription_url,
                    expire_at: user.expire_at,
                    created_at: user.created_at
                },
                remnawave: rwUser ? {
                    uuid: rwUser.uuid,
                    short_uuid: rwUser.short_uuid,
                    status: rwUser.status,
                    used_traffic: rwUser.used_traffic_bytes,
                    lifetime_traffic: rwUser.lifetime_used_traffic_bytes,
                    traffic_limit: rwUser.traffic_limit_bytes,
                    online_at: rwUser.online_at,
                    subscription_url: rwUser.subscription_url,
                    happ_link: rwUser.happ_link,
                    happ_crypto_link: rwUser.happ_crypto_link,
                } : null,
                requestId
            }),
            { 
                headers: {
                    ...corsHeaders,
                    'X-Request-ID': requestId
                }
            }
        );

    } catch (error: any) {
        console.error(`Profile error [${requestId}]:`, error);
        
        const status = error instanceof RemnaWaveAPIError ? 502 : 500;
        const message = error instanceof RemnaWaveAPIError 
            ? 'RemnaWave service unavailable'
            : error.message || 'Internal server error';
        
        return new Response(
            JSON.stringify({ 
                error: message,
                requestId,
                ...(env.NODE_ENV === 'development' && { details: error.stack })
            }),
            { status, headers: corsHeaders }
        );
    }
};