import { afterAll, expect, test } from "bun:test";
import type { ModelChannel } from "../src/stores/use-config-store";

// Config and i18n use browser storage during module initialization.
const values = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    },
});
afterAll(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
});

const { defaultConfig } = await import("../src/stores/use-config-store");
const { applySiteChannels, siteChannelId } = await import("../src/lib/site-channels");

const siteChannel = (groupId: number, apiKey: string): ModelChannel => ({
    id: siteChannelId(groupId),
    name: `group-${groupId}`,
    baseUrl: "https://site.example",
    apiKey,
    apiFormat: "openai",
    models: [
        { name: "gpt-image-2", capability: "image" },
        { name: "gpt-5.5", capability: "text" },
    ],
});
const ownChannel: ModelChannel = { id: "own", name: "own", baseUrl: "https://own.example", apiKey: "sk-own", apiFormat: "openai", models: [{ name: "own-video", capability: "video" }] };

test("site channels replace the unconfigured default channel and become the default models", () => {
    const next = applySiteChannels(defaultConfig, [siteChannel(1, "sk-a")]);
    expect(next.channels.map((channel) => channel.id)).toEqual(["site-1"]);
    expect(next.imageModel).toBe("site-1::gpt-image-2");
    expect(next.textModel).toBe("site-1::gpt-5.5");
    expect(next.models).toEqual(["site-1::gpt-image-2", "site-1::gpt-5.5"]);
});

test("user channels and model scripts survive a resync, and removed groups disappear", () => {
    const first = applySiteChannels({ ...defaultConfig, channels: [...defaultConfig.channels, ownChannel] }, [siteChannel(1, "sk-a"), siteChannel(2, "sk-b")]);
    first.channels[0].models[0].script = "return 1";
    const next = applySiteChannels(first, [siteChannel(1, "sk-a2")]);
    expect(next.channels.map((channel) => channel.id)).toEqual(["site-1", "own"]);
    expect(next.channels[0].apiKey).toBe("sk-a2");
    expect(next.channels[0].models[0].script).toBe("return 1");
    expect(next.videoModel).toBe("own::own-video");
});

test("signing out removes every site channel and its key", () => {
    const signedIn = applySiteChannels({ ...defaultConfig, channels: [ownChannel] }, [siteChannel(1, "sk-a")]);
    const next = applySiteChannels(signedIn, []);
    expect(next.channels.map((channel) => channel.id)).toEqual(["own"]);
    expect(JSON.stringify(next)).not.toContain("sk-a");
    expect(applySiteChannels(applySiteChannels(defaultConfig, [siteChannel(1, "sk-a")]), []).channels).toEqual(defaultConfig.channels);
});
