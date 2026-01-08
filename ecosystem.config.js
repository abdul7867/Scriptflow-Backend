/**
 * PM2 Ecosystem Configuration - Production Process Management
 * 
 * Provides auto-restart, memory management, and graceful shutdown for t3.micro.
 * 
 * Features:
 * - Auto-restart on crash
 * - Memory limit enforcement (900MB)
 * - Graceful shutdown with 30s timeout
 * - Structured logging
 * 
 * @see PRD_System_Robustness_t3micro.txt Section 10.2
 */

module.exports = {
    apps: [{
        name: 'scriptflow',
        script: 'dist/index.js',
        instances: 1,  // Single instance for t3.micro (1GB RAM)
        exec_mode: 'fork',

        // ═══════════════════════════════════════════════════════════════════
        // MEMORY MANAGEMENT
        // ═══════════════════════════════════════════════════════════════════

        // Restart if memory exceeds 900MB (keep 100MB for OS)
        max_memory_restart: '900M',

        // ═══════════════════════════════════════════════════════════════════
        // CRASH RECOVERY
        // ═══════════════════════════════════════════════════════════════════

        autorestart: true,
        max_restarts: 10,           // Max restarts within restart_delay window
        min_uptime: '10s',          // Consider app started after 10s
        restart_delay: 4000,        // 4 second delay between restarts

        // ═══════════════════════════════════════════════════════════════════
        // HEALTH MONITORING
        // ═══════════════════════════════════════════════════════════════════

        watch: false,               // Disable file watching in production

        // ═══════════════════════════════════════════════════════════════════
        // ENVIRONMENT
        // ═══════════════════════════════════════════════════════════════════

        env: {
            NODE_ENV: 'production',
            // Limit Node.js heap to 512MB to leave room for other processes
            NODE_OPTIONS: '--max-old-space-size=512 --expose-gc'
        },

        env_development: {
            NODE_ENV: 'development',
            NODE_OPTIONS: '--max-old-space-size=512'
        },

        // ═══════════════════════════════════════════════════════════════════
        // LOGGING
        // ═══════════════════════════════════════════════════════════════════

        // Log files (create directory if needed: mkdir -p /var/log/scriptflow)
        error_file: '/var/log/scriptflow/error.log',
        out_file: '/var/log/scriptflow/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

        // Merge stdout and stderr into out file
        merge_logs: true,

        // Rotate logs at 10MB
        log_file: '/var/log/scriptflow/combined.log',

        // ═══════════════════════════════════════════════════════════════════
        // GRACEFUL SHUTDOWN
        // ═══════════════════════════════════════════════════════════════════

        // Time to wait for graceful shutdown before force kill
        kill_timeout: 30000,        // 30 seconds to finish current jobs

        // Wait for app to signal ready before considering started
        wait_ready: true,
        listen_timeout: 10000,      // 10s timeout for ready signal

        // SIGINT for graceful shutdown
        shutdown_with_message: true,

        // ═══════════════════════════════════════════════════════════════════
        // INSTANCE MANAGEMENT
        // ═══════════════════════════════════════════════════════════════════

        // Automatically balance load (not needed for single instance)
        instance_var: 'INSTANCE_ID',

        // Cluster mode settings (disabled for t3.micro)
        // exec_mode: 'cluster',
        // instances: 'max',
    }],

    // ═══════════════════════════════════════════════════════════════════════
    // DEPLOYMENT CONFIGURATION (Optional)
    // ═══════════════════════════════════════════════════════════════════════

    deploy: {
        production: {
            user: 'ubuntu',
            host: 'your-ec2-ip',
            ref: 'origin/main',
            repo: 'git@github.com:your-repo/scriptflow.git',
            path: '/home/ubuntu/scriptflow',
            'pre-deploy-local': '',
            'post-deploy': 'npm ci && npm run build && pm2 reload ecosystem.config.js --env production',
            'pre-setup': ''
        }
    }
};
