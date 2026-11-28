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

const THUMB_DIR = path.join(__dirname, "..", "..", ".cache", "thumbs");
const BRIGHTNESS_CACHE_FILE = path.join(__dirname, "..", "..", ".cache", "brightness.json");
const DISPLAY_STATE_CACHE_FILE = path.join(__dirname, "..", "..", ".cache", "display-state.json");

function escapeHtml(str) {
	return String(str || "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function readCpuTempC() {
	try {
		const raw = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim();
		return Number((Number(raw) / 1000).toFixed(1));
	} catch (_) {
		return null;
	}
}

function countThumbCache() {
	try {
		if (!fs.existsSync(THUMB_DIR)) return 0;
		return fs.readdirSync(THUMB_DIR).filter((f) => f.endsWith(".jpg")).length;
	} catch (_) {
		return 0;
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

function readDisplayStateSync() {
	const defaults = {
		galleryMode: false,
		filterMode: "all",
		filterFolder: "",
		updateIntervalMs: 9000,
		motionStyle: "cinematic",
		transitionMode: "black"
	};
	try {
		if (fs.existsSync(DISPLAY_STATE_CACHE_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(DISPLAY_STATE_CACHE_FILE, "utf8"));
			if (parsed && typeof parsed === "object") {
				return {
					galleryMode: Boolean(parsed.galleryMode),
					filterMode: ["all", "favorites", "faces", "videos", "folder"].includes(parsed.filterMode) ? parsed.filterMode : "all",
					filterFolder: typeof parsed.filterFolder === "string" ? parsed.filterFolder : "",
					updateIntervalMs: typeof parsed.updateIntervalMs === "number" && parsed.updateIntervalMs >= 3000 ? Math.min(120000, Math.round(parsed.updateIntervalMs)) : 9000,
					motionStyle: ["cinematic", "calm", "still"].includes(parsed.motionStyle) ? parsed.motionStyle : "cinematic",
					transitionMode: ["black", "crossfade"].includes(parsed.transitionMode) ? parsed.transitionMode : "black"
				};
			}
		}
	} catch (_) {}
	return defaults;
}

function saveDisplayStateSync(state) {
	const dir = path.dirname(DISPLAY_STATE_CACHE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const tmp = `${DISPLAY_STATE_CACHE_FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
	fs.renameSync(tmp, DISPLAY_STATE_CACHE_FILE);
}

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
		notifyMagicMirrorRefresh(() => res.redirect("/#folders"));
	});

	router.post("/api/folder/toggle", (req, res) => {
		const folderName = req.body && req.body.folderName;
		const result = fileUtils.toggleFolderVisibility(uploadDir, folderName);
		if (!result) return res.status(404).json({ ok: false, error: "폴더를 찾을 수 없습니다." });
		notifyMagicMirrorRefresh(() => {
			res.json({ ok: true, ...result });
		});
	});

	router.post("/show-all-folders", (req, res) => {
		fileUtils.renameAllDirectories(uploadDir, true);
		notifyMagicMirrorRefresh(() => res.redirect("/#folders"));
	});

	router.post("/hide-all-folders", (req, res) => {
		fileUtils.renameAllDirectories(uploadDir, false);
		notifyMagicMirrorRefresh(() => res.redirect("/#folders"));
	});

	router.post("/delete-folder", (req, res) => {
		const { folderName } = req.body;
		const protectedFolders = [path.basename(uploadDir), "mobileUpload"];
		const folderPath = path.join(uploadDir, folderName);
		if (protectedFolders.includes(path.basename(folderPath))) {
			return res.status(403).send('기본 폴더는 삭제할 수 없습니다. <a href="/">돌아가기</a>');
		}
		fileUtils.deleteFolder(uploadDir, folderName);
		notifyMagicMirrorRefresh(() => res.redirect("/#folders"));
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
			res.status(500).send(`<h1>❌ 폴더 생성 실패</h1><p>${escapeHtml(error.message)}</p><a href="/">돌아가기</a>`);
		}
	});

	// --- Photo Management Page (Folder + Virtual Albums + Search + Ajax + Swipe + Batch + Rotate) ---
	router.get("/photos", async (req, res) => {
		const virtual = (req.query.virtual || "").toString().trim().toLowerCase();
		const folderName = (req.query.folderName || "").toString().trim();
		const sortBy = (req.query.sortBy || "exif_desc").toString().trim();
		const queryText = (req.query.q || "").toString().trim();
		const showAll = req.query.showAll === "1";

		const isVirtual = ["favorites", "recent", "videos", "all"].includes(virtual);
		if (!isVirtual && !folderName) {
			return res.redirect("/#folders");
		}

		let displayName = "";
		let subfolderListHtml = "";
		let mediaFiles = [];
		let totalCount = 0;
		let truncatedNoticeHtml = "";

		if (isVirtual) {
			const titles = {
				favorites: "⭐ 전체 즐겨찾기",
				recent: "🆕 최근 촬영 사진",
				videos: "🎬 전체 동영상",
				all: queryText ? `🔍 검색: "${queryText}"` : "🖼️ 전체 사진 모아보기"
			};
			displayName = titles[virtual] || "전체 사진";
			mediaFiles = fileUtils.getAllMediaFiles(uploadDir, { mode: virtual, sortBy, query: queryText });
			totalCount = mediaFiles.length;

			if ((virtual === "recent" || virtual === "all") && !queryText && !showAll && mediaFiles.length > 240) {
				mediaFiles = mediaFiles.slice(0, 240);
				truncatedNoticeHtml = `
					<div class="truncation-banner">
						전체 ${totalCount}개 중 최신 240개를 표시 중입니다.
						<a href="/manage/photos?virtual=${encodeURIComponent(virtual)}&sortBy=${encodeURIComponent(sortBy)}&showAll=1" class="mini-link-btn">전체 ${totalCount}개 모두 보기</a>
					</div>`;
			}
		} else {
			const safe = fileUtils.resolveSafeUploadPath(uploadDir, folderName);
			if (!safe || !fs.existsSync(safe.fullPath)) {
				return res.status(404).send('<h1>❌ 폴더를 찾을 수 없습니다.</h1><a href="/">돌아가기</a>');
			}
			displayName = `📁 ${folderName.replace(/!/g, "").split("/").join(" / ")}`;

			const subfolders = await fileUtils.getSubdirectories(safe.fullPath);
			if (subfolders.length > 0) {
				subfolderListHtml = `
					<div class="subfolder-list-container">
						<h4>하위 폴더</h4>
						<div class="subfolder-grid">
							${subfolders
								.map((sub) => {
									const subFullPath = path.join(folderName, sub.name).split(path.sep).join("/");
									const displaySubName = sub.isHidden ? sub.name.substring(1) : sub.name;
									return `
										<a href="/manage/photos?folderName=${encodeURIComponent(subFullPath)}" class="subfolder-link ${sub.isHidden ? "is-hidden" : ""}">
											<span class="subfolder-icon">📁</span>
											<span class="subfolder-name">${escapeHtml(displaySubName)}</span>
										</a>`;
								})
								.join("")}
						</div>
					</div>`;
			}

			mediaFiles = fileUtils.getMediaFiles(safe.fullPath, sortBy, uploadDir);
			totalCount = mediaFiles.length;
		}

		const photoListHtml =
			mediaFiles.length > 0
				? mediaFiles
						.map((fileInfo, idx) => {
							const file = fileInfo.name;
							const isHidden = fileInfo.isHidden;
							const displayFileName = isHidden ? file.substring(1) : file;
							const encodedRel = fileInfo.relPath.split("/").map(encodeURIComponent).join("/");
							const fullUrl = `/uploads/${encodedRel}`;
							const thumbUrl = `/thumb/${encodedRel}`;
							const downloadUrl = `/download/${encodedRel}`;
							const ext = fileInfo.ext;
							const isVideo = fileInfo.isVideo;
							const isRotatable = fileInfo.isRotatable;

							const mediaElement = isVideo
								? `<video src="${fullUrl}#t=0.5" preload="metadata" muted playsinline class="card-media"></video>`
								: `<img src="${thumbUrl}" alt="${escapeHtml(displayFileName)}" loading="lazy" decoding="async" class="card-media">`;

							const folderTag = isVirtual && fileInfo.folderRel
								? `<div class="photo-folder-tag">📁 ${escapeHtml(fileInfo.folderRel.replace(/!/g, ""))}</div>`
								: "";

							return `
								<div class="photo-card ${isHidden ? "is-hidden" : ""}"
									data-idx="${idx}"
									data-rel="${escapeHtml(fileInfo.relPath)}"
									data-url="${escapeHtml(fullUrl)}"
									data-thumb="${escapeHtml(thumbUrl)}"
									data-download="${escapeHtml(downloadUrl)}"
									data-ext="${escapeHtml(ext)}"
									data-name="${escapeHtml(displayFileName)}"
									data-date="${escapeHtml(fileInfo.dateLabel || "")}"
									data-folder="${escapeHtml(fileInfo.folderRel || "")}"
									data-fav="${fileInfo.isFavorite ? "1" : "0"}"
									data-hidden="${isHidden ? "1" : "0"}"
									data-video="${isVideo ? "1" : "0"}"
									data-rotatable="${isRotatable ? "1" : "0"}">
									<div class="photo-image-container" onclick="handleCardImageClick(this.closest('.photo-card'))">
										${mediaElement}
										<div class="select-check">✓</div>
										${isVideo ? '<div class="video-indicator">▶</div>' : ""}
										<div class="fav-corner-badge" style="display:${fileInfo.isFavorite ? "block" : "none"};">⭐</div>
										<div class="hidden-overlay" style="display:${isHidden ? "flex" : "none"};"><span>🙈 숨김</span></div>
									</div>
									<div class="photo-meta">
										<div class="photo-name" title="${escapeHtml(displayFileName)}">${escapeHtml(displayFileName)}</div>
										<div class="photo-date">🗓️ ${escapeHtml(fileInfo.dateLabel || "-")}</div>
										${folderTag}
									</div>
									<div class="photo-actions">
										<button type="button" class="action-btn cast-btn" onclick="castCard(this)" title="지금 액자에 띄우기">📺</button>
										<button type="button" class="action-btn fav-btn ${fileInfo.isFavorite ? "is-fav" : ""}" onclick="toggleFavCard(this)" title="즐겨찾기">${fileInfo.isFavorite ? "★" : "☆"}</button>
										<button type="button" class="action-btn toggle-btn ${isHidden ? "show-btn" : "hide-btn"}" onclick="toggleHideCard(this)" title="숨기기/보이기">${isHidden ? "보이기" : "숨기기"}</button>
										<button type="button" class="action-btn delete-btn" onclick="deleteCard(this)" title="삭제">삭제</button>
									</div>
								</div>`;
						})
						.join("")
				: '<p class="no-photos-message">표시할 사진·동영상이 없습니다.</p>';

		const buildSortUrl = (key) => {
			const params = new URLSearchParams();
			if (isVirtual) params.set("virtual", virtual);
			else params.set("folderName", folderName);
			params.set("sortBy", key);
			if (queryText) params.set("q", queryText);
			if (showAll) params.set("showAll", "1");
			return `?${params.toString()}`;
		};

		const sortLink = (key, text) =>
			`<a href="${buildSortUrl(key)}" class="sort-link ${sortBy === key ? "active" : ""}">${text}</a>`;
		const sortLinks = `${sortLink("exif_desc", "촬영일 최신순")} ${sortLink("exif_asc", "오래된순")} ${sortLink("fav_first", "⭐ 즐겨찾기 우선")} ${sortLink("name_asc", "이름순")}`;

		const virtualTabsHtml = `
			<div class="virtual-tabs">
				<a href="/manage/photos?virtual=favorites" class="vtab ${virtual === "favorites" ? "active" : ""}">⭐ 전체 즐겨찾기</a>
				<a href="/manage/photos?virtual=recent" class="vtab ${virtual === "recent" ? "active" : ""}">🆕 최근 촬영순</a>
				<a href="/manage/photos?virtual=videos" class="vtab ${virtual === "videos" ? "active" : ""}">🎬 전체 동영상</a>
				<a href="/#folders" class="vtab">📁 폴더 목록</a>
			</div>`;

		const pageContent = render("manage-photos", {
			displayName: escapeHtml(displayName),
			folderName: escapeHtml(folderName),
			totalCount: String(totalCount),
			shownCount: String(mediaFiles.length),
			isVirtualClass: isVirtual ? "is-virtual" : "",
			queryText: escapeHtml(queryText),
			virtualTabsHtml,
			sortLinks,
			subfolderListHtml,
			truncatedNoticeHtml,
			photoListHtml
		});

		res.send(pageContent);
	});

	// --- Ajax Photo Action APIs (Zero Page Reload) ---
	router.post("/api/photo/favorite", (req, res) => {
		const relPath = req.body && req.body.relPath;
		if (!relPath || typeof relPath !== "string") {
			return res.status(400).json({ ok: false, error: "사진 경로가 필요합니다." });
		}
		const result = fileUtils.toggleFavoritePath(relPath);
		callMagicMirrorApi("POST", "/refresh", {}, () => {});
		res.json({ ok: true, relPath: fileUtils.normalizeRelPath(relPath), ...result });
	});

	router.post("/api/photo/toggle-hide", (req, res) => {
		const relPath = req.body && req.body.relPath;
		const forceHidden = typeof req.body.hidden === "boolean" ? req.body.hidden : null;
		if (!relPath || typeof relPath !== "string") {
			return res.status(400).json({ ok: false, error: "사진 경로가 필요합니다." });
		}
		const result = fileUtils.togglePhotoByRelPath(uploadDir, relPath, forceHidden);
		if (!result) {
			return res.status(404).json({ ok: false, error: "파일을 찾을 수 없습니다." });
		}
		const encodedRel = result.newRelPath.split("/").map(encodeURIComponent).join("/");
		notifyMagicMirrorRefresh(() => {
			res.json({
				ok: true,
				...result,
				fullUrl: `/uploads/${encodedRel}`,
				thumbUrl: `/thumb/${encodedRel}`,
				downloadUrl: `/download/${encodedRel}`
			});
		});
	});

	router.post("/api/photo/delete", (req, res) => {
		const relPath = req.body && req.body.relPath;
		if (!relPath || typeof relPath !== "string") {
			return res.status(400).json({ ok: false, error: "사진 경로가 필요합니다." });
		}
		const deleted = fileUtils.deletePhotoByRelPath(uploadDir, relPath);
		if (!deleted) {
			return res.status(404).json({ ok: false, error: "삭제할 파일을 찾을 수 없습니다." });
		}
		notifyMagicMirrorRefresh(() => {
			res.json({ ok: true, relPath: fileUtils.normalizeRelPath(relPath) });
		});
	});

	router.post("/api/photo/rotate", async (req, res) => {
		const relPath = req.body && req.body.relPath;
		const angle = req.body && req.body.angle ? Number(req.body.angle) : 90;
		if (!relPath || typeof relPath !== "string") {
			return res.status(400).json({ ok: false, error: "사진 경로가 필요합니다." });
		}
		try {
			const result = await fileUtils.rotatePhotoByRelPath(uploadDir, relPath, angle);
			const encodedRel = result.relPath.split("/").map(encodeURIComponent).join("/");
			const bust = Date.now();
			notifyMagicMirrorRefresh(() => {
				res.json({
					ok: true,
					relPath: result.relPath,
					angle: result.angle,
					fullUrl: `/uploads/${encodedRel}?v=${bust}`,
					thumbUrl: `/thumb/${encodedRel}?v=${bust}`
				});
			});
		} catch (err) {
			res.status(500).json({ ok: false, error: err.message });
		}
	});

	router.post("/api/photos/batch", (req, res) => {
		const action = req.body && req.body.action;
		const relPaths = Array.isArray(req.body && req.body.relPaths) ? req.body.relPaths : [];
		if (!action || relPaths.length === 0) {
			return res.status(400).json({ ok: false, error: "작업과 사진 목록이 필요합니다." });
		}
		const results = [];
		for (const relPath of relPaths) {
			if (typeof relPath !== "string") continue;
			if (action === "favorite" || action === "unfavorite") {
				const r = fileUtils.setFavoritePath(relPath, action === "favorite");
				results.push({ oldRelPath: relPath, newRelPath: relPath, isFavorite: r.isFavorite });
			} else if (action === "hide" || action === "show") {
				const r = fileUtils.togglePhotoByRelPath(uploadDir, relPath, action === "hide");
				if (r) {
					const enc = r.newRelPath.split("/").map(encodeURIComponent).join("/");
					results.push({ ...r, fullUrl: `/uploads/${enc}`, thumbUrl: `/thumb/${enc}`, downloadUrl: `/download/${enc}` });
				}
			} else if (action === "delete") {
				if (fileUtils.deletePhotoByRelPath(uploadDir, relPath)) {
					results.push({ oldRelPath: relPath, deleted: true });
				}
			}
		}
		notifyMagicMirrorRefresh(() => {
			res.json({ ok: true, action, count: results.length, results });
		});
	});

	// --- Legacy Form Endpoints (Kept for Compatibility) ---
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

	// --- Display State API (Gallery Mode, Playback Filter, Slide Speed) ---
	router.get("/api/display-state", (req, res) => {
		res.json({ ok: true, ...readDisplayStateSync() });
	});

	router.post("/api/display-state", (req, res) => {
		const body = req.body || {};
		const next = readDisplayStateSync();
		if (typeof body.galleryMode === "boolean") next.galleryMode = body.galleryMode;
		if (typeof body.filterMode === "string" && ["all", "favorites", "faces", "videos", "folder"].includes(body.filterMode)) {
			next.filterMode = body.filterMode;
		}
		if (typeof body.filterFolder === "string") next.filterFolder = body.filterFolder;
		if (typeof body.updateIntervalMs === "number" && !Number.isNaN(body.updateIntervalMs)) {
			next.updateIntervalMs = Math.max(3000, Math.min(120000, Math.round(body.updateIntervalMs)));
		}
		if (typeof body.motionStyle === "string" && ["cinematic", "calm", "still"].includes(body.motionStyle)) {
			next.motionStyle = body.motionStyle;
		}
		if (typeof body.transitionMode === "string" && ["black", "crossfade"].includes(body.transitionMode)) {
			next.transitionMode = body.transitionMode;
		}
		try {
			saveDisplayStateSync(next);
		} catch (err) {
			return res.status(500).json({ ok: false, error: err.message });
		}
		callMagicMirrorApi("POST", "/display-state", next, () => {
			res.json({ ok: true, ...next });
		});
	});

	// --- Cast Specific Photo to Frame Immediately ---
	router.post("/api/show-photo", (req, res) => {
		const relPath = req.body && req.body.relPath;
		const pause = Boolean(req.body && req.body.pause);
		if (!relPath || typeof relPath !== "string") {
			return res.status(400).json({ ok: false, error: "사진 경로가 필요합니다." });
		}
		callMagicMirrorApi("POST", "/show-photo", { path: relPath, pause }, (err, data) => {
			if (err) return res.status(500).json({ ok: false, error: err.message });
			return res.json({ ok: true, ...data });
		});
	});

	// --- Brightness Control API (Software Dimming Overlay) ---
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
	router.get("/api/system-status", async (req, res) => {
		const allDirs = await fileUtils.getDirectories(uploadDir);
		const visibleFolders = allDirs
			.map((d) => d.split(path.sep).join("/"))
			.filter((d) => !d.split("/").some((seg) => seg.startsWith("!")))
			.sort();
		const totalMemMB = Math.round(os.totalmem() / 1024 / 1024);
		const freeMemMB = Math.round(os.freemem() / 1024 / 1024);
		const usedMemMB = totalMemMB - freeMemMB;
		const cpuTempC = readCpuTempC();
		const favSet = fileUtils.loadFavorites();
		const thumbCacheCount = countThumbCache();

		readDiskUsage((disk) => {
			isMagicMirrorRunning((mmRunning) => {
				readScreenStatus((screenStatus) => {
					const afterBrightness = (brightness) => {
						const finalize = (mmStatus) => {
							if (mmStatus && mmStatus.currentPhoto && mmStatus.currentPhoto.companionPath) {
								mmStatus.currentPhoto.companionIsFavorite = favSet.has(mmStatus.currentPhoto.companionPath);
							}
							res.json({
								ok: true,
								cpuTempC,
								memory: { usedMB: usedMemMB, totalMB: totalMemMB, percent: Math.round((usedMemMB / totalMemMB) * 100) },
								disk,
								mmRunning,
								screenStatus,
								brightness,
								displayState: readDisplayStateSync(),
								favoriteCount: favSet.size,
								thumbCacheCount,
								visibleFolders,
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
		const relPath = req.body && req.body.relPath;
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
		if (action === "hide-photo" && relPath) {
			const r = fileUtils.togglePhotoByRelPath(uploadDir, relPath, true);
			if (!r) return res.status(404).json({ ok: false, error: "사진을 찾을 수 없습니다." });
			notifyMagicMirrorRefresh(() => {
				callMagicMirrorApi("POST", "/control", { action: "next" }, () => {
					res.json({ ok: true, hiddenPath: r.newRelPath });
				});
			});
			return;
		}
		if (action === "toggle-favorite") {
			if (relPath) {
				const r = fileUtils.toggleFavoritePath(relPath);
				callMagicMirrorApi("POST", "/refresh", {}, () => {});
				return res.json({ ok: true, path: relPath, ...r });
			}
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
		res.redirect(started ? "/?status=conversion_started#status" : "/?status=conversion_running#status");
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
