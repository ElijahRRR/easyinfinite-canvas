import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { SITE_ENABLED } from "@/constant/runtime-config";
import { useConfigStore } from "@/stores/use-config-store";
import { redirectToSiteLogin, useSiteStore } from "@/stores/use-site-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    const siteStatus = useSiteStore((state) => state.status);
    const siteError = useSiteStore((state) => state.error);

    usePromptSourceScheduler();

    useEffect(() => {
        if (!SITE_ENABLED) return;
        const { sync, refreshUser } = useSiteStore.getState();
        void sync();
        // sub2api 页面登录、退出或切换账号时重新同步；回到画布页面时刷新余额。
        const onStorage = (event: StorageEvent) => {
            if (event.key === "auth_token") void sync();
        };
        const onVisible = () => {
            if (document.visibilityState === "visible") void refreshUser();
        };
        window.addEventListener("storage", onStorage);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            window.removeEventListener("storage", onStorage);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, []);

    useEffect(() => {
        if (siteStatus === "anonymous") void redirectToSiteLogin();
        if (siteStatus === "error") message.error(t("topNav.siteSyncFailed", { message: siteError }));
    }, [message, siteError, siteStatus, t]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") message.success(t("config.importedChannelCreated", { name: result.channelName }));
        else if (result.status === "updated") message.success(t("config.importedChannelUpdated", { name: result.channelName }));
        else if (result.status === "missing-base-url") message.error(t("config.importedChannelBaseUrlRequired"));
        else message.error(t("config.importedChannelBaseUrlInvalid"));
    }, [importChannelCredentials, message, openConfigDialog, t]);

    return <>{children}</>;
}
