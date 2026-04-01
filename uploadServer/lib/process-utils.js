
const { exec } = require('child_process');

/**
 * Runs the clean_names.py script to sanitize filenames.
 * @param {function} callback - Optional. Called after the script finishes.
 */
function cleanFileNames(callback) {
    exec('python3 clean_names.py', (error, stdout, stderr) => {
        if (error) {
            console.error('Error executing clean_names.py:', stderr);
        }
        if (callback) {
            callback(error);
        }
    });
}

/**
 * Restarts MagicMirror using various methods.
 * @param {function} callback - Optional. Called after the restart command is issued.
 */
function restartMagicMirror(callback) {
    // 여러 방법을 순서대로 시도 (타임아웃 포함)
    const commands = [
        { cmd: 'pm2 restart MagicMirror', timeout: 5000 },
        { cmd: 'pm2 restart mm', timeout: 5000 },
        { cmd: 'systemctl restart magicmirror', timeout: 5000 }
        // sudo 명령은 비밀번호 때문에 제거 - 시스템 관리자가 설정해야 함
    ];
    
    let attemptIndex = 0;
    
    const tryNextMethod = () => {
        if (attemptIndex >= commands.length) {
            // 모든 방법이 실패한 경우
            console.warn(`
[MMM-ImagesPhotos] -------------------------------------------------
[MMM-ImagesPhotos] ⚠️  WARNING: Auto-restart failed
[MMM-ImagesPhotos] 
[MMM-ImagesPhotos] Files have been uploaded successfully, but could not
[MMM-ImagesPhotos] auto-restart MagicMirror. Please restart manually:
[MMM-ImagesPhotos]
[MMM-ImagesPhotos] Option 1 (if using PM2):
[MMM-ImagesPhotos]   npm install -g pm2
[MMM-ImagesPhotos]   pm2 restart MagicMirror
[MMM-ImagesPhotos]
[MMM-ImagesPhotos] Option 2 (if using systemctl):
[MMM-ImagesPhotos]   systemctl restart magicmirror
[MMM-ImagesPhotos] 
[MMM-ImagesPhotos] Option 3 (for passwordless sudo):
[MMM-ImagesPhotos]   sudo visudo
[MMM-ImagesPhotos]   Add: pi ALL=(ALL) NOPASSWD:/bin/systemctl restart magicmirror
[MMM-ImagesPhotos]
[MMM-ImagesPhotos] Option 4 (manual restart):
[MMM-ImagesPhotos]   1. SSH into your system
[MMM-ImagesPhotos]   2. Kill MagicMirror process
[MMM-ImagesPhotos]   3. Restart it manually
[MMM-ImagesPhotos] -------------------------------------------------
            `);
            if (callback) {
                callback(new Error('All restart methods failed'));
            }
            return;
        }
        
        const { cmd, timeout } = commands[attemptIndex];
        console.log(`[MMM-ImagesPhotos] Attempting restart method ${attemptIndex + 1}: ${cmd}`);
        
        const execProcess = exec(cmd, { timeout: timeout }, (error, stdout, stderr) => {
            if (error) {
                console.warn(`[MMM-ImagesPhotos] Method ${attemptIndex + 1} failed: ${error.message}`);
                attemptIndex++;
                tryNextMethod();
            } else {
                console.log(`[MMM-ImagesPhotos] ✅ MagicMirror restarted successfully using: ${cmd}`);
                if (callback) {
                    callback(null);
                }
            }
        });
    };
    
    tryNextMethod();
}

module.exports = {
    cleanFileNames,
    restartMagicMirror,
};
