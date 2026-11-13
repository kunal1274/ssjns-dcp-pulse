// Keep integration/e2e output readable; set LOG_LEVEL explicitly to see API logs.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
// Auth tests use an in-memory mail capture; a high limit keeps rate limiting out of unrelated tests.
process.env.MAIL_TRANSPORT = process.env.MAIL_TRANSPORT ?? 'none';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? '1000';
