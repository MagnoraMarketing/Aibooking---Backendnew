export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "unauthorized", message);
  }

  static forbidden(message = "Not allowed to access this resource") {
    return new ApiError(403, "forbidden", message);
  }

  static notFound(message = "Resource not found") {
    return new ApiError(404, "not_found", message);
  }

  static badRequest(message = "Invalid request") {
    return new ApiError(400, "bad_request", message);
  }

  static conflict(message = "Conflict") {
    return new ApiError(409, "conflict", message);
  }

  static tooManyRequests(message = "Too many requests") {
    return new ApiError(429, "rate_limited", message);
  }

  static paymentRequired(message = "Payment required") {
    return new ApiError(402, "payment_required", message);
  }

  static internal(message = "Internal server error") {
    return new ApiError(500, "internal_error", message);
  }
}
