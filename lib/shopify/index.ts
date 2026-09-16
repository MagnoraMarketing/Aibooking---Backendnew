export { normalizeMyshopifyDomain, isMyshopifyDomain, normalizeOrderNumber, orderNameMatches } from "./domain";
export { parseProductQuery, variantMatchesTerms } from "./product-search";
export {
  searchShopifyProducts,
  getShopifyProduct,
  productHandleFromIdentifier,
  type ShopifyProductResult,
} from "./products";
export { fetchShopifyShopInfo, type ShopifyPolicy, type ShopifyPolicyKind } from "./shop-info";
export { buildShopifyVapiTools, buildShopifyAnthropicTools } from "./tool-definitions";
export {
  SHOPIFY_TOOL_NAMES,
  isShopifyToolName,
  executeShopifyTool,
  resolveShopifyCapabilities,
  searchProducts,
  getProduct,
  getShopInfo,
  getOrderStatus,
  type ShopifyCapabilities,
} from "./agent-tools";
export { getConnectionSummary, loadOwnedWidget, loadAdminCredentials, toSummary } from "./connection";
export {
  buildShopifyAuthorizeUrl,
  exchangeShopifyCode,
  verifyCallbackHmac,
  generateOAuthState,
  shopifyRedirectUri,
  isShopifyOAuthConfigured,
  SHOPIFY_SCOPES,
} from "./oauth";
export type { ShopifyConnectionSummary, ShopifyConnectionStatus } from "./types";
