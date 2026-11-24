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
	faceCacheSaveTimer: null,
	geocodeCacheSaveTimer: null,

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
		const locationParts = [];
		const fields = ["road", "suburb", "village", "town", "city", "county", "state", "country"];

		fields.forEach((field) => {
			if (address[field]) {
				locationParts.push(address[field]);
			}
		});

		if (locationParts.length > 0) {
			return locationParts.join(", ");
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
		console.log(
			`[MMM-ImagesPhotos] Loaded cache: ${Object.keys(this.faceCache).length} face entries, ${Object.keys(this.geocodeCache).length} geocode entries`
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

	async socketNotificationReceived(notification, payload) {
		if (notification === "CONFIG") {
			this.config[payload.id] = payload;
			this.setConfig(payload.id);
			this.extraRoutes(payload.id);
			this.sendSocketNotification("READY", payload.id);
			this.sendSocketNotification("SERVER_IP", { id: payload.id, ip: this.getLocalIp() });
		}
		if (notification === "GET_METADATA") {
			const { id, photo } = payload;
			const directoryImages = this.path_images[id];
			const imagePath = path.join(directoryImages, photo.path);

			const photoObject = {
				...photo,
				exif: null,
				location: null,
				face: null
			};

			const mediaType = mime.lookup(imagePath);
			const isVideo = mediaType && mediaType.startsWith("video/");

			try {
				// Process EXIF and GPS only for images.
				if (!isVideo && this.config[id].showExif) {
					if (mediaType === "image/jpeg" || mediaType === "image/jpg" || mediaType === "image/tiff") {
						try {
							const fileBuffer = fs.readFileSync(imagePath);
							const parser = exifParser.create(fileBuffer);
							photoObject.exif = parser.parse();
						} catch (error) {
							console.error(`[MMM-ImagesPhotos] Could not parse EXIF for ${photo.path}:`, error.message);
						}
					} else {
						if (this.config[id].debugToConsole) {
							console.log(`[MMM-ImagesPhotos] Skipping EXIF parse for unsupported mime type: ${mediaType} (${photo.path})`);
						}
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

				// Process face detection only for images
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

		const initialPhotos = imgs.map((img) => ({
			url: `/MMM-ImagesPhotos/photo/${id}/${img}`,
			path: img
		}));
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
					// !로 시작하는 폴더는 매직미러 화면에 표시하지 않음 (숨김 처리)
					if (!file.startsWith("!")) {
						folders.push(`${filePath}/${file}`);
					}
				} else if (!file.startsWith(".") && !file.startsWith("!")) {
					// !로 시작하는 파일도 매직미러 화면에 표시하지 않음 (숨김 처리)
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
