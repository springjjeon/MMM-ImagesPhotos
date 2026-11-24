const path = require("path");
const { exec, execFile } = require("child_process");

const MODULE_ROOT = path.join(__dirname, "..", "..");
const CLEAN_NAMES_SCRIPT = path.join(MODULE_ROOT, "clean_names.py");

/**
 * Runs the clean_names.py script to sanitize filenames.
 * @param {function} callback - Optional. Called after the script finishes.
 */
function cleanFileNames(callback) {
	execFile("python3", [CLEAN_NAMES_SCRIPT], { cwd: MODULE_ROOT, timeout: 30000 }, (error, stdout, stderr) => {
		if (error) {
			console.error("[MMM-ImagesPhotos] Error executing clean_names.py:", stderr || error.message);
		} else if (stdout && stdout.trim()) {
			console.log(stdout.trim());
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
	const commands = [
		{ cmd: "pm2 restart mm", timeout: 5000 },
		{ cmd: "pm2 restart MagicMirror", timeout: 5000 },
		{ cmd: "systemctl restart magicmirror", timeout: 5000 }
	];

	let attemptIndex = 0;

	const tryNextMethod = () => {
		if (attemptIndex >= commands.length) {
			console.warn("[MMM-ImagesPhotos] ⚠️ Auto-restart failed. Please restart MagicMirror manually (e.g. `pm2 restart mm`).");
			if (callback) {
				callback(new Error("All restart methods failed"));
			}
			return;
		}

		const { cmd, timeout } = commands[attemptIndex];
		console.log(`[MMM-ImagesPhotos] Attempting restart method ${attemptIndex + 1}: ${cmd}`);

		exec(cmd, { timeout: timeout }, (error) => {
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
	restartMagicMirror
};
