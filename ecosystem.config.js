module.exports = {
  apps: [{
    name: 'ss-rayfaz',
    script: '/var/www/ss-rayfaz/backend/server.js',
    cwd: '/var/www/ss-rayfaz/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' }
  }]
};
