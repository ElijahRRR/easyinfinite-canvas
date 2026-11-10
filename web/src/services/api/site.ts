// sub2api 站点接入：画布与 sub2api 同域部署时，直接复用 sub2api 前端保存在 localStorage 的登录状态，
// 用它读取当前用户、可用分组，并自动取得或创建画布专用 API Key。
// 生成请求仍由浏览器用该 Key 直连 sub2api 网关，由网关按用户扣费。

// 与 sub2api 前端 stores/auth.ts 使用的键保持一致。
const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const TOKEN_EXPIRES_AT_KEY = "token_expires_at";
const USER_KEY = "auth_user";

/** 画布专用 Key 的名称；用户可在 sub2api 的 API 密钥页看到并管理。 */
export const SITE_KEY_NAME = "Infinite Canvas";

export type SiteUser = { id: number; email: string; username: string; balance: number };
export type SiteGroup = { id: number; name: string; platform: string; status?: string };
export type SiteApiKey = { id: number; key: string; name: string; group_id: number | null; status: string };
export type SiteMenuItem = { id: string; url: string };
type SitePlaza = { groups?: Array<{ id: number; models?: Array<{ name: string; pricing?: { billing_mode?: string } | null }> }> };

/** 未登录或登录已失效，需要回到 sub2api 重新登录。 */
export class SiteAuthError extends Error {}

export function siteOrigin() {
    return window.location.origin;
}

export function readSiteToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
}

/** sub2api 前端缓存的当前用户 ID，不发请求即可发现账号已切换。 */
export function readSiteUserId() {
    try {
        return String(JSON.parse(localStorage.getItem(USER_KEY) || "{}").id || "");
    } catch {
        return "";
    }
}

let refreshing: Promise<boolean> | null = null;

// 刷新令牌会轮换，必须把新值写回 sub2api 使用的键，否则 sub2api 页面会被登出。
function refreshSiteToken() {
    refreshing ||= (async () => {
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) return false;
        const response = await fetch(`${siteOrigin()}/api/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const payload = await response.json().catch(() => null);
        const data = payload?.data;
        if (!response.ok || !data?.access_token) return false;
        localStorage.setItem(TOKEN_KEY, data.access_token);
        if (data.refresh_token) localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        if (data.expires_in) localStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(Date.now() + data.expires_in * 1000));
        return true;
    })()
        .catch(() => false)
        .finally(() => {
            refreshing = null;
        });
    return refreshing;
}

async function siteRequest<T>(path: string, init?: { method?: string; body?: unknown }, retried = false): Promise<T> {
    const token = readSiteToken();
    if (!token) throw new SiteAuthError();
    const response = await fetch(`${siteOrigin()}/api/v1${path}`, {
        method: init?.method || "GET",
        headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
        body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (response.status === 401) {
        // 另一个标签页可能刚刷新过令牌；否则自己刷新一次再重试。
        if (!retried && (readSiteToken() !== token || (await refreshSiteToken()))) return siteRequest(path, init, true);
        throw new SiteAuthError();
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.message || `HTTP ${response.status}`);
    return payload.data as T;
}

export function fetchSiteUser() {
    return siteRequest<SiteUser>("/auth/me");
}

export async function fetchSiteGroups() {
    const groups = await siteRequest<SiteGroup[]>("/groups/available");
    return (groups || []).filter((group) => !group.status || group.status === "active");
}

export async function fetchSiteKeys() {
    const data = await siteRequest<{ items?: SiteApiKey[] }>(`/keys?page=1&page_size=1000&search=${encodeURIComponent(SITE_KEY_NAME)}`);
    return (data.items || []).filter((key) => key.name === SITE_KEY_NAME);
}

export function createSiteKey(groupId: number) {
    return siteRequest<SiteApiKey>("/keys", { method: "POST", body: { name: SITE_KEY_NAME, group_id: groupId } });
}

/** 模型广场可能被站点关闭；它只用于判断模型是图片还是视频计费，读不到时按模型名猜测。 */
export async function fetchSiteBillingModes() {
    const modes = new Map<string, string>();
    try {
        const plaza = await siteRequest<SitePlaza>("/model-plaza");
        for (const group of plaza.groups || []) {
            for (const model of group.models || []) {
                if (model.pricing?.billing_mode) modes.set(`${group.id}:${model.name}`, model.pricing.billing_mode);
            }
        }
    } catch (error) {
        if (error instanceof SiteAuthError) throw error;
    }
    return modes;
}

/** 公开设置里的自定义菜单，用于登录后跳回内嵌了画布的 sub2api 页面。 */
export async function fetchSiteMenuItems() {
    try {
        const response = await fetch(`${siteOrigin()}/api/v1/settings/public`);
        const payload = await response.json();
        return (payload?.data?.custom_menu_items || []) as SiteMenuItem[];
    } catch {
        return [];
    }
}
