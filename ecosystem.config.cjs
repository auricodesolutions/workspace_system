module.exports = {
  apps: [
    {
      name: "aurilink-api",
      cwd: __dirname,
      script: "npm",
      args: "run start -w @aurilink/api",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: { NODE_ENV: "production", PORT: "4000" },
    },
    {
      name: "aurilink-web",
      cwd: __dirname,
      script: "npm",
      args: "run start -w @aurilink/web -- -H 127.0.0.1 -p 3100",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "700M",
      env: { NODE_ENV: "production" },
    },
  ],
};
