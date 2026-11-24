/*
 * MagicMirror²
 * Node Helper: MMM-ImagesPhotos
 *
 * By Rodrigo Ramìrez Norambuena https://rodrigoramirez.com
 * MIT Licensed.
 */

const express = require("express");
const console = require("console");
const NodeHelper = require("node_helper");
const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const exifParser = require("exif-parser");
const https = require("https");
const { spawn } = require("child_process");
const os = require("os");

const CACHE_DIR = path.join(__dirname, ".cache");
const FACE_CACHE_FILE = path.join(CACHE_DIR, "face-detection-cache.json");
const GEOCODE_CACHE_FILE = path.join(CACHE_DIR, "geocode-cache.json");
const DATE_CACHE_FILE = path.join(CACHE_DIR, "exif-date-cache.json");
const DIM_CACHE_FILE = path.join(CACHE_DIR, "dimensions-cache.json");
const FAVORITES_FILE = path.join(CACHE_DIR, "favorites.json");
const BRIGHTNESS_FILE = path.join(CACHE_DIR, "brightness.json");
const DISPLAY_STATE_FILE = path.join(CACHE_DIR, "display-state.json");
const CACHE_SAVE_DEBOUNCE_MS = 3000;
const FACE_SCRIPT_TIMEOUT_MS = 15000;
const GEOCODE_TIMEOUT_MS = 10000;

function loadJsonCache(filePath) {
	try {
		if (fs.existsSync(filePath)) {
			const raw = fs.readFileSync(filePath, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch (err) {
		console.warn(`[MMM-ImagesPhotos] Failed to load cache ${path.basename(filePath)}: ${err.message}`);
	}
	return {};
}

function saveJsonCacheAtomic(filePath, data) {
	try {
		if (!fs.existsSync(CACHE_DIR)) {
			fs.mkdirSync(CACHE_DIR, { recursive: true });
		}
		const tmpPath = `${filePath}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(data), "utf8");
		fs.renameSync(tmpPath, filePath);
	} catch (err) {
		console.error(`[MMM-ImagesPhotos] Failed to save cache ${path.basename(filePath)}: ${err.message}`);
	}
}

function formatDateStr(year, month, day) {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readImageMetaFast(filePath) {
	try {
		const ext = path.extname(filePath).toLowerCase();
		if (ext === ".png") {
			const fd = fs.openSync(filePath, "r");
			const buf = Buffer.alloc(24);
			fs.readSync(fd, buf, 0, 24, 0);
			fs.closeSync(fd);
			if (buf.toString("ascii", 1, 4) === "PNG") {
				return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), takenAt: null };
			}
			return null;
		}
		if (ext === ".jpg" || ext === ".jpeg") {
			const fd = fs.openSync(filePath, "r");
			const buf = Buffer.alloc(65536);
			fs.readSync(fd, buf, 0, 65536, 0);
			fs.closeSync(fd);
			const parsed = exifParser.create(buf).parse();
			const sz = parsed.getImageSize();
			let width = null;
			let height = null;
			if (sz && sz.width && sz.height) {
				const orient = (parsed.tags && parsed.tags.Orientation) || 1;
				const rotated = orient >= 5 && orient <= 8;
				width = rotated ? sz.height : sz.width;
				height = rotated ? sz.width : sz.height;
			}
			let dateInfo = null;
			if (parsed.tags && typeof parsed.tags.DateTimeOriginal === "number") {
				const dt = new Date(parsed.tags.DateTimeOriginal * 1000);
				dateInfo = {
					year: dt.getUTCFullYear(),
					month: dt.getUTCMonth() + 1,
					day: dt.getUTCDate(),
					takenAt: parsed.tags.DateTimeOriginal * 1000
				};
			}
			return { width, height, dateInfo };
		}
	} catch (_) {
		// ignore
	}
	return null;
}

function loadBrightnessValue() {
	try {
		if (fs.existsSync(BRIGHTNESS_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(BRIGHTNESS_FILE, "utf8"));
			if (parsed && typeof parsed.brightness === "number") {
				return Math.max(15, Math.min(100, Math.round(parsed.brightness)));
			}
		}
	} catch (_) {}
	return 100;
}

function loadFavoritesSet() {
	try {
		if (fs.existsSync(FAVORITES_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
			if (Array.isArray(parsed)) return new Set(parsed);
		}
	} catch (_) {}
	return new Set();
}

function getSeason(month) {
	if (month >= 3 && month <= 5) return "spring";
	if (month >= 6 && month <= 8) return "summer";
	if (month >= 9 && month <= 11) return "autumn";
	return "winter";
}

function computeSeasonalMemory(year, month, day) {
	const now = new Date();
	const todayYear = now.getFullYear();
	const todayMonth = now.getMonth() + 1;
	const todayDay = now.getDate();

	const isSameSeason = getSeason(month) === getSeason(todayMonth);
	let memoryYearsAgo = 0;
	let nearMemoryYearsAgo = 0;

	if (todayYear > year) {
		if (month === todayMonth && day === todayDay) {
			memoryYearsAgo = todayYear - year;
		} else {
			const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
			const candidates = [
				Date.UTC(todayYear, month - 1, day),
				Date.UTC(todayYear - 1, month - 1, day),
				Date.UTC(todayYear + 1, month - 1, day)
			];
			const minDays = Math.min(...candidates.map((c) => Math.abs(todayUtc - c) / 86400000));
			if (minDays <= 7) {
				nearMemoryYearsAgo = todayYear - year;
			}
		}
	}
	return { memoryYearsAgo, nearMemoryYearsAgo, isSameSeason };
}

function loadDisplayState() {
	const defaults = { galleryMode: false, filterMode: "all", filterFolder: "", updateIntervalMs: 9000 };
	try {
		if (fs.existsSync(DISPLAY_STATE_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(DISPLAY_STATE_FILE, "utf8"));
			if (parsed && typeof parsed === "object") {
				return {
					galleryMode: Boolean(parsed.galleryMode),
					filterMode: ["all", "favorites", "faces", "videos", "folder"].includes(parsed.filterMode) ? parsed.filterMode : "all",
					filterFolder: typeof parsed.filterFolder === "string" ? parsed.filterFolder : "",
					updateIntervalMs: typeof parsed.updateIntervalMs === "number" && parsed.updateIntervalMs >= 3000 ? Math.min(120000, Math.round(parsed.updateIntervalMs)) : 9000
				};
			}
		}
	} catch (_) {}
	return defaults;
}

async function reverseGeocode(lat, lon, language) {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: "nominatim.openstreetmap.org",
			path: `/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${language}`,
			headers: {
				"User-Agent": "MagicMirror/MMM-ImagesPhotos-Module"
			}
		};

		const req = https.get(options, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				try {
					const jsonData = JSON.parse(data);
					if (jsonData && jsonData.error) {
						reject(new Error(jsonData.error));
					} else {
						resolve(jsonData);
					}
				} catch (e) {
					reject(e);
				}
			});
		});

		req.setTimeout(GEOCODE_TIMEOUT_MS, () => {
			req.destroy(new Error("Reverse geocode request timed out"));
		});

		req.on("error", (e) => {
			reject(e);
		});
	});
}

module.exports = NodeHelper.create({
	config: {},
	path_images: {},
	faceCache: {},
	geocodeCache: {},
	dateCache: {},
	dimCache: {},
	favorites: new Set(),
	brightness: 100,
	displayState: { galleryMode: false, filterMode: "all", filterFolder: "", updateIntervalMs: 9000 },
	faceCacheSaveTimer: null,
	geocodeCacheSaveTimer: null,
	dateCacheSaveTimer: null,
	dimCacheSaveTimer: null,
	activeInstances: new Set(),
	currentDisplayed: {},
	pausedState: false,
	apiRoutesRegistered: false,

	getLocalIp() {
		const interfaces = os.networkInterfaces();
		for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name]) {
				if (iface.family === "IPv4" && !iface.internal) {
					return iface.address;
				}
			}
		}
		return "127.0.0.1";
	},

	buildLocationString(address, displayName) {
		if (!address || typeof address !== "object") {
			return displayName;
		}

		const countryCode = (address.country_code || "").toLowerCase();
		const isKorea = countryCode === "kr" || address.country === "대한민국";

		const fields = isKorea
			? ["province", "state", "city", "county", "borough", "city_district", "town", "suburb", "quarter", "village", "neighbourhood", "road"]
			: ["country", "province", "state", "city", "county", "town", "suburb", "quarter", "village", "road"];

		const locationParts = [];
		fields.forEach((field) => {
			const val = address[field];
			if (val && !locationParts.includes(val)) {
				locationParts.push(val);
			}
		});

		if (locationParts.length > 0) {
			return locationParts.join(" ");
		}

		return displayName;
	},

	scheduleSaveFaceCache() {
		if (this.faceCacheSaveTimer) {
			clearTimeout(this.faceCacheSaveTimer);
		}
		this.faceCacheSaveTimer = setTimeout(() => {
			this.faceCacheSaveTimer = null;
			saveJsonCacheAtomic(FACE_CACHE_FILE, this.faceCache);
		}, CACHE_SAVE_DEBOUNCE_MS);
	},

	scheduleSaveGeocodeCache() {
		if (this.geocodeCacheSaveTimer) {
			clearTimeout(this.geocodeCacheSaveTimer);
		}
		this.geocodeCacheSaveTimer = setTimeout(() => {
			this.geocodeCacheSaveTimer = null;
			saveJsonCacheAtomic(GEOCODE_CACHE_FILE, this.geocodeCache);
		}, CACHE_SAVE_DEBOUNCE_MS);
	},

	scheduleSaveDimCache() {
		if (this.dimCacheSaveTimer) {
			clearTimeout(this.dimCacheSaveTimer);
		}
		this.dimCacheSaveTimer = setTimeout(() => {
			this.dimCacheSaveTimer = null;
			saveJsonCacheAtomic(DIM_CACHE_FILE, this.dimCache);
		}, CACHE_SAVE_DEBOUNCE_MS);
	},

	scheduleSaveDateCache() {
		if (this.dateCacheSaveTimer) {
			clearTimeout(this.dateCacheSaveTimer);
		}
		this.dateCacheSaveTimer = setTimeout(() => {
			this.dateCacheSaveTimer = null;
			saveJsonCacheAtomic(DATE_CACHE_FILE, this.dateCache);
		}, CACHE_SAVE_DEBOUNCE_MS);
	},

	flushCaches() {
		if (this.faceCacheSaveTimer) {
			clearTimeout(this.faceCacheSaveTimer);
			this.faceCacheSaveTimer = null;
			saveJsonCacheAtomic(FACE_CACHE_FILE, this.faceCache);
		}
		if (this.geocodeCacheSaveTimer) {
			clearTimeout(this.geocodeCacheSaveTimer);
			this.geocodeCacheSaveTimer = null;
			saveJsonCacheAtomic(GEOCODE_CACHE_FILE, this.geocodeCache);
		}
		if (this.dateCacheSaveTimer) {
			clearTimeout(this.dateCacheSaveTimer);
			this.dateCacheSaveTimer = null;
			saveJsonCacheAtomic(DATE_CACHE_FILE, this.dateCache);
		}
		if (this.dimCacheSaveTimer) {
			clearTimeout(this.dimCacheSaveTimer);
			this.dimCacheSaveTimer = null;
			saveJsonCacheAtomic(DIM_CACHE_FILE, this.dimCache);
		}
	},

	async runFaceDetection(imagePath, id) {
		if (!this.config[id].faceDetection || !this.config[id].faceDetectionScript) {
			return null;
		}

		const cacheKey = this.path_images[id] ? path.relative(this.path_images[id], imagePath) : imagePath;
		let fileStat = null;
		try {
			fileStat = fs.statSync(imagePath);
			const cached = this.faceCache[cacheKey];
			if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
				if (this.config[id].debugToConsole) {
					console.log(`[MMM-ImagesPhotos] Face detection cache hit for ${cacheKey}`);
				}
				return cached.face;
			}
		} catch (err) {
			console.error(`[MMM-ImagesPhotos] Could not stat ${imagePath}: ${err.message}`);
			return null;
		}

		return new Promise((resolve) => {
			if (this.config[id].debugToConsole) {
				console.log(`[MMM-ImagesPhotos] Running python script: ${this.config[id].faceDetectionScript}, File: ${imagePath}`);
			}

			const python = spawn("python", [this.config[id].faceDetectionScript, imagePath]);
			let dataString = "";
			let errorString = "";
			let settled = false;

			const finish = (result) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(result);
				}
			};

			const timer = setTimeout(() => {
				console.error(`[MMM-ImagesPhotos] Face detection timed out after ${FACE_SCRIPT_TIMEOUT_MS}ms for ${imagePath}`);
				try {
					python.kill("SIGKILL");
				} catch (_) {
					// ignore
				}
				finish(null);
			}, FACE_SCRIPT_TIMEOUT_MS);

			python.stdout.on("data", (data) => {
				dataString += data.toString();
			});

			python.stderr.on("data", (data) => {
				errorString += data.toString();
			});

			python.on("close", (code) => {
				if (code !== 0) {
					console.error(`[MMM-ImagesPhotos] Face detection script for ${imagePath} exited with code ${code}: ${errorString}`);
					finish(null);
					return;
				}
				try {
					const faceData = JSON.parse(dataString);
					if (fileStat) {
						this.faceCache[cacheKey] = {
							mtimeMs: fileStat.mtimeMs,
							size: fileStat.size,
							face: faceData
						};
						this.scheduleSaveFaceCache();
					}
					if (this.config[id].debugToConsole) {
						console.log(`[MMM-ImagesPhotos] Face detection result for ${cacheKey}:`, JSON.stringify(faceData));
					}
					finish(faceData);
				} catch (e) {
					console.error(`[MMM-ImagesPhotos] Face detection - Invalid JSON from script for ${imagePath}: ${dataString}`);
					finish(null);
				}
			});

			python.on("error", (err) => {
				console.error(`[MMM-ImagesPhotos] Failed to start face detection script for ${imagePath}`, err);
				finish(null);
			});
		});
	},

	start() {
		console.log(`Starting node helper for: ${this.name}`);
		this.faceCache = loadJsonCache(FACE_CACHE_FILE);
		this.geocodeCache = loadJsonCache(GEOCODE_CACHE_FILE);
		this.dateCache = loadJsonCache(DATE_CACHE_FILE);
		this.dimCache = loadJsonCache(DIM_CACHE_FILE);
		this.favorites = loadFavoritesSet();
		this.brightness = loadBrightnessValue();
		this.displayState = loadDisplayState();
		this.activeInstances = new Set();
		this.currentDisplayed = {};
		this.pausedState = false;
		console.log(
			`[MMM-ImagesPhotos] Loaded cache: ${Object.keys(this.faceCache).length} face, ${Object.keys(this.geocodeCache).length} geocode, ${Object.keys(this.dateCache).length} date entries`
		);
	},

	stop() {
		this.flushCaches();
	},

	setConfig(id) {
		this.path_images[id] = path.resolve(
			global.root_path,
			"modules/MMM-ImagesPhotos/uploads",
			this.config[id].path
		);
		console.log(`[MMM-ImagesPhotos] Media path (${id}): ${this.path_images[id]}`);
	},

	registerApiRoutes() {
		if (this.apiRoutesRegistered) return;
		this.apiRoutesRegistered = true;

		this.expressApp.use("/MMM-ImagesPhotos/api", express.json());

		this.expressApp.get("/MMM-ImagesPhotos/api/status", (req, res) => {
			const instances = Array.from(this.activeInstances);
			const primaryId = instances[0] || null;
			const rawCurrent = primaryId ? (this.currentDisplayed[primaryId] || null) : null;
			const currentPhoto = rawCurrent ? { ...rawCurrent, isFavorite: Boolean(rawCurrent.path && this.favorites.has(rawCurrent.path)) } : null;
			res.json({
				ok: true,
				instances,
				paused: this.pausedState,
				currentPhoto,
				favoriteCount: this.favorites.size,
				brightness: this.brightness,
				displayState: this.displayState,
				faceCacheCount: Object.keys(this.faceCache).length,
				geocodeCacheCount: Object.keys(this.geocodeCache).length,
				dateCacheCount: Object.keys(this.dateCache).length
			});
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/refresh", (req, res) => {
			const instances = Array.from(this.activeInstances);
			instances.forEach((id) => {
				this.sendSocketNotification("PHOTOS_UPDATED", { id });
			});
			console.log(`[MMM-ImagesPhotos] Live refresh broadcast to ${instances.length} instance(s)`);
			res.json({ ok: true, refreshed: instances });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/control", (req, res) => {
			const action = req.body && req.body.action;
			const allowed = ["next", "prev", "pause", "resume", "toggle-pause"];
			if (!allowed.includes(action)) {
				return res.status(400).json({ ok: false, error: "Invalid action" });
			}
			if (action === "pause") this.pausedState = true;
			else if (action === "resume") this.pausedState = false;
			else if (action === "toggle-pause") this.pausedState = !this.pausedState;

			const instances = Array.from(this.activeInstances);
			instances.forEach((id) => {
				this.sendSocketNotification("REMOTE_CONTROL", { id, action });
			});
			console.log(`[MMM-ImagesPhotos] Remote control action=${action} sent to ${instances.length} instance(s)`);
			res.json({ ok: true, action, paused: this.pausedState });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/favorite", (req, res) => {
			const instances = Array.from(this.activeInstances);
			const primaryId = instances[0];
			const current = primaryId ? this.currentDisplayed[primaryId] : null;
			const targetPath = (req.body && req.body.path) || (current && current.path);
			if (!targetPath) {
				return res.status(404).json({ ok: false, error: "No target photo specified" });
			}

			let isFavorite;
			if (this.favorites.has(targetPath)) {
				this.favorites.delete(targetPath);
				isFavorite = false;
			} else {
				this.favorites.add(targetPath);
				isFavorite = true;
			}
			saveJsonCacheAtomic(FAVORITES_FILE, Array.from(this.favorites));

			instances.forEach((id) => {
				this.sendSocketNotification("FAVORITE_UPDATED", { id, path: targetPath, isFavorite });
				this.sendSocketNotification("PHOTOS_UPDATED", { id });
			});

			res.json({ ok: true, path: targetPath, isFavorite, favoriteCount: this.favorites.size });
		});

		this.expressApp.get("/MMM-ImagesPhotos/api/brightness", (req, res) => {
			res.json({ ok: true, brightness: this.brightness });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/brightness", (req, res) => {
			const raw = req.body && req.body.value;
			const val = Math.max(15, Math.min(100, Math.round(Number(raw))));
			if (Number.isNaN(val)) {
				return res.status(400).json({ ok: false, error: "Invalid brightness value" });
			}
			this.brightness = val;
			saveJsonCacheAtomic(BRIGHTNESS_FILE, { brightness: val, updatedAt: Date.now() });
			Array.from(this.activeInstances).forEach((id) => {
				this.sendSocketNotification("BRIGHTNESS_UPDATED", { id, brightness: val });
			});
			console.log(`[MMM-ImagesPhotos] Screen dim brightness set to ${val}%`);
			res.json({ ok: true, brightness: val });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/display-state", (req, res) => {
			const body = req.body || {};
			const next = { ...this.displayState };
			if (typeof body.galleryMode === "boolean") {
				next.galleryMode = body.galleryMode;
			}
			if (typeof body.filterMode === "string" && ["all", "favorites", "faces", "videos", "folder"].includes(body.filterMode)) {
				next.filterMode = body.filterMode;
			}
			if (typeof body.filterFolder === "string") {
				next.filterFolder = body.filterFolder;
			}
			if (typeof body.updateIntervalMs === "number" && !Number.isNaN(body.updateIntervalMs)) {
				next.updateIntervalMs = Math.max(3000, Math.min(120000, Math.round(body.updateIntervalMs)));
			}
			this.displayState = next;
			saveJsonCacheAtomic(DISPLAY_STATE_FILE, next);
			Array.from(this.activeInstances).forEach((id) => {
				this.sendSocketNotification("DISPLAY_STATE_UPDATED", { id, ...next });
			});
			console.log(`[MMM-ImagesPhotos] Display state updated:`, JSON.stringify(next));
			res.json({ ok: true, ...next });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/show-photo", (req, res) => {
			const instances = Array.from(this.activeInstances);
			const primaryId = instances[0];
			const relPath = req.body && typeof req.body.path === "string" ? req.body.path.replace(/^\/+/, "") : "";
			const shouldPause = Boolean(req.body && req.body.pause);
			if (!primaryId || !relPath) {
				return res.status(400).json({ ok: false, error: "Invalid photo path or no active MagicMirror instance" });
			}

			const baseDir = this.path_images[primaryId];
			const fullPath = path.resolve(baseDir, relPath);
			if (!fullPath.startsWith(baseDir + path.sep) || !fs.existsSync(fullPath)) {
				return res.status(404).json({ ok: false, error: "Photo file not found" });
			}

			const normalizedRel = path.relative(baseDir, fullPath).split(path.sep).join("/");
			const photoEntry = {
				url: `/MMM-ImagesPhotos/photo/${primaryId}/${normalizedRel}`,
				path: normalizedRel,
				isFavorite: this.favorites.has(normalizedRel),
				forceSingle: true
			};
			const dc = this.dateCache[normalizedRel];
			if (dc && dc.year && dc.month && dc.day) {
				photoEntry.dateStr = formatDateStr(dc.year, dc.month, dc.day);
				const sm = computeSeasonalMemory(dc.year, dc.month, dc.day);
				if (sm.memoryYearsAgo >= 1) photoEntry.memoryYearsAgo = sm.memoryYearsAgo;
				if (sm.nearMemoryYearsAgo >= 1) photoEntry.nearMemoryYearsAgo = sm.nearMemoryYearsAgo;
				photoEntry.isSameSeason = sm.isSameSeason;
			}

			instances.forEach((id) => {
				this.sendSocketNotification("SHOW_PHOTO_NOW", {
					id,
					photo: { ...photoEntry, url: `/MMM-ImagesPhotos/photo/${id}/${normalizedRel}` },
					pause: shouldPause
				});
			});
			console.log(`[MMM-ImagesPhotos] Casting photo now: ${normalizedRel} (pause=${shouldPause})`);
			res.json({ ok: true, path: normalizedRel, paused: shouldPause });
		});

		this.expressApp.post("/MMM-ImagesPhotos/api/hide-current", (req, res) => {
			const instances = Array.from(this.activeInstances);
			const primaryId = instances[0];
			const current = primaryId ? this.currentDisplayed[primaryId] : null;
			if (!primaryId || !current || !current.path) {
				return res.status(404).json({ ok: false, error: "No active photo to hide" });
			}

			const baseDir = this.path_images[primaryId];
			const fullPath = path.resolve(baseDir, current.path);
			if (!fullPath.startsWith(baseDir + path.sep) || !fs.existsSync(fullPath)) {
				return res.status(404).json({ ok: false, error: "Current photo file not found" });
			}

			const dirName = path.dirname(fullPath);
			const baseName = path.basename(fullPath);
			if (!baseName.startsWith("!")) {
				const hiddenPath = path.join(dirName, `!${baseName}`);
				try {
					fs.renameSync(fullPath, hiddenPath);
					console.log(`[MMM-ImagesPhotos] Hidden current photo via remote: ${current.path}`);
				} catch (err) {
					return res.status(500).json({ ok: false, error: err.message });
				}
			}

			instances.forEach((id) => {
				this.sendSocketNotification("PHOTOS_UPDATED", { id });
				this.sendSocketNotification("REMOTE_CONTROL", { id, action: "next" });
			});

			res.json({ ok: true, hiddenPath: current.path });
		});
	},

	async socketNotificationReceived(notification, payload) {
		if (notification === "CONFIG") {
			this.config[payload.id] = payload;
			this.activeInstances.add(payload.id);
			this.setConfig(payload.id);
			this.extraRoutes(payload.id);
			this.registerApiRoutes();
			this.sendSocketNotification("READY", payload.id);
			this.sendSocketNotification("SERVER_IP", { id: payload.id, ip: this.getLocalIp() });
			this.sendSocketNotification("BRIGHTNESS_UPDATED", { id: payload.id, brightness: this.brightness });
			this.sendSocketNotification("DISPLAY_STATE_UPDATED", { id: payload.id, ...this.displayState });
		}
		if (notification === "CURRENT_PHOTO" && payload && payload.id) {
			this.currentDisplayed[payload.id] = {
				path: payload.path || null,
				url: payload.url || null,
				companionPath: payload.companionPath || null,
				effect: payload.effect || null,
				updatedAt: Date.now()
			};
			if (typeof payload.paused === "boolean") {
				this.pausedState = payload.paused;
			}
		}
		if (notification === "GET_METADATA") {
			const { id, photo } = payload;
			const directoryImages = this.path_images[id];
			const imagePath = path.join(directoryImages, photo.path);

			const photoObject = {
				...photo,
				exif: null,
				location: null,
				face: null,
				memoryYearsAgo: photo.memoryYearsAgo || 0,
				nearMemoryYearsAgo: photo.nearMemoryYearsAgo || 0,
				isSameSeason: Boolean(photo.isSameSeason),
				isFavorite: this.favorites.has(photo.path)
			};

			const mediaType = mime.lookup(imagePath);
			const isVideo = mediaType && mediaType.startsWith("video/");

			try {
				if (!isVideo && this.config[id].showExif) {
					if (mediaType === "image/jpeg" || mediaType === "image/jpg" || mediaType === "image/tiff") {
						try {
							const fileBuffer = fs.readFileSync(imagePath);
							const parser = exifParser.create(fileBuffer);
							photoObject.exif = parser.parse();

							if (photoObject.exif && photoObject.exif.tags && typeof photoObject.exif.tags.DateTimeOriginal === "number") {
								const dt = new Date(photoObject.exif.tags.DateTimeOriginal * 1000);
								const year = dt.getUTCFullYear();
								const month = dt.getUTCMonth() + 1;
								const day = dt.getUTCDate();
								const sm = computeSeasonalMemory(year, month, day);
								photoObject.memoryYearsAgo = sm.memoryYearsAgo;
								photoObject.nearMemoryYearsAgo = sm.nearMemoryYearsAgo;
								photoObject.isSameSeason = sm.isSameSeason;

								try {
									const st = fs.statSync(imagePath);
									this.dateCache[photo.path] = { mtimeMs: st.mtimeMs, size: st.size, year, month, day };
									this.scheduleSaveDateCache();
								} catch (_) {
									// ignore
								}
							}
						} catch (error) {
							console.error(`[MMM-ImagesPhotos] Could not parse EXIF for ${photo.path}:`, error.message);
						}
					} else {
						photoObject.exif = null;
					}

					if (photoObject.exif && photoObject.exif.tags && photoObject.exif.tags.GPSLatitude && photoObject.exif.tags.GPSLongitude) {
						const lat = Number(photoObject.exif.tags.GPSLatitude);
						const lon = Number(photoObject.exif.tags.GPSLongitude);
						const lang = this.config[id].language || "ko";
						const geoKey = `${lat.toFixed(4)},${lon.toFixed(4)},${lang}`;

						if (Object.prototype.hasOwnProperty.call(this.geocodeCache, geoKey)) {
							photoObject.location = this.geocodeCache[geoKey];
						} else {
							try {
								const locationData = await reverseGeocode(lat, lon, lang);
								if (locationData && locationData.address) {
									photoObject.location = this.buildLocationString(locationData.address, locationData.display_name);
									if (photoObject.location) {
										this.geocodeCache[geoKey] = photoObject.location;
										this.scheduleSaveGeocodeCache();
									}
								}
							} catch (e) {
								console.error(`[MMM-ImagesPhotos] Could not reverse geocode for ${photo.path}:`, e.message);
							}
						}
					}
				}

				if (!isVideo && this.config[id].faceDetection) {
					photoObject.face = await this.runFaceDetection(imagePath, id);
				}

				this.sendSocketNotification("METADATA_RESPONSE", { id: id, photo: photoObject });
			} catch (e) {
				console.error(`[MMM-ImagesPhotos] Error processing metadata for ${photo.path}:`, e);
			}
		}
	},

	extraRoutes(id) {
		const self = this;

		this.expressApp.get(`/MMM-ImagesPhotos/photos/${id}`, (req, res) => {
			self.getPhotosImages(req, res, id);
		});

		this.expressApp.use(
			`/MMM-ImagesPhotos/photo/${id}`,
			express.static(self.path_images[id])
		);
	},

	getPhotosImages(req, res, id) {
		const directoryImages = this.path_images[id];
		const imgs = this.getImages(this.getFiles(directoryImages, id), id);
		console.log(`[MMM-ImagesPhotos] Loaded ${imgs.length} media files (${id})`);

		let dimUpdated = false;
		let dateUpdated = false;
		this.favorites = loadFavoritesSet();
		const initialPhotos = imgs.map((img) => {
			const entry = {
				url: `/MMM-ImagesPhotos/photo/${id}/${img}`,
				path: img
			};
			const fullPath = path.join(directoryImages, img);
			const fc = this.faceCache[img];
			if (fc && fc.face) {
				entry.hasFaces = Boolean(fc.face.count > 0);
				if (fc.face.width && fc.face.height) {
					entry.isPortrait = fc.face.height > fc.face.width;
				}
			} else {
				try {
					const st = fs.statSync(fullPath);
					const cachedDim = this.dimCache[img];
					if (cachedDim && cachedDim.mtimeMs === st.mtimeMs && cachedDim.size === st.size) {
						entry.isPortrait = cachedDim.height > cachedDim.width;
					} else {
						const meta = readImageMetaFast(fullPath);
						if (meta && meta.width && meta.height) {
							this.dimCache[img] = { mtimeMs: st.mtimeMs, size: st.size, width: meta.width, height: meta.height };
							dimUpdated = true;
							entry.isPortrait = meta.height > meta.width;
						}
						if (meta && meta.dateInfo) {
							this.dateCache[img] = { mtimeMs: st.mtimeMs, size: st.size, ...meta.dateInfo };
							dateUpdated = true;
						}
					}
				} catch (_) {
					// ignore
				}
			}
			let dc = this.dateCache[img];
			if (!dc) {
				try {
					const st = fs.statSync(fullPath);
					const meta = readImageMetaFast(fullPath);
					if (meta && meta.dateInfo) {
						dc = { mtimeMs: st.mtimeMs, size: st.size, ...meta.dateInfo };
						this.dateCache[img] = dc;
						dateUpdated = true;
					}
				} catch (_) {}
			}
			if (dc && dc.year && dc.month && dc.day) {
				entry.dateStr = formatDateStr(dc.year, dc.month, dc.day);
				const sm = computeSeasonalMemory(dc.year, dc.month, dc.day);
				if (sm.memoryYearsAgo >= 1) entry.memoryYearsAgo = sm.memoryYearsAgo;
				if (sm.nearMemoryYearsAgo >= 1) entry.nearMemoryYearsAgo = sm.nearMemoryYearsAgo;
				entry.isSameSeason = sm.isSameSeason;
			}
			entry.isFavorite = this.favorites.has(img);
			return entry;
		});
		if (dimUpdated) {
			this.scheduleSaveDimCache();
		}
		if (dateUpdated) {
			this.scheduleSaveDateCache();
		}
		res.send(initialPhotos);
	},

	getImages(files) {
		const images = [];
		const enabledTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "video/mp4", "video/webm", "video/ogg", "video/quicktime"];

		for (const idx in files) {
			if (idx in files) {
				const type = mime.lookup(files[idx]);
				if (enabledTypes.indexOf(type) >= 0 && type !== false) {
					images.push(files[idx]);
				}
			}
		}

		return images;
	},

	getFiles(filePath, id) {
		const debug = this.config[id] && this.config[id].debugToConsole;
		let files = [];
		const folders = [];
		try {
			files = fs.readdirSync(filePath).filter((file) => {
				if (fs.statSync(`${filePath}/${file}`).isDirectory()) {
					if (!file.startsWith("!")) {
						folders.push(`${filePath}/${file}`);
					}
				} else if (!file.startsWith(".") && !file.startsWith("!")) {
					return file;
				}
			});

			folders.forEach((x) => {
				const y = this.getFiles(x, id);
				const worklist = [];
				const c = this.path_images[id].split("/").length;
				const xpath = x.split("/").slice(c).join("/");
				y.forEach((f) => {
					if (f.includes("/")) {
						worklist.push(f);
					} else {
						worklist.push(`${xpath}/${f}`);
					}
				});
				files = files.concat(worklist);
			});
		} catch (exception) {
			console.error(`[MMM-ImagesPhotos] Unable to access source folder ${filePath}: ${exception.message}`);
		}
		if (debug) {
			console.log(`[MMM-ImagesPhotos] Found ${files.length} files in ${filePath}`);
		}

		return files;
	}
});
