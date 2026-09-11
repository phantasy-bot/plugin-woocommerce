import { BasePlugin, type PluginContext, type PluginTool } from "@phantasy/plugin-sdk";
export type StoreEnvironment = "staging" | "production" | "local";
export interface WooEnvCredentials {
    baseUrl?: string;
    consumerKey?: string;
    consumerSecret?: string;
}
export interface WooPluginConfig {
    /** @deprecated use environments.staging / environments.production */
    baseUrl?: string;
    consumerKey?: string;
    consumerSecret?: string;
    webhookSecret?: string;
    defaultEnvironment?: StoreEnvironment;
    environments?: {
        local?: WooEnvCredentials;
        staging?: WooEnvCredentials;
        production?: WooEnvCredentials;
    };
}
export declare class WooCommercePlugin extends BasePlugin {
    name: string;
    version: string;
    description: string;
    protected displayName: string;
    protected category: string;
    protected tags: string[];
    protected permissions: string[];
    protected workspace: "business";
    protected extensionKind: "integration";
    getTools(): PluginTool[];
    beforeChat(_context: PluginContext): Promise<{
        shouldContinue: boolean;
    }>;
}
export default WooCommercePlugin;
//# sourceMappingURL=index.d.ts.map