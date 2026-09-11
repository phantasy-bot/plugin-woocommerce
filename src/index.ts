import { BasePlugin, type PluginContext, type PluginTool } from "@phantasy/plugin-sdk";

export type StoreEnvironment = "staging" | "production" | "local";

export interface WooEnvCredentials {
  baseUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
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

function asRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

function readPluginConfig(context?: PluginContext): WooPluginConfig {
  const meta = context?.metadata?.pluginConfig;
  const fromMeta = meta && typeof meta === "object" ? (meta as WooPluginConfig) : {};
  // External plugin hosts execute tool handlers without a context argument.
  // Fall back to the explicitly allow-listed process environment in that mode.
  const runtimeEnv = (globalThis as { ENV?: Record<string, string | undefined> }).ENV;
  const env = (context?.env ?? runtimeEnv ??
    (typeof process !== "undefined" ? process.env : undefined)) as
    | Record<string, string | undefined>
    | undefined;
  const cfAccessClientId =
    env?.WC_CF_ACCESS_CLIENT_ID ?? env?.PHANTASY_AGENT_ACCESS_CLIENT_ID;
  const cfAccessClientSecret =
    env?.WC_CF_ACCESS_CLIENT_SECRET ?? env?.PHANTASY_AGENT_ACCESS_CLIENT_SECRET;

  const environments = {
    local: {
      baseUrl: fromMeta.environments?.local?.baseUrl ?? env?.WC_LOCAL_BASE_URL ?? env?.WC_BASE_URL,
      consumerKey:
        fromMeta.environments?.local?.consumerKey ??
        env?.WC_LOCAL_CONSUMER_KEY ??
        env?.WC_CONSUMER_KEY,
      consumerSecret:
        fromMeta.environments?.local?.consumerSecret ??
        env?.WC_LOCAL_CONSUMER_SECRET ??
        env?.WC_CONSUMER_SECRET,
      cfAccessClientId,
      cfAccessClientSecret,
    },
    staging: {
      baseUrl:
        fromMeta.environments?.staging?.baseUrl ??
        env?.WC_STAGING_BASE_URL ??
        fromMeta.baseUrl,
      consumerKey:
        fromMeta.environments?.staging?.consumerKey ??
        env?.WC_STAGING_CONSUMER_KEY ??
        fromMeta.consumerKey,
      consumerSecret:
        fromMeta.environments?.staging?.consumerSecret ??
        env?.WC_STAGING_CONSUMER_SECRET ??
        fromMeta.consumerSecret,
      cfAccessClientId,
      cfAccessClientSecret,
    },
    production: {
      baseUrl:
        fromMeta.environments?.production?.baseUrl ?? env?.WC_PRODUCTION_BASE_URL,
      consumerKey:
        fromMeta.environments?.production?.consumerKey ??
        env?.WC_PRODUCTION_CONSUMER_KEY,
      consumerSecret:
        fromMeta.environments?.production?.consumerSecret ??
        env?.WC_PRODUCTION_CONSUMER_SECRET,
      cfAccessClientId,
      cfAccessClientSecret,
    },
  };

  // Fallback: single WC_* fills staging if staging empty
  if (!environments.staging.baseUrl && env?.WC_BASE_URL) {
    environments.staging = {
      baseUrl: env.WC_BASE_URL,
      consumerKey: env.WC_CONSUMER_KEY,
      consumerSecret: env.WC_CONSUMER_SECRET,
      cfAccessClientId,
      cfAccessClientSecret,
    };
  }

  return {
    ...fromMeta,
    webhookSecret: fromMeta.webhookSecret ?? env?.WC_WEBHOOK_SECRET,
    defaultEnvironment:
      fromMeta.defaultEnvironment ??
      (env?.WC_DEFAULT_ENV as StoreEnvironment | undefined) ??
      "staging",
    environments,
  };
}

function resolveEnv(
  config: WooPluginConfig,
  requested: unknown,
): { name: StoreEnvironment; creds: WooEnvCredentials } {
  const name = (String(requested || config.defaultEnvironment || "staging")
    .toLowerCase()
    .trim() || "staging") as StoreEnvironment;
  if (name !== "staging" && name !== "production" && name !== "local") {
    throw new Error(`environment must be staging|production|local, got ${name}`);
  }
  const creds = config.environments?.[name] ?? {};
  if (!creds.baseUrl) {
    throw new Error(
      `WC ${name} is not configured (set environments.${name} or WC_${name.toUpperCase()}_* env)`,
    );
  }
  return { name, creds };
}

function authHeader(creds: WooEnvCredentials): string {
  return (
    "Basic " +
    Buffer.from(`${creds.consumerKey ?? ""}:${creds.consumerSecret ?? ""}`).toString(
      "base64",
    )
  );
}

function cloudflareAccessHeaders(creds: WooEnvCredentials): Record<string, string> {
  if (!creds.cfAccessClientId || !creds.cfAccessClientSecret) return {};
  return {
    "CF-Access-Client-Id": creds.cfAccessClientId,
    "CF-Access-Client-Secret": creds.cfAccessClientSecret,
  };
}

async function wcFetch(
  creds: WooEnvCredentials,
  path: string,
  init?: RequestInit & { namespace?: "wc/v3" | "phantasy/v1" },
): Promise<unknown> {
  const base = (creds.baseUrl ?? "").replace(/\/$/, "");
  if (!base) throw new Error("baseUrl required");
  if (!creds.consumerKey || !creds.consumerSecret) {
    throw new Error("consumerKey and consumerSecret required");
  }
  const ns = init?.namespace ?? "wc/v3";
  const clean = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}/wp-json/${ns}${clean}`;
  const { namespace: _ns, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: authHeader(creds),
      ...(rest.headers as Record<string, string> | undefined),
      ...cloudflareAccessHeaders(creds),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WooCommerce ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function requireApproval(args: Record<string, unknown>, tool: string): void {
  if (args.approved !== true) {
    throw new Error(
      `${tool} requires approved:true after human review (run on staging first, then promote)`,
    );
  }
}

function requireProductionApproval(
  envName: StoreEnvironment,
  args: Record<string, unknown>,
  tool: string,
): void {
  if (envName === "production") {
    requireApproval(args, `${tool} (production)`);
  }
}

const envParam = {
  environment: {
    type: "string" as const,
    description: "staging | production | local — default staging. Prefer staging for writes.",
    enum: ["staging", "production", "local"],
  },
};

export class WooCommercePlugin extends BasePlugin {
  name = "woocommerce";
  version = "0.2.0-beta";
  description =
    "Dual-env WooCommerce ops (staging + production). Test on staging; production writes need approval.";

  protected displayName = "WooCommerce";
  protected category = "commerce";
  protected tags = [
    "woocommerce",
    "commerce",
    "store",
    "orders",
    "fulfillment",
    "staging",
    "printful",
    "tapstitch",
  ];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;

  getTools(): PluginTool[] {
    return [
      {
        name: "wc_list_environments",
        description:
          "Show which store environments are configured (staging/production/local) and default. Never prints secrets.",
        parameters: { type: "object", properties: {} },
        handler: async (_args, context) => {
          const config = readPluginConfig(context);
          const envs = config.environments ?? {};
          const summarize = (c?: WooEnvCredentials) =>
            c?.baseUrl
              ? { configured: true, baseUrl: c.baseUrl, hasKeys: Boolean(c.consumerKey) }
              : { configured: false };
          return {
            defaultEnvironment: config.defaultEnvironment ?? "staging",
            environments: {
              local: summarize(envs.local),
              staging: summarize(envs.staging),
              production: summarize(envs.production),
            },
            policy:
              "Always apply and verify on staging before production. Production writes require approved:true.",
          };
        },
      },
      {
        name: "wc_health",
        description: "Connectivity check for a store environment.",
        parameters: {
          type: "object",
          properties: { ...envParam },
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const { name, creds } = resolveEnv(config, asRecord(args).environment);
          const base = (creds.baseUrl ?? "").replace(/\/$/, "");
          const healthRes = await fetch(`${base}/wp-json/phantasy/v1/health`, {
            headers: cloudflareAccessHeaders(creds),
          });
          const healthText = await healthRes.text();
          let health: unknown = null;
          try {
            health = healthText ? JSON.parse(healthText) : null;
          } catch {
            health = { raw: healthText.slice(0, 200) };
          }
          let restOk = false;
          try {
            await wcFetch(creds, "/products?per_page=1");
            restOk = true;
          } catch {
            restOk = false;
          }
          return {
            environment: name,
            ok: healthRes.ok && restOk,
            health,
            restAuthenticated: restOk,
            baseUrl: base,
          };
        },
      },
      {
        name: "wc_pod_providers",
        description: "List POD providers (printful, tapstitch) for the environment.",
        parameters: { type: "object", properties: { ...envParam } },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const { name, creds } = resolveEnv(config, asRecord(args).environment);
          try {
            const data = await wcFetch(creds, "/pod-providers", {
              namespace: "phantasy/v1",
            });
            return { environment: name, ...(data as object) };
          } catch {
            return {
              environment: name,
              providers: [
                { id: "printful", label: "Printful" },
                { id: "tapstitch", label: "Tapstitch" },
              ],
            };
          }
        },
      },
      {
        name: "wc_ops_summary",
        description: "Order counts by status for an environment.",
        parameters: { type: "object", properties: { ...envParam } },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const { name, creds } = resolveEnv(config, asRecord(args).environment);
          try {
            const data = await wcFetch(creds, "/ops/summary", {
              namespace: "phantasy/v1",
            });
            return { environment: name, ...(data as object) };
          } catch (e) {
            return {
              environment: name,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        },
      },
      {
        name: "wc_list_products",
        description: "List products in an environment.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            perPage: { type: "number" },
            status: { type: "string" },
            search: { type: "string" },
          },
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          const perPage = Math.min(100, Math.max(1, Number(a.perPage) || 20));
          const q = new URLSearchParams({ per_page: String(perPage) });
          if (a.status) q.set("status", String(a.status));
          if (a.search) q.set("search", String(a.search));
          const data = await wcFetch(creds, `/products?${q}`);
          return { environment: name, products: data };
        },
      },
      {
        name: "wc_get_product",
        description: "Get one product by id.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            id: { type: "number" },
          },
          required: ["id"],
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          const data = await wcFetch(creds, `/products/${Number(a.id)}`);
          return { environment: name, product: data };
        },
      },
      {
        name: "wc_update_product",
        description:
          "Update product / Phantasy meta. Production requires approved:true. Prefer staging first.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            id: { type: "number" },
            regularPrice: { type: "string" },
            status: { type: "string" },
            fulfillment: { type: "string" },
            podProvider: { type: "string" },
            isPreorder: { type: "boolean" },
            availableDate: { type: "string" },
            chargeMode: { type: "string" },
            storeStatus: { type: "string" },
            approved: {
              type: "boolean",
              description: "Required true for production writes",
            },
          },
          required: ["id"],
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          requireProductionApproval(name, a, "wc_update_product");
          try {
            const data = await wcFetch(creds, `/products/${Number(a.id)}`, {
              namespace: "phantasy/v1",
              method: "PATCH",
              body: JSON.stringify({
                regularPrice: a.regularPrice,
                status: a.status,
                fulfillment: a.fulfillment,
                podProvider: a.podProvider,
                isPreorder: a.isPreorder,
                availableDate: a.availableDate,
                chargeMode: a.chargeMode,
                storeStatus: a.storeStatus,
              }),
            });
            return { environment: name, product: data };
          } catch {
            const meta_data: Array<{ key: string; value: string }> = [];
            if (a.fulfillment !== undefined) {
              meta_data.push({
                key: "_phantasy_fulfillment",
                value: String(a.fulfillment),
              });
            }
            if (a.podProvider !== undefined) {
              meta_data.push({
                key: "_phantasy_pod_provider",
                value: String(a.podProvider),
              });
            }
            if (a.isPreorder !== undefined) {
              meta_data.push({
                key: "_phantasy_is_preorder",
                value: a.isPreorder ? "yes" : "no",
              });
            }
            if (a.storeStatus !== undefined) {
              meta_data.push({
                key: "_phantasy_store_status",
                value: String(a.storeStatus),
              });
            }
            const body: Record<string, unknown> = {};
            if (a.regularPrice !== undefined) body.regular_price = String(a.regularPrice);
            if (a.status !== undefined) body.status = a.status;
            if (meta_data.length) body.meta_data = meta_data;
            const data = await wcFetch(creds, `/products/${Number(a.id)}`, {
              method: "PUT",
              body: JSON.stringify(body),
            });
            return { environment: name, product: data };
          }
        },
      },
      {
        name: "wc_list_orders",
        description: "List orders in an environment.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            status: { type: "string" },
            perPage: { type: "number" },
          },
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          const perPage = Math.min(100, Math.max(1, Number(a.perPage) || 20));
          try {
            const q = new URLSearchParams({ per_page: String(perPage) });
            if (a.status) q.set("status", String(a.status));
            const data = await wcFetch(creds, `/orders?${q}`, {
              namespace: "phantasy/v1",
            });
            return { environment: name, ...(data as object) };
          } catch {
            const q = new URLSearchParams({
              per_page: String(perPage),
              orderby: "date",
              order: "desc",
            });
            if (a.status) q.set("status", String(a.status));
            const data = await wcFetch(creds, `/orders?${q}`);
            return { environment: name, orders: data };
          }
        },
      },
      {
        name: "wc_get_order",
        description: "Get one order by id.",
        parameters: {
          type: "object",
          properties: { ...envParam, id: { type: "number" } },
          required: ["id"],
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          try {
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`, {
              namespace: "phantasy/v1",
            });
            return { environment: name, order: data };
          } catch {
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`);
            return { environment: name, order: data };
          }
        },
      },
      {
        name: "wc_update_order_status",
        description:
          "Update order status. Production requires approved:true unless only staging.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            id: { type: "number" },
            status: { type: "string" },
            note: { type: "string" },
            approved: { type: "boolean" },
          },
          required: ["id", "status"],
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          requireProductionApproval(name, a, "wc_update_order_status");
          try {
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`, {
              namespace: "phantasy/v1",
              method: "PATCH",
              body: JSON.stringify({
                status: String(a.status),
                note: a.note !== undefined ? String(a.note) : undefined,
              }),
            });
            return { environment: name, order: data };
          } catch {
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`, {
              method: "PUT",
              body: JSON.stringify({ status: String(a.status) }),
            });
            return { environment: name, order: data };
          }
        },
      },
      {
        name: "wc_set_tracking",
        description: "Set tracking meta. Production requires approved:true.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            id: { type: "number" },
            trackingCarrier: { type: "string" },
            trackingNumber: { type: "string" },
            trackingUrl: { type: "string" },
            markShipped: { type: "boolean" },
            approved: { type: "boolean" },
          },
          required: ["id"],
        },
        handler: async (args, context) => {
          const config = readPluginConfig(context);
          const a = asRecord(args);
          const { name, creds } = resolveEnv(config, a.environment);
          requireProductionApproval(name, a, "wc_set_tracking");
          const body: Record<string, unknown> = {
            trackingCarrier: a.trackingCarrier,
            trackingNumber: a.trackingNumber,
            trackingUrl: a.trackingUrl,
          };
          if (a.markShipped) body.status = "completed";
          try {
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`, {
              namespace: "phantasy/v1",
              method: "PATCH",
              body: JSON.stringify(body),
            });
            return { environment: name, order: data };
          } catch {
            const meta_data: Array<{ key: string; value: string }> = [];
            if (a.trackingCarrier !== undefined) {
              meta_data.push({
                key: "_phantasy_tracking_carrier",
                value: String(a.trackingCarrier),
              });
            }
            if (a.trackingNumber !== undefined) {
              meta_data.push({
                key: "_phantasy_tracking_number",
                value: String(a.trackingNumber),
              });
            }
            if (a.trackingUrl !== undefined) {
              meta_data.push({
                key: "_phantasy_tracking_url",
                value: String(a.trackingUrl),
              });
            }
            const data = await wcFetch(creds, `/orders/${Number(a.id)}`, {
              method: "PUT",
              body: JSON.stringify({
                ...(a.markShipped ? { status: "completed" } : {}),
                meta_data,
              }),
            });
            return { environment: name, order: data };
          }
        },
      },
      {
        name: "wc_create_product",
        description:
          "APPROVAL REQUIRED always. Create simple product. Use staging first; production needs separate approved promote.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            name: { type: "string" },
            regularPrice: { type: "string" },
            sku: { type: "string" },
            description: { type: "string" },
            status: { type: "string" },
            fulfillment: { type: "string" },
            podProvider: { type: "string" },
            isPreorder: { type: "boolean" },
            storeStatus: { type: "string" },
            approved: { type: "boolean" },
          },
          required: ["name", "regularPrice", "approved"],
        },
        handler: async (args, context) => {
          const a = asRecord(args);
          requireApproval(a, "wc_create_product");
          const config = readPluginConfig(context);
          const { name, creds } = resolveEnv(config, a.environment);
          if (name === "production") {
            requireApproval(a, "wc_create_product production");
          }
          const meta_data = [
            {
              key: "_phantasy_fulfillment",
              value: String(a.fulfillment ?? "custom"),
            },
            {
              key: "_phantasy_pod_provider",
              value: String(a.podProvider ?? ""),
            },
            {
              key: "_phantasy_is_preorder",
              value: a.isPreorder ? "yes" : "no",
            },
            {
              key: "_phantasy_store_status",
              value: String(
                a.storeStatus ?? (a.isPreorder ? "pre-order" : "live"),
              ),
            },
          ];
          const data = await wcFetch(creds, "/products", {
            method: "POST",
            body: JSON.stringify({
              name: String(a.name),
              type: "simple",
              regular_price: String(a.regularPrice),
              description: a.description ? String(a.description) : "",
              sku: a.sku ? String(a.sku) : undefined,
              status: a.status ? String(a.status) : "draft",
              meta_data,
            }),
          });
          return { environment: name, product: data };
        },
      },
      {
        name: "wc_refund_order",
        description: "APPROVAL REQUIRED always. Full refund via WC.",
        parameters: {
          type: "object",
          properties: {
            ...envParam,
            id: { type: "number" },
            reason: { type: "string" },
            approved: { type: "boolean" },
          },
          required: ["id", "approved"],
        },
        handler: async (args, context) => {
          const a = asRecord(args);
          requireApproval(a, "wc_refund_order");
          const config = readPluginConfig(context);
          const { name, creds } = resolveEnv(config, a.environment);
          const id = Number(a.id);
          const order = (await wcFetch(creds, `/orders/${id}`)) as {
            total?: string;
          };
          const data = await wcFetch(creds, `/orders/${id}/refunds`, {
            method: "POST",
            body: JSON.stringify({
              amount: order.total,
              reason: a.reason ? String(a.reason) : "Agent-initiated refund",
              api_refund: true,
            }),
          });
          return { environment: name, refund: data };
        },
      },
      {
        name: "wc_compare_health",
        description:
          "Compare staging vs production health + order summary counts (read-only). Use before promote.",
        parameters: { type: "object", properties: {} },
        handler: async (_args, context) => {
          const config = readPluginConfig(context);
          const out: Record<string, unknown> = {};
          for (const envName of ["staging", "production"] as const) {
            try {
              const { creds } = resolveEnv(config, envName);
              const base = (creds.baseUrl ?? "").replace(/\/$/, "");
              const healthRes = await fetch(`${base}/wp-json/phantasy/v1/health`, {
                headers: cloudflareAccessHeaders(creds),
              });
              const health = await healthRes.json().catch(() => null);
              let summary: unknown = null;
              try {
                summary = await wcFetch(creds, "/ops/summary", {
                  namespace: "phantasy/v1",
                });
              } catch {
                summary = null;
              }
              out[envName] = {
                ok: healthRes.ok,
                baseUrl: base,
                health,
                summary,
              };
            } catch (e) {
              out[envName] = {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              };
            }
          }
          return out;
        },
      },
    ];
  }

  async beforeChat(_context: PluginContext) {
    return { shouldContinue: true };
  }
}

export default WooCommercePlugin;
