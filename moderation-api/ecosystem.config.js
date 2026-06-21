module.exports = {
  apps: [
    {
      name: "moderation-api",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // keep at 1 — SQLite handles one writer at a time; see README
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // Prefer setting BOOTSTRAP_ADMIN_KEY in a real .env file (loaded via
        // dotenv at startup) or your secrets manager rather than here.
      },
      max_memory_restart: "300M",
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      time: true,
    },
  ],
};
