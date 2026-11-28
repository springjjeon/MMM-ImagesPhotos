const fs = require("fs");
const path = require("path");
const fsAsync = require("fs").promises;
const { execFile } = require("child_process");
const exifParser = require("exif-parser");

const CACHE_DIR = path.join(__dirname, "..", "..", ".cache");
const DATE_CACHE_FILE = path.join(CACHE_DIR, "exif-date-cache.json");
const FAVORITES_FILE = path.join(CACHE_DIR, "favorites.json");
const MEDIA_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".ogg", ".mov"];
const VIDEO_EXTS = [".mp4", ".webm", ".ogg", ".mov"];
const ROTATABLE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

function normalizeRelPath(relPath) {
	return String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function resolveSafeUploadPath(uploadDir, relPath) {
	const clean = normalizeRelPath(relPath);
	if (!clean || clean.includes("..")) return null;
	const root = path.resolve(uploadDir);
	const full = path.resolve(root, clean);
	if (full !== root && !full.startsWith(root + path.sep)) return null;
	return { fullPath: full, relPath: clean };
}

function loadDateCache() {
	try {
		if (fs.existsSync(DATE_CACHE_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(DATE_CACHE_FILE, "utf8"));
			if (parsed && typeof parsed === "object") return parsed;
		}
	} catch (_) {}
	return {};
}

function loadFavorites() {
	try {
		if (fs.existsSync(FAVORITES_FILE)) {
			const parsed = JSON.parse(fs.readFileSync(FAVORITES_FILE, "utf8"));
			if (Array.isArray(parsed)) return new Set(parsed);
		}
	} catch (_) {}
	return new Set();
}

function saveFavorites(favSet) {
	try {
		if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
		const tmp = `${FAVORITES_FILE}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(Array.from(favSet)), "utf8");
		fs.renameSync(tmp, FAVORITES_FILE);
	} catch (err) {
		console.error("[file-utils] Failed to save favorites:", err.message);
	}
}

function setFavoritePath(relPath, shouldFav) {
	const clean = normalizeRelPath(relPath);
	const favs = loadFavorites();
	if (shouldFav) favs.add(clean);
	else favs.delete(clean);
	saveFavorites(favs);
	return { isFavorite: favs.has(clean), favoriteCount: favs.size };
}

function toggleFavoritePath(relPath) {
	const clean = normalizeRelPath(relPath);
	const favs = loadFavorites();
	let isFavorite;
	if (favs.has(clean)) {
		favs.delete(clean);
		isFavorite = false;
	} else {
		favs.add(clean);
		isFavorite = true;
	}
	saveFavorites(favs);
	return { isFavorite, favoriteCount: favs.size };
}

function readExifTimestampFast(filePath) {
	try {
		const ext = path.extname(filePath).toLowerCase();
		if (ext !== ".jpg" && ext !== ".jpeg") return null;
		const fd = fs.openSync(filePath, "r");
		const buf = Buffer.alloc(65536);
		fs.readSync(fd, buf, 0, 65536, 0);
		fs.closeSync(fd);
		const parsed = exifParser.create(buf).parse();
		if (parsed && parsed.tags && typeof parsed.tags.DateTimeOriginal === "number") {
			const dt = new Date(parsed.tags.DateTimeOriginal * 1000);
			return {
				takenAt: parsed.tags.DateTimeOriginal * 1000,
				dateLabel: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
			};
		}
	} catch (_) {}
	return null;
}

// --- Directory Operations ---

async function getSubdirectories(dirPath) {
	try {
		const items = await fsAsync.readdir(dirPath, { withFileTypes: true });
		return items
			.filter((item) => item.isDirectory())
			.map((item) => ({
				name: item.name,
				isHidden: item.name.startsWith("!")
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error(`Error reading subdirectories for ${dirPath}:`, error.message);
		return [];
	}
}

async function getDirectories(dirPath, baseDir = dirPath) {
	let directories = [];
	try {
		const items = await fsAsync.readdir(dirPath, { withFileTypes: true });
		for (const item of items) {
			if (item.isDirectory()) {
				const fullPath = path.join(dirPath, item.name);
				const relativePath = path.relative(baseDir, fullPath);
				directories.push(relativePath);
				const subDirs = await getDirectories(fullPath, baseDir);
				directories = directories.concat(subDirs);
			}
		}
	} catch (error) {
		console.error(`Error reading directories for ${dirPath}:`, error.message);
	}
	return directories;
}

function toggleFolderVisibility(uploadDir, folderName) {
	if (!folderName) return null;
	const safe = resolveSafeUploadPath(uploadDir, folderName);
	if (!safe || !fs.existsSync(safe.fullPath)) return null;

	const parentDir = path.dirname(safe.fullPath);
	const baseName = path.basename(safe.fullPath);
	const isHiddenNow = !baseName.startsWith("!");
	const newBaseName = baseName.startsWith("!") ? baseName.substring(1) : `!${baseName}`;
	const newPath = path.join(parentDir, newBaseName);

	try {
		fs.renameSync(safe.fullPath, newPath);
		return {
			oldFolder: safe.relPath,
			newFolder: path.relative(path.resolve(uploadDir), newPath).split(path.sep).join("/"),
			isHidden: isHiddenNow
		};
	} catch (e) {
		console.error(`Failed to rename folder: ${safe.fullPath}`, e);
		return null;
	}
}

function renameAllDirectories(dirPath, showAll) {
	if (!fs.existsSync(dirPath)) return;
	const items = fs.readdirSync(dirPath, { withFileTypes: true });

	items.forEach((item) => {
		if (item.isDirectory()) {
			const oldPath = path.join(dirPath, item.name);
			let newName = item.name;
			const isHidden = item.name.startsWith("!");

			if (showAll && isHidden) {
				newName = item.name.substring(1);
			} else if (!showAll && !isHidden) {
				newName = `!${item.name}`;
			}

			const newPath = path.join(dirPath, newName);
			if (oldPath !== newPath) {
				try {
					fs.renameSync(oldPath, newPath);
				} catch (e) {
					console.error(`Failed to rename directory ${oldPath}:`, e);
				}
			}
			renameAllDirectories(newPath, showAll);
		}
	});
}

function deleteFolder(uploadDir, folderName) {
	if (!folderName) return;
	const safe = resolveSafeUploadPath(uploadDir, folderName);
	if (safe && fs.existsSync(safe.fullPath)) {
		try {
			fs.rmSync(safe.fullPath, { recursive: true, force: true });
			console.log(`🗑️ Folder deleted: ${safe.fullPath}`);
		} catch (e) {
			console.error("Failed to delete folder:", e);
		}
	}
}

// --- Media File Operations ---

function buildMediaItem(filePath, baseRoot, dateCache, favSet) {
	try {
		const stats = fs.statSync(filePath);
		if (!stats.isFile()) return null;
		const file = path.basename(filePath);
		const ext = path.extname(file).toLowerCase();
		if (!MEDIA_EXTS.includes(ext)) return null;

		const relPath = path.relative(baseRoot, filePath).split(path.sep).join("/");
		const folderRel = path.dirname(relPath) === "." ? "" : path.dirname(relPath);
		const cached = dateCache[relPath];
		let takenAt = null;
		let dateLabel = null;

		if (cached && cached.year && cached.month && cached.day) {
			takenAt = cached.takenAt || Date.UTC(cached.year, cached.month - 1, cached.day);
			dateLabel = `${cached.year}-${String(cached.month).padStart(2, "0")}-${String(cached.day).padStart(2, "0")}`;
		} else if (ext === ".jpg" || ext === ".jpeg") {
			const fast = readExifTimestampFast(filePath);
			if (fast) {
				takenAt = fast.takenAt;
				dateLabel = fast.dateLabel;
			}
		}

		if (!takenAt) {
			const fallbackMs = stats.mtimeMs || stats.birthtimeMs;
			takenAt = fallbackMs;
			const d = new Date(fallbackMs);
			dateLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}

		return {
			name: file,
			relPath,
			folderRel,
			ext,
			isVideo: VIDEO_EXTS.includes(ext),
			isRotatable: ROTATABLE_EXTS.includes(ext),
			isHidden: file.startsWith("!"),
			birthtime: stats.birthtime,
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			takenAt,
			dateLabel,
			isFavorite: favSet.has(relPath),
			isFile: true
		};
	} catch (e) {
		console.error(`Failed to stat file ${filePath}:`, e);
		return null;
	}
}

function sortMediaFiles(mediaFiles, sortBy = "exif_desc") {
	mediaFiles.sort((a, b) => {
		switch (sortBy) {
			case "fav_first":
				if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
				return b.takenAt - a.takenAt;
			case "exif_asc":
				return a.takenAt - b.takenAt;
			case "date_asc":
				return a.birthtime.getTime() - b.birthtime.getTime();
			case "date_desc":
				return b.birthtime.getTime() - a.birthtime.getTime();
			case "name_asc":
				return a.name.localeCompare(b.name);
			case "name_desc":
				return b.name.localeCompare(a.name);
			case "exif_desc":
			default:
				return b.takenAt - a.takenAt;
		}
	});
	return mediaFiles;
}

function getMediaFiles(folderPath, sortBy = "exif_desc", uploadDir = null) {
	if (!fs.existsSync(folderPath)) return [];
	const dateCache = loadDateCache();
	const favSet = loadFavorites();
	const baseRoot = uploadDir || path.join(__dirname, "..", "..", "uploads");
	const files = fs.readdirSync(folderPath);
	const mediaFiles = files
		.map((file) => buildMediaItem(path.join(folderPath, file), baseRoot, dateCache, favSet))
		.filter(Boolean);
	return sortMediaFiles(mediaFiles, sortBy);
}

function getAllMediaFiles(uploadDir, options = {}) {
	const { mode = "recent", sortBy = "exif_desc", query = "" } = options;
	const baseRoot = path.resolve(uploadDir);
	if (!fs.existsSync(baseRoot)) return [];

	const dateCache = loadDateCache();
	const favSet = loadFavorites();
	const q = String(query || "").trim().toLowerCase();
	const collected = [];

	function walk(dir) {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (_) {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!MEDIA_EXTS.includes(ext)) continue;
				if (mode === "videos" && !VIDEO_EXTS.includes(ext)) continue;
				const relPath = path.relative(baseRoot, full).split(path.sep).join("/");
				if (mode === "favorites" && !favSet.has(relPath)) continue;
				const item = buildMediaItem(full, baseRoot, dateCache, favSet);
				if (!item) continue;
				if (q) {
					const haystack = `${item.relPath} ${item.dateLabel || ""}`.toLowerCase();
					if (!haystack.includes(q)) continue;
				}
				collected.push(item);
			}
		}
	}

	walk(baseRoot);
	return sortMediaFiles(collected, sortBy);
}

function togglePhotoByRelPath(uploadDir, relPath, forceHidden = null) {
	const safe = resolveSafeUploadPath(uploadDir, relPath);
	if (!safe || !fs.existsSync(safe.fullPath)) return null;

	const parentDir = path.dirname(safe.fullPath);
	const baseName = path.basename(safe.fullPath);
	const currentlyHidden = baseName.startsWith("!");
	const targetHidden = typeof forceHidden === "boolean" ? forceHidden : !currentlyHidden;
	const newBaseName = targetHidden
		? (currentlyHidden ? baseName : `!${baseName}`)
		: (currentlyHidden ? baseName.substring(1) : baseName);

	const newFullPath = path.join(parentDir, newBaseName);
	const newRelPath = path.relative(path.resolve(uploadDir), newFullPath).split(path.sep).join("/");

	if (newFullPath !== safe.fullPath) {
		try {
			fs.renameSync(safe.fullPath, newFullPath);
			const favs = loadFavorites();
			if (favs.has(safe.relPath)) {
				favs.delete(safe.relPath);
				favs.add(newRelPath);
				saveFavorites(favs);
			}
		} catch (e) {
			console.error(`Failed to rename photo: ${safe.fullPath}`, e);
			return null;
		}
	}

	return {
		oldRelPath: safe.relPath,
		newRelPath,
		fileName: newBaseName,
		displayName: targetHidden ? newBaseName.substring(1) : newBaseName,
		isHidden: targetHidden
	};
}

function deletePhotoByRelPath(uploadDir, relPath) {
	const safe = resolveSafeUploadPath(uploadDir, relPath);
	if (!safe || !fs.existsSync(safe.fullPath)) return false;
	try {
		fs.unlinkSync(safe.fullPath);
		const favs = loadFavorites();
		if (favs.delete(safe.relPath)) saveFavorites(favs);
		console.log(`🗑️ File deleted: ${safe.fullPath}`);
		return true;
	} catch (e) {
		console.error("Failed to delete photo:", e);
		return false;
	}
}

const PY_ROTATE_SCRIPT = `
import os, sys
from PIL import Image, ImageOps

src = sys.argv[1]
angle = int(sys.argv[2])
tmp = src + ".rot.tmp"
ext = os.path.splitext(src)[1].lower()

with Image.open(src) as im:
    exif = im.getexif()
    im = ImageOps.exif_transpose(im)
    # PIL rotate is CCW; angle=90 means 90deg clockwise -> -90
    rotated = im.rotate(-angle, expand=True)
    if exif:
        # Reset EXIF orientation tag (274) to 1 since pixels are now rotated
        exif[274] = 1
    save_kwargs = {}
    if ext in (".jpg", ".jpeg"):
        if rotated.mode not in ("RGB", "L"):
            rotated = rotated.convert("RGB")
        save_kwargs = {"format": "JPEG", "quality": 93, "subsampling": 0}
        if exif:
            save_kwargs["exif"] = exif.tobytes()
    elif ext == ".png":
        save_kwargs = {"format": "PNG", "optimize": True}
    elif ext == ".webp":
        save_kwargs = {"format": "WEBP", "quality": 92}
    else:
        raise ValueError("Unsupported format for rotation: " + ext)
    rotated.save(tmp, **save_kwargs)

os.replace(tmp, src)
print("OK")
`;

function rotatePhotoByRelPath(uploadDir, relPath, angle = 90) {
	return new Promise((resolve, reject) => {
		const safe = resolveSafeUploadPath(uploadDir, relPath);
		if (!safe || !fs.existsSync(safe.fullPath)) {
			return reject(new Error("파일을 찾을 수 없습니다."));
		}
		const ext = path.extname(safe.fullPath).toLowerCase();
		if (!ROTATABLE_EXTS.includes(ext)) {
			return reject(new Error("JPG, PNG, WebP 이미지 파일만 회전할 수 있습니다."));
		}
		const normalizedAngle = Number(angle) === -90 || Number(angle) === 270 ? -90 : 90;
		execFile("python3", ["-c", PY_ROTATE_SCRIPT, safe.fullPath, String(normalizedAngle)], { timeout: 20000 }, (err, stdout, stderr) => {
			if (err) {
				return reject(new Error((stderr || err.message || "회전 실패").trim()));
			}
			resolve({ relPath: safe.relPath, angle: normalizedAngle });
		});
	});
}

function togglePhotoVisibility(uploadDir, folderName, fileName) {
	if (!folderName || !fileName) return;
	const rel = path.join(folderName, fileName).split(path.sep).join("/");
	togglePhotoByRelPath(uploadDir, rel);
}

function deletePhoto(uploadDir, folderName, fileName) {
	if (!folderName || !fileName) return;
	const rel = path.join(folderName, fileName).split(path.sep).join("/");
	deletePhotoByRelPath(uploadDir, rel);
}

function deleteAllPhotosInFolder(uploadDir, folderName) {
	const safe = resolveSafeUploadPath(uploadDir, folderName);
	if (!safe || !fs.existsSync(safe.fullPath)) return;

	const files = fs.readdirSync(safe.fullPath);
	files.forEach((file) => {
		const filePath = path.join(safe.fullPath, file);
		if (MEDIA_EXTS.includes(path.extname(file).toLowerCase())) {
			try {
				fs.unlinkSync(filePath);
			} catch (e) {
				console.error(`Failed to delete photo: ${filePath}`, e);
			}
		}
	});
}

function renameAllPhotosInFolder(folderPath, showAll) {
	if (!fs.existsSync(folderPath)) return;
	const files = fs.readdirSync(folderPath);
	files.forEach((file) => {
		const oldPath = path.join(folderPath, file);
		try {
			if (fs.statSync(oldPath).isFile()) {
				const isHidden = file.startsWith("!");
				let newFile = file;
				if (showAll && isHidden) newFile = file.substring(1);
				else if (!showAll && !isHidden) newFile = "!" + file;
				if (newFile !== file) {
					fs.renameSync(oldPath, path.join(folderPath, newFile));
				}
			}
		} catch (e) {
			console.error(`Failed to process file ${oldPath}:`, e);
		}
	});
}

module.exports = {
	normalizeRelPath,
	resolveSafeUploadPath,
	getDirectories,
	getSubdirectories,
	toggleFolderVisibility,
	renameAllDirectories,
	deleteFolder,
	getMediaFiles,
	getAllMediaFiles,
	togglePhotoVisibility,
	togglePhotoByRelPath,
	deletePhoto,
	deletePhotoByRelPath,
	rotatePhotoByRelPath,
	deleteAllPhotosInFolder,
	renameAllPhotosInFolder,
	loadFavorites,
	toggleFavoritePath,
	setFavoritePath
};
