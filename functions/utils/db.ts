import { neon, NeonQueryFunction } from '@neondatabase/serverless';

export interface User {
    id: number;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    balance: number;
    tariff: string;
    tariff_name: string | null;
    devices_limit: number;
    devices_count: number;
    expire_at: string;
    is_active: boolean;
    is_banned: boolean;
    subscription_url: string | null;
    remnawave_uuid: string;
    created_at: string;
}

// Создаем клиент БД
export function createDBClient(databaseUrl: string): NeonQueryFunction<any, any> {
    return neon(databaseUrl);
}

// Получаем пользователя по telegram_id
export async function getUserByTelegramId(
    sql: NeonQueryFunction<any, any>, 
    telegramId: number
): Promise<User | null> {
    const users = await sql`
        SELECT 
            id, telegram_id, username, first_name, last_name,
            balance, tariff, tariff_name, devices_limit, devices_count,
            expire_at, is_active, is_banned, subscription_url, remnawave_uuid, created_at
        FROM users 
        WHERE telegram_id = ${telegramId}
        LIMIT 1
    `;
    
    return users && users.length > 0 ? users[0] as User : null;
}

// Обновляем URL подписки
export async function updateSubscriptionUrl(
    sql: NeonQueryFunction<any, any>,
    userId: number,
    subscriptionUrl: string
): Promise<void> {
    await sql`
        UPDATE users 
        SET subscription_url = ${subscriptionUrl}, updated_at = NOW()
        WHERE id = ${userId}
    `;
}

// Рассчитываем оставшиеся дни
export function calculateDaysLeft(expireAt: string): number {
    const expire = new Date(expireAt);
    const now = new Date();
    const diff = expire.getTime() - now.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// Проверяем, истекла ли подписка
export function isExpired(expireAt: string): boolean {
    return new Date(expireAt) < new Date();
}