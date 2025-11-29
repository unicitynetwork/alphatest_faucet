/**
 * Base application error class
 */
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Resource not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

/**
 * Validation error for invalid input (400)
 */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

/**
 * Signature verification failed (400)
 */
export class SignatureError extends AppError {
  constructor(message = 'Signature verification failed') {
    super(message, 400);
  }
}

/**
 * Address already minted error (409 Conflict)
 */
export class AlreadyMintedError extends AppError {
  constructor(message = 'Address has already been minted') {
    super(message, 409);
  }
}

/**
 * Upstream faucet error (502 Bad Gateway)
 */
export class FaucetError extends AppError {
  constructor(message = 'Upstream faucet error') {
    super(message, 502);
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends AppError {
  constructor(message = 'Database operation failed') {
    super(message, 500);
  }
}
