const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { exec, execFile } = require("child_process");
const fileUtils = require("../lib/file-utils");
const {
	isMagicMirrorRunning,
	callMagicMirrorApi,
	notifyMagicMirrorRefresh,
	restartMagicMirror
} = require("../lib/process-utils");
const videoQueue = require("../lib/video-queue");
const { render } = require("../lib/view-renderer");

function readCpuTempC() {
	try {
		const raw = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim();
		return Number((Number(raw) / 1000).toFixed(1));
	} catch (_) {
		return null;
	}
}

function readDiskUsage(callback) {
	exec("df -BG --output=size,used,avail,pcent / | tail -n 1", { timeout: 3000 }, (err, stdout) => {
		if (err || !stdout) return callback(null);
		const parts = stdout.trim().split(/\s+/);
		if (parts.length >= 4) {
			return callback({ total: parts[0], used: parts[1], avail: parts[2], percent: parts[3] });
		}
		callback(null);
	});
}

function readScreenStatus(callback) {
	execFile("/home/pi/ddc.sh", ["status"], { timeout: 4000 }, (err, stdout) => {
		if (err) return callback("unknown");
		const status = (stdout || "").trim().toLowerCase();
		callback(status === "on" || status === "off" ? status : "unknown");
	});
}

const BRIGHTNESS_CACHE_FILE = path.join(__dirname, "..", "..", ".cache", "brightness.json");

function readBrightnessSync() {
	try {
		if (fs.existsSync(BRIGHTNESS_CACHE_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(BRIGHTNESS_CACHE_FILE, "utf8"));
			if (parsed && typeof parsed.brightness === "number") {
				return Math.max(15, Math.min(100, Math.round(parsed.brightness)));
			}
		}
	} catch (_) {}
	return 100;
}

function saveBrightnessSync(val) {
	const dir = path.dirname(BRIGHTNESS_CACHE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const tmp = `${BRIGHTNESS_CACHE_FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ brightness: val, updatedAt: Date.now() }), "utf8");
	fs.renameSync(tmp, BRIGHTNESS_CACHE_FILE);
}

function readBrightness(callback) {
	callback(readBrightnessSync());
}

function setBrightness(value, callback) {
	const clamped = Math.max(15, Math.min(100, Math.round(Number(value))));
	if (Number.isNaN(clamped)) return callback(new Error("Invalid brightness value"));
	try {
		saveBrightnessSync(clamped);
	} catch (err) {
		return callback(err);
	}
	callMagicMirrorApi("POST", "/brightness", { value: clamped }, () => {
		callback(null, clamped);
	});
}

function createManagementRouter(uploadDir) {
	const router = express.Router();

	// --- Folder Management (Live Zero-Restart Refresh) ---
	router.post("/toggle-folder", (req, res) => {
		fileUtils.toggleFolderVisibility(uploadDir, req.body.folderName);
		notifyMagicMirrorRefresh(() => res.redirect("/"));
	});

	router.post("/show-all-folders", (req, res) => {
		fileUtils.renameAllDirectories(uploadDir, true);
		notifyMagicMirrorRefresh(() => res.redirect("/"));
	});

	router.post("/hide-all-folders", (req, res) => {
		fileUtils.renameAllDirectories(uploadDir, false);
		notifyMagicMirrorRefresh(() => res.redirect("/"));
	});

	router.post("/delete-folder", (req, res) => {
		const { folderName } = req.body;
		const protectedFolders = [path.basename(uploadDir), "mobileUpload"];
		const folderPath = path.join(uploadDir, folderName);
		if (protectedFolders.includes(path.basename(folderPath))) {
			return res.status(403).send('기본 폴더는 삭제할 수 없습니다. <a href="/">돌아가기</a>');
		}
		fileUtils.deleteFolder(uploadDir, folderName);
		notifyMagicMirrorRefresh(() => res.redirect("/"));
	});

	router.post("/create-subfolder", (req, res) => {
		const { parentFolder, subfolderName } = req.body;
		if (!parentFolder || !subfolderName || subfolderName.trim() === "") {
			return res.status(400).send('<h1>❌ 잘못된 요청</h1><p>상위 폴더와 하위 폴더 이름이 모두 필요합니다.</p><a href="/">돌아가기</a>');
		}
		const trimmedSubfolderName = subfolderName.trim();
		if (trimmedSubfolderName.includes("..") || trimmedSubfolderName.includes("/") || trimmedSubfolderName.includes("\\")) {
			return res.status(400).send('<h1>❌ 잘못된 폴더명</h1><p>하위 폴더 이름에 `..`, `/`, `\\` 문자를 사용할 수 없습니다.</p><a href="/">돌아가기</a>');
		}
		try {
			const newFolderPath = path.join(uploadDir, parentFolder, trimmedSubfolderName);
			if (!fs.existsSync(newFolderPath)) {
				fs.mkdirSync(newFolderPath, { recursive: true });
			}
			notifyMagicMirrorRefresh(() => {
				res.redirect(`/manage/photos?folderName=${encodeURIComponent(parentFolder)}`);
			});
		} catch (error) {
			res.status(500).send(`<h1>❌ 폴더 생성 실패</h1><p>${error.message}</p><a href="/">돌아가기</a>`);
		}
	});

	// --- Photo Management Page (Fast Cached 360px Thumbnails + EXIF Date Sort + Favorites) ---
	router.get("/photos", async (req, res) => {
		const folderName = req.query.folderName;
		const sortBy = req.query.sortBy || "exif_desc";

		if (!folderName) return res.redirect("/");

		const folderPath = path.join(uploadDir, folderName);
		if (!path.resolve(folderPath).startsWith(path.resolve(uploadDir)) || !fs.existsSync(folderPath)) {
			return res.status(404).send('<h1>❌ 폴더를 찾을 수 없습니다.</h1><a href="/">돌아가기</a>');
		}

		const subfolders = await fileUtils.getSubdirectories(folderPath);
		const subfolderListHtml =
			subfolders.length > 0
				? `<div class="subfolder-list-container">
					<h4>하위 폴더 목록</h4>
					<ul class="subfolder-list">
						${subfolders
							.map((sub) => {
								const subFullPath = path.join(folderName, sub.name);
								const displaySubName = sub.isHidden ? sub.name.substring(1) : sub.name;
								return `
									<li class="subfolder-item ${sub.isHidden ? "is-hidden" : ""}">
										<a href="/manage/photos?folderName=${encodeURIComponent(subFullPath)}" class="subfolder-link">
											<span>📁</span> ${displaySubName}
										</a>
										<div class="subfolder-actions">
											<form action="/manage/toggle-folder" method="post" style="margin: 0;">
												<input type="hidden" name="folderName" value="${subFullPath}">
												<button type="submit" class="action-btn toggle-btn ${sub.isHidden ? "show-btn" : "hide-btn"}">
													${sub.isHidden ? "보이기" : "숨기기"}
												</button>
											</form>
										</div>
									</li>`;
							})
							.join("")}
					</ul>
				</div>`
				: "";

		const mediaFiles = fileUtils.getMediaFiles(folderPath, sortBy, uploadDir);
		const photoListHtml =
			mediaFiles.length > 0
				? mediaFiles
						.map((fileInfo) => {
							const file = fileInfo.name;
							const isHidden = file.startsWith("!");
							const displayName = isHidden ? file.substring(1) : file;
							const encodedRel = path.join(folderName, file).split(path.sep).map(encodeURIComponent).join("/");
							const fullUrl = `/uploads/${encodedRel}`;
							const thumbUrl = `/thumb/${encodedRel}`;
							const ext = path.extname(file).toLowerCase();
							const isVideo = [".mp4", ".webm", ".ogg", ".mov"].includes(ext);

							const mediaElement = isVideo
								? `<video src="${fullUrl}#t=0.5" preload="metadata" muted playsinline style="cursor: pointer;" onclick="openFullscreen('${fullUrl}', '${ext}')"></video>`
								: `<img src="${thumbUrl}" alt="${displayName}" loading="lazy" decoding="async" style="cursor: pointer;" onclick="openFullscreen('${fullUrl}', '${ext}')">`;

							const favBtnStyle = fileInfo.isFavorite
								? "background:#f59f00; color:#111; font-weight:700;"
								: "background:#e9ecef; color:#495057;";

							return `
								<div class="photo-card ${isHidden ? "is-hidden" : ""}">
									<div class="photo-image-container">
										${mediaElement}
										${isVideo ? '<div class="video-indicator">▶</div>' : ""}
										${fileInfo.isFavorite ? '<div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,0.65);color:#ffd43b;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;">⭐</div>' : ""}
										${isHidden ? '<div class="hidden-overlay"><span>숨김</span></div>' : ""}
									</div>
									<div class="photo-name" title="${displayName}">
										${displayName}
										<div style="font-size:11px;color:#888;margin-top:2px;">🗓️ ${fileInfo.dateLabel || "-"}</div>
									</div>
									<div class="photo-actions">
										<form action="/manage/toggle-favorite" method="post" style="margin:0;">
											<input type="hidden" name="folderName" value="${folderName}">
											<input type="hidden" name="relPath" value="${fileInfo.relPath}">
											<input type="hidden" name="sortBy" value="${sortBy}">
											<button type="submit" class="action-btn" style="${favBtnStyle}">${fileInfo.isFavorite ? "★" : "☆"}</button>
										</form>
										<form action="/manage/toggle-photo" method="post" style="margin:0;">
											<input type="hidden" name="folderName" value="${folderName}"><input type="hidden" name="fileName" value="${file}">
											<button type="submit" class="action-btn toggle-btn ${isHidden ? "show-btn" : "hide-btn"}">${isHidden ? "보이기" : "숨기기"}</button>
										</form>
										<form action="/manage/delete-photo" method="post" onsubmit="return confirm('정말 이 파일을 삭제하시겠습니까?');" style="margin:0;">
											<input type="hidden" name="folderName" value="${folderName}"><input type="hidden" name="fileName" value="${file}">
											<button type="submit" class="action-btn delete-btn">삭제</button>
										</form>
									</div>
								</div>`;
						})
						.join("")
				: '<p class="no-photos-message">이 폴더에는 해당 미디어 파일이 없습니다.</p>';

		const sortLink = (key, text) => {
			const isActive = sortBy === key;
			const url = `?folderName=${encodeURIComponent(folderName)}&sortBy=${key}`;
			return `<a href="${url}" class="sort-link ${isActive ? "active" : ""}">${text}</a>`;
		};
		const sortLinks = `${sortLink("exif_desc", "촬영일 최신순")} ${sortLink("exif_asc", "촬영일 오래된순")} ${sortLink("fav_first", "⭐ 즐겨찾기 우선")} ${sortLink("name_asc", "이름순")}`;

		const pageContent = render("manage-photos", {
			displayName: folderName.replace(/!/g, "").split(path.sep).join(" / "),
			folderName,
			sortLinks,
			subfolderListHtml,
			photoListHtml
		});

		res.send(pageContent);
	});

	router.post("/toggle-favorite", (req, res) => {
		const { folderName, relPath, sortBy } = req.body;
		if (relPath) {
			fileUtils.toggleFavoritePath(relPath);
			callMagicMirrorApi("POST", "/refresh", {}, () => {});
		}
		res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName || "")}&sortBy=${encodeURIComponent(sortBy || "exif_desc")}`);
	});

	router.post("/toggle-photo", (req, res) => {
		const { folderName, fileName } = req.body;
		fileUtils.togglePhotoVisibility(uploadDir, folderName, fileName);
		notifyMagicMirrorRefresh(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
	});

	router.post("/delete-photo", (req, res) => {
		const { folderName, fileName } = req.body;
		fileUtils.deletePhoto(uploadDir, folderName, fileName);
		notifyMagicMirrorRefresh(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
	});

	router.post("/delete-all-photos", (req, res) => {
		const { folderName } = req.body;
		fileUtils.deleteAllPhotosInFolder(uploadDir, folderName);
		notifyMagicMirrorRefresh(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
	});

	router.post("/show-all-photos", (req, res) => {
		const { folderName } = req.body;
		if (folderName) {
			fileUtils.renameAllPhotosInFolder(path.join(uploadDir, folderName), true);
		}
		notifyMagicMirrorRefresh(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
	});

	router.post("/hide-all-photos", (req, res) => {
		const { folderName } = req.body;
		if (folderName) {
			fileUtils.renameAllPhotosInFolder(path.join(uploadDir, folderName), false);
		}
		notifyMagicMirrorRefresh(() => res.redirect(`/manage/photos?folderName=${encodeURIComponent(folderName)}`));
	});

	// --- Brightness Control API (DDC/CI VCP 0x10) ---
	router.get("/api/brightness", (req, res) => {
		readBrightness((brightness) => {
			if (brightness === null) {
				return res.status(503).json({ ok: false, error: "모니터 밝기 조회 불가" });
			}
			res.json({ ok: true, brightness });
		});
	});

	router.post("/api/brightness", (req, res) => {
		const val = req.body && req.body.value;
		setBrightness(val, (err, applied) => {
			if (err) return res.status(500).json({ ok: false, error: err.message });
			res.json({ ok: true, brightness: applied });
		});
	});

	// --- Remote Control & System Health APIs ---
	router.get("/api/system-status", (req, res) => {
		const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
		const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
		const usedMemMB = totalMemMB - freeMemMB;
		const cpuTempC = readCpuTempC();

		readDiskUsage((disk) => {
			isMagicMirrorRunning((mmRunning) => {
				readScreenStatus((screenStatus) => {
					const afterBrightness = (brightness) => {
						const finalize = (mmStatus) => {
							res.json({
								ok: true,
								cpuTempC,
								memory: { usedMB: usedMemMB, totalMB: totalMemMB, percent: Math.round((usedMemMB / totalMemMB) * 100) },
								disk,
								mmRunning,
								screenStatus,
								brightness,
								favoriteCount: fileUtils.loadFavorites().size,
								mm: mmStatus,
								videoQueue: videoQueue.getStatus()
							});
						};

						if (mmRunning) {
							callMagicMirrorApi("GET", "/status", null, (err, data) => {
								finalize(err ? null : data);
							});
						} else {
							finalize(null);
						}
					};

					readBrightness(afterBrightness);
				});
			});
		});
	});

	router.post("/api/remote", (req, res) => {
		const action = req.body && req.body.action;
		if (action === "screen-on") {
			execFile("/home/pi/screenOn.sh", [], { timeout: 15000 }, (err) => {
				if (err) return res.status(500).json({ ok: false, error: err.message });
				return res.json({ ok: true, action });
			});
			return;
		}
		if (action === "screen-off") {
			execFile("/home/pi/screenOff.sh", [], { timeout: 15000 }, (err) => {
				if (err) return res.status(500).json({ ok: false, error: err.message });
				return res.json({ ok: true, action });
			});
			return;
		}
		if (action === "hide-current") {
			callMagicMirrorApi("POST", "/hide-current", {}, (err, data) => {
				if (err) return res.status(500).json({ ok: false, error: err.message });
				return res.json({ ok: true, ...data });
			});
			return;
		}
		if (action === "toggle-favorite") {
			callMagicMirrorApi("POST", "/favorite", {}, (err, data) => {
				if (err) return res.status(500).json({ ok: false, error: err.message });
				return res.json({ ok: true, ...data });
			});
			return;
		}
		if (["next", "prev", "pause", "resume", "toggle-pause"].includes(action)) {
			callMagicMirrorApi("POST", "/control", { action }, (err, data) => {
				if (err) return res.status(500).json({ ok: false, error: err.message });
				return res.json({ ok: true, ...data });
			});
			return;
		}
		return res.status(400).json({ ok: false, error: "Unsupported action" });
	});

	router.post("/convert-all-videos", (req, res) => {
		const started = videoQueue.enqueueAllVideos();
		res.redirect(started ? "/?status=conversion_started" : "/?status=conversion_running");
	});

	router.post("/restart-mm", (req, res) => {
		restartMagicMirror((err) => {
			if (err) {
				res.status(500).json({ success: false, message: "Failed to restart MagicMirror." });
			} else {
				res.json({ success: true, message: "MagicMirror restart initiated." });
			}
		});
	});

	return router;
}

module.exports = createManagementRouter;
