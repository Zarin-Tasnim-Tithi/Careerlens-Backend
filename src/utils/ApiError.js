// Operational error with a stable machine-readable code.
class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(message, details) { return new ApiError(400, 'BAD_REQUEST', message, details); }
  static validation(message, details) { return new ApiError(422, 'VALIDATION_ERROR', message, details); }
  static unauthorized(message = 'Authentication required') { return new ApiError(401, 'UNAUTHENTICATED', message); }
  static forbidden(message = 'You do not have permission to perform this action') { return new ApiError(403, 'FORBIDDEN', message); }
  static notFound(message = 'Resource not found') { return new ApiError(404, 'NOT_FOUND', message); }
  static conflict(message, code = 'CONFLICT') { return new ApiError(409, code, message); }
  static tooLarge(message) { return new ApiError(413, 'PAYLOAD_TOO_LARGE', message); }
}

module.exports = ApiError;
