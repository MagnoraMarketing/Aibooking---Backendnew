export { provisionPurchasedNumber, releasePhoneNumber } from "./service";
export { PHONE_NUMBER_CLIENT_COLUMNS } from "./columns";
export { provisionVapiNumberForWidget, provisionVapiNumbersForNewlyPaidCustomer } from "./vapi-provision";
// Server-side re-export only. A client component must import
// ./outbound directly — this barrel also pulls in ./service, which is
// server-only (Twilio, admin DB client).
export { outboundNumberIssue, canPlaceOutboundFrom } from "./outbound";
