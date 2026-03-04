import { validateInitData } from '../utils/telegram';
import { createDBClient, getUserByTelegramId, updateSubscriptionUrl } from '../utils/db';
import { RemnaWaveAPIClient } from '../utils/remnawave';

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

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
    return new Response(null, { 
        status: 204,
        headers: corsHeaders 
    });
};

export const onRequest: PagesFunction<Env> = async (context) => {
    const { request, env } = context;

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

        // Валидация
        const validation = await validateInitData(init_data, env.BOT_TOKEN);
        if (!validation.valid || !validation.data) {
            return new Response(
                JSON.stringify({ error: 'Invalid init data' }),
                { status: 401, headers: corsHeaders }
            );
        }

        const sql = createDBClient(env.DATABASE_URL);
        const user = await getUserByTelegramId(sql, validation.data.user.id);
        
        if (!user || !user.remnawave_uuid) {
            return new Response(
                JSON.stringify({ error: 'User not found' }),
                { status: 404, headers: corsHeaders }
            );
        }

        // Обновляем подписку в RemnaWave
        const rwClient = new RemnaWaveAPIClient({
            baseUrl: env.REMNAWAVE_API_URL,
            apiKey: env.REMNAWAVE_API_KEY,
            username: env.REMNAWAVE_USERNAME,
            password: env.REMNAWAVE_PASSWORD,
            authType: env.REMNAWAVE_AUTH_TYPE,
            secretKey: env.REMNAWAVE_SECRET_KEY
        });

        const updated = await rwClient.revokeUserSubscription(user.remnawave_uuid);

        // Обновляем URL в БД
        await updateSubscriptionUrl(sql, user.id, updated.subscription_url);

        return new Response(
            JSON.stringify({
                success: true,
                new_subscription_url: updated.subscription_url,
                new_short_uuid: updated.short_uuid,
                message: 'Подписка успешно обновлена'
            }),
            { headers: corsHeaders }
        );

    } catch (error: any) {
        console.error('Refresh error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: corsHeaders }
        );
    }
};