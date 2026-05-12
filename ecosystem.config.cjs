// PM2 Ecosystem Config — mdconvert
// Giữ Next.js production server luôn chạy tại port 2023
// Auto-restart khi crash, auto-start khi reboot Mac

module.exports = {
  apps: [
    {
      name: 'mdconvert',
      script: 'node_modules/.bin/next',
      args: 'start -p 2023',
      cwd: '/Users/duy.truong/.gemini/antigravity/playground/mdconvert',
      env: {
        NODE_ENV: 'production',
        PORT: 2023,
        // Homebrew tools: pdftoppm, pdftotext, pdfinfo, gs
        PATH: `/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      },
      // Auto-restart settings
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000, // 3s trước khi restart lại
      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Memory limit — restart nếu leak quá 500MB
      max_memory_restart: '500M',
    },
  ],
};
