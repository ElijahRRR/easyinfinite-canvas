// Runtime configuration access layer.
// Priority: window.__RUNTIME_CONFIG__ (injected by the container entrypoint) > build-time VITE_ variables > defaults.
// This supports both configuring the same image with docker run -e and injecting values during custom builds.
//
// Each analytics provider has its own variable; configured providers are enabled independently and all are disabled by default.
// Only GA4 and Baidu are supported. Both accept IDs only, and script URLs are assembled in code without arbitrary scripts or inline JavaScript.

type RuntimeConfig = {
    ANALYTICS_GA4_ID?: string; // GA4 measurement ID (G-XXXX)
    ANALYTICS_BAIDU_ID?: string; // Baidu Analytics site ID
    SUB2API_ENABLED?: string; // "true" 时启用 sub2api 站点接入（画布需与 sub2api 同域部署）
    SUB2API_ASYNC_IMAGES?: string; // "true" 时站点渠道的图片请求走 sub2api 异步图片任务（需 sub2api 已开启且对象存储允许跨域读取）
};

declare global {
    interface Window {
        __RUNTIME_CONFIG__?: RuntimeConfig;
    }
}

const runtime: RuntimeConfig = (typeof window !== "undefined" && window.__RUNTIME_CONFIG__) || {};

function read(key: keyof RuntimeConfig, buildTime: string | undefined, fallback = ""): string {
    const value = runtime[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof buildTime === "string" && buildTime.trim()) return buildTime.trim();
    return fallback;
}

export const ANALYTICS_GA4_ID = read("ANALYTICS_GA4_ID", import.meta.env.VITE_ANALYTICS_GA4_ID);
export const ANALYTICS_BAIDU_ID = read("ANALYTICS_BAIDU_ID", import.meta.env.VITE_ANALYTICS_BAIDU_ID);
export const SITE_ENABLED = read("SUB2API_ENABLED", import.meta.env.VITE_SUB2API_ENABLED) === "true";
export const SITE_ASYNC_IMAGES = SITE_ENABLED && read("SUB2API_ASYNC_IMAGES", import.meta.env.VITE_SUB2API_ASYNC_IMAGES) === "true";
