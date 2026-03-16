module.exports = {
  apps: [
    {
      name: "A2A-AutoConnector",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      time: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};

