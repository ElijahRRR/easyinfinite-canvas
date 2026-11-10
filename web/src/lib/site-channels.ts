import { defaultConfig, modelCapabilityOf, modelOptionsFromChannels, selectableModelsByCapability, type AiConfig, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

const SITE_CHANNEL_PREFIX = "site-";

export function siteChannelId(groupId: number) {
    return `${SITE_CHANNEL_PREFIX}${groupId}`;
}

export function isSiteChannel(channelId: string) {
    return channelId.startsWith(SITE_CHANNEL_PREFIX);
}

const DEFAULT_MODEL_KEYS: Array<[keyof Pick<AiConfig, "imageModel" | "videoModel" | "textModel" | "audioModel">, ModelCapability]> = [
    ["imageModel", "image"],
    ["videoModel", "video"],
    ["textModel", "text"],
    ["audioModel", "audio"],
];

/**
 * 用站点下发的渠道替换配置里的全部站点渠道，保留用户自己添加的渠道和已写好的模型脚本。
 * 传入空数组表示用户已退出站点登录，此时移除站点渠道及其中保存的 Key。
 */
export function applySiteChannels(config: AiConfig, siteChannels: ModelChannel[]): AiConfig {
    const previous = new Map(config.channels.filter((channel) => isSiteChannel(channel.id)).map((channel) => [channel.id, channel]));
    const merged = siteChannels.map((channel) => ({
        ...channel,
        models: channel.models.map((model) => ({ ...model, script: previous.get(channel.id)?.models.find((item) => item.name === model.name)?.script })),
    }));
    // 站点渠道可用时，没填 Key 的渠道（例如上游自带的默认渠道）只会让模型列表出现不可用项。
    const own = config.channels.filter((channel) => !isSiteChannel(channel.id) && (!merged.length || channel.apiKey.trim()));
    const channels = [...merged, ...own];
    const next: AiConfig = { ...config, channels: channels.length ? channels : defaultConfig.channels };
    next.models = modelOptionsFromChannels(next.channels);
    for (const [key, capability] of DEFAULT_MODEL_KEYS) {
        if (modelCapabilityOf(next, next[key]) !== capability) next[key] = selectableModelsByCapability(next, capability)[0] || next[key];
    }
    next.model = next.imageModel;
    return next;
}
