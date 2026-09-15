export { normalizeShopUrl, normalizeMyshopifyDomain, isMyshopifyDomain, normalizeOrderNumber, orderNameMatches } from "./domain";
export { parseProductQuery, variantMatchesTerms } from "./product-search";
export { searchShopifyProducts, type ShopifyProductResult } from "./products";
export { formatShopifyKnowledge, replaceShopifySource, SHOPIFY_SOURCE_ID } from "./knowledge";
export { buildShopifyVapiTools, buildShopifyAnthropicTools } from "./tool-definitions";
export {
  SHOPIFY_TOOL_NAMES,
  isShopifyToolName,
  executeShopifyTool,
  resolveShopifyCapabilities,
  searchProducts,
  getOrderStatus,
  type ShopifyCapabilities,
} from "./agent-tools";
export { getConnectionSummary, loadOwnedWidget, loadAdminCredentials, toSummary } from "./connection";
export { syncShopifyWebshop, removeShopifyKnowledge, type ShopifySyncResult } from "./sync";
export {
  buildShopifyAuthorizeUrl,
  exchangeShopifyCode,
  verifyCallbackHmac,
  generateOAuthState,
  shopifyRedirectUri,
  isShopifyOAuthConfigured,
  SHOPIFY_SCOPES,
} from "./oauth";
export type { ShopifyConnectionSummary, ShopifyConnectionStatus, ShopifyCrawlStatus } from "./types";
