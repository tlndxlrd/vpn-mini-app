import { validateInitData } from '../utils/telegram';
import { createDBClient, getUserByTelegramId, calculateDaysLeft, isExpired } from '../utils/db';
import { RemnaWaveAPIClient } from '../utils/remnawave';

// Типы для окружения
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

// CORS заголовки
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// Обработчик OPTIONS запросов (CORS preflight)
export const onRequestOptions: PagesFunction<Env> = async () => {
    return new Response(null, { 
        status: 204,
        headers: corsHeaders 
    });
};

// Основной обработчик
export const onRequest: PagesFunction<Env> = async (context) => {
    const { request, env } = context;

    // Только POST запросы
    if (request.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: corsHeaders }
        );
    }

    try {
        const body = await request.json() as { init_data: string };
        const { init_data } = body;

        if (!init_data) {
            return new Response(
                JSON.stringify({ error: 'No init_data provided' }),
                { status: 400, headers: corsHeaders }
            );
        }

        // Валидация Telegram
        const validation = await validateInitData(init_data, env.BOT_TOKEN);
        if (!validation.valid || !validation.data) {
            return new Response(
                JSON.stringify({ error: 'Invalid Telegram init data' }),
                { status: 401, headers: corsHeaders }
            );
        }

        const tgUser = validation.data.user;

        // Подключение к БД (Neon HTTP)
        const sql = createDBClient(env.DATABASE_URL);
        
        // Получаем пользователя
        const user = await getUserByTelegramId(sql, tgUser.id);
        
        if (!user) {
            return new Response(
                JSON.stringify({
                    exists: false,
                    telegram_user: tgUser,
                    message: 'Пользователь не найден. Обратитесь к боту для регистрации.'
                }),
                { headers: corsHeaders }
            );
        }

        // Проверяем бан
        if (user.is_banned) {
            return new Response(
                JSON.stringify({
                    exists: false,
                    message: 'Аккаунт заблокирован.'
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
                    balance: user.balance / 100, // В рублях/долларах
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
                    trojan_password: rwUser.trojan_password,
                    vless_uuid: rwUser.vless_uuid
                } : null
            }),
            { headers: corsHeaders }
        );

    } catch (error: any) {
        console.error('Profile error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: corsHeaders }
        );
    }
};