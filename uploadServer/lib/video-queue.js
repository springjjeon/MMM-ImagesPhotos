const path = require("path");
const { execFile } = require("child_process");
const { notifyMagicMirrorRefresh } = require("./process-utils");

const SCRIPT_PATH = path.resolve(__dirname, "../../convert_videos.sh");

const state = {
	running: false,
	currentFile: null,
	queue: [],
	recent: []
};

function pushHistory(entry) {
	state.recent.unshift({ ...entry, finishedAt: new Date().toISOString() });
	if (state.recent.length > 10) {
		state.recent.pop();
	}
}

function processNext() {
	if (state.running || state.queue.length === 0) return;

	const job = state.queue.shift();
	state.running = true;
	state.currentFile = job.label;

	const args = job.filePath ? [SCRIPT_PATH, job.filePath] : [SCRIPT_PATH];
	console.log(`[VideoQueue] Starting conversion: ${job.label}`);

	execFile("/bin/bash", args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
		const lines = (stdout || "").trim().split("\n").filter(Boolean);
		const summary = lines.length > 0 ? lines[lines.length - 1] : (error ? error.message : "완료");

		if (error) {
			console.error(`[VideoQueue] Failed (${job.label}): ${stderr || error.message}`);
			pushHistory({ file: job.label, status: "error", message: summary });
		} else {
			console.log(`[VideoQueue] Finished (${job.label}): ${summary}`);
			pushHistory({ file: job.label, status: "ok", message: summary });
			notifyMagicMirrorRefresh();
		}

		state.running = false;
		state.currentFile = null;
		processNext();
	});
}

function enqueueVideo(filePath, displayName) {
	state.queue.push({ filePath, label: displayName || path.basename(filePath) });
	processNext();
}

function enqueueAllVideos() {
	if (state.running && state.currentFile === "전체 동영상 일괄 변환") {
		return false;
	}
	const alreadyQueued = state.queue.some((j) => j.filePath === null);
	if (alreadyQueued) return false;
	state.queue.push({ filePath: null, label: "전체 동영상 일괄 변환" });
	processNext();
	return true;
}

function getStatus() {
	return {
		running: state.running,
		currentFile: state.currentFile,
		queuedCount: state.queue.length,
		recent: state.recent.slice(0, 5)
	};
}

module.exports = {
	enqueueVideo,
	enqueueAllVideos,
	getStatus
};
