
const rateLimit = require("express-rate-limit");

const generalLimiter = rateLimit({
  windowMs: Number(process.env.GENERAL_RATE_WINDOW_MS || 15 * 60 * 1000), // default 15 minutes
  limit: Number(process.env.GENERAL_RATE_LIMIT || 200),                   // default 200 requests per IP (unchanged)

  standardHeaders: "draft-8",
  legacyHeaders: false,

  message: {
    success: false,
    message: "Too many requests. Please try again later."
  },

  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: "Too many requests. Please try again later.",
      retryAfter: res.getHeader("Retry-After")
    });
  }
});

module.exports = {
  generalLimiter
};
