const http = require("http");
const path = require("path");
const { exec, execFile } = require("child_process");

const MODULE_ROOT = path.join(__dirname, "..", "..");
const CLEAN_NAMES_SCRIPT = path.join(MODULE_ROOT, "clean_names.py");
const MM_API_HOST = "localhost";
const MM_API_PORT = Number(process.env.MM_PORT || 8080);

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

function isMagicMirrorRunning(callback) {
	exec("pm2 pid mm", { timeout: 3000 }, (err, stdout) => {
		if (err) {
			callback(false);
			return;
		}
		const pid = (stdout || "").split("\n")[0].trim();
		callback(Boolean(pid && pid !== "0"));
	});
}

function callMagicMirrorApi(method, apiPath, bodyObj, callback) {
	const payload = bodyObj ? JSON.stringify(bodyObj) : null;
	const options = {
		hostname: MM_API_HOST,
		port: MM_API_PORT,
		path: `/MMM-ImagesPhotos/api${apiPath}`,
		method,
		timeout: 2500,
		headers: payload
			? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
			: {}
	};

	const req = http.request(options, (res) => {
		let data = "";
		res.on("data", (chunk) => {
			data += chunk;
		});
		res.on("end", () => {
			try {
				const parsed = JSON.parse(data);
				if (res.statusCode >= 200 && res.statusCode < 300) {
					callback(null, parsed);
				} else {
					callback(new Error(parsed.error || `HTTP ${res.statusCode}`), parsed);
				}
			} catch (e) {
				callback(new Error(`Invalid JSON (HTTP ${res.statusCode})`));
			}
		});
	});

	req.on("timeout", () => {
		req.destroy(new Error("MagicMirror API request timed out"));
	});
	req.on("error", (err) => {
		callback(err);
	});

	if (payload) {
		req.write(payload);
	}
	req.end();
}

/**
 * Triggers a live, zero-restart photo list refresh on MagicMirror when online.
 * If MagicMirror is stopped (e.g. night screen-off), skips waking it up.
 */
function notifyMagicMirrorRefresh(callback) {
	isMagicMirrorRunning((running) => {
		if (!running) {
			console.log("[MMM-ImagesPhotos] MagicMirror is stopped (screen-off). Skipping live refresh.");
			if (callback) callback(null, { mode: "skipped-stopped" });
			return;
		}
		callMagicMirrorApi("POST", "/refresh", {}, (err, data) => {
			if (!err) {
				console.log("[MMM-ImagesPhotos] ✅ Live photo list refreshed without restart.");
				if (callback) callback(null, { mode: "live-refresh", data });
			} else {
				console.warn(`[MMM-ImagesPhotos] Live refresh unavailable (${err.message}); skipping restart.`);
				if (callback) callback(null, { mode: "refresh-unavailable" });
			}
		});
	});
}

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
	isMagicMirrorRunning,
	callMagicMirrorApi,
	notifyMagicMirrorRefresh,
	restartMagicMirror
};
