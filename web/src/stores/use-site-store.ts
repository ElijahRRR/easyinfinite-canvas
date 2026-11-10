import { create } from "zustand";

import { SITE_ENABLED } from "@/constant/runtime-config";
import { applySiteChannels, siteChannelId } from "@/lib/site-channels";
import { fetchChannelModels } from "@/services/api/image";
import { createSiteKey, fetchSiteBillingModes, fetchSiteGroups, fetchSiteKeys, fetchSiteMenuItems, fetchSiteUser, readSiteToken, readSiteUserId, SiteAuthError, siteOrigin, type SiteUser } from "@/services/api/site";
import { createModelChannel, guessCapability, useConfigStore, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

type SiteStatus = "idle" | "syncing" | "ready" | "anonymous" | "error";

type SiteStore = {
    status: SiteStatus;
    user: SiteUser | null;
    error: string;
    /** 读取登录状态，自动准备各分组的专用 Key 并同步模型，结果写入站点渠道。 */
    sync: () => Promise<void>;
    /** 只刷新余额，不重新同步渠道。 */
    refreshUser: () => Promise<void>;
};

// 上次同步站点渠道时的用户 ID；账号变化时先清掉旧账号的 Key，再去同步新账号。
const SITE_USER_ID_KEY = "infinite-canvas:site_user_id";

const BILLING_CAPABILITY: Record<string, ModelCapability> = { image: "image", video: "video" };

async function buildSiteChannels(): Promise<ModelChannel[]> {
    const [groups, keys, billingModes] = await Promise.all([fetchSiteGroups(), fetchSiteKeys(), fetchSiteBillingModes()]);
    const channels = await Promise.all(
        groups.map(async (group) => {
            // 已存在的同名 Key 即使被停用也沿用，不绕过用户或管理员的停用操作。
            const key = keys.find((item) => item.group_id === group.id) || (await createSiteKey(group.id));
            const channel = createModelChannel({ id: siteChannelId(group.id), name: group.name, baseUrl: siteOrigin(), apiKey: key.key, apiFormat: group.platform === "gemini" ? "gemini" : "openai" });
            // 单个分组读不到模型（例如 Key 被停用）不影响其他分组。
            const names = await fetchChannelModels(channel).catch(() => [] as string[]);
            return { ...channel, models: names.map((name) => ({ name, capability: BILLING_CAPABILITY[billingModes.get(`${group.id}:${name}`) || ""] || guessCapability(name) })) };
        }),
    );
    return channels.filter((channel) => channel.models.length);
}

function setSiteChannels(channels: ModelChannel[]) {
    useConfigStore.setState((state) => ({ config: applySiteChannels(state.config, channels) }));
}

export const useSiteStore = create<SiteStore>()((set, get) => ({
    status: "idle",
    user: null,
    error: "",
    sync: async () => {
        if (!SITE_ENABLED || get().status === "syncing") return;
        if (!readSiteToken()) {
            setSiteChannels([]);
            set({ status: "anonymous", user: null, error: "" });
            return;
        }
        if (readSiteUserId() !== localStorage.getItem(SITE_USER_ID_KEY)) setSiteChannels([]);
        set({ status: "syncing", error: "" });
        try {
            // 多个标签页同时打开时串行执行，避免为同一分组重复创建 Key。
            const run = async () => ({ user: await fetchSiteUser(), channels: await buildSiteChannels() });
            const { user, channels } = navigator.locks ? await navigator.locks.request("infinite-canvas:site-sync", run) : await run();
            setSiteChannels(channels);
            localStorage.setItem(SITE_USER_ID_KEY, String(user.id));
            set({ status: "ready", user });
        } catch (error) {
            if (error instanceof SiteAuthError) {
                setSiteChannels([]);
                set({ status: "anonymous", user: null });
            } else {
                set({ status: "error", error: error instanceof Error ? error.message : String(error) });
            }
        }
    },
    refreshUser: async () => {
        if (get().status !== "ready") return;
        try {
            set({ user: await fetchSiteUser() });
        } catch {
            // 余额刷新失败不打断使用；登录失效会在下一次完整同步时处理。
        }
    },
}));

/** 跳到 sub2api 登录页；若后台用自定义菜单内嵌了画布，登录后直接回到那个页面。 */
export async function redirectToSiteLogin() {
    const base = new URL(import.meta.env.BASE_URL, siteOrigin()).pathname;
    const item = (await fetchSiteMenuItems()).find((menu) => {
        try {
            const url = new URL(menu.url, siteOrigin());
            return url.origin === siteOrigin() && url.pathname.replace(/\/?$/, "/") === base;
        } catch {
            return false;
        }
    });
    (window.top || window).location.href = `${siteOrigin()}/login${item ? `?redirect=${encodeURIComponent(`/custom/${item.id}`)}` : ""}`;
}
