const fs = require("fs");
const path = require("path");
const fsAsync = require("fs").promises;
const exifParser = require("exif-parser");

const CACHE_DIR = path.join(__dirname, "..", "..", ".cache");
const DATE_CACHE_FILE = path.join(CACHE_DIR, "exif-date-cache.json");
const FAVORITES_FILE = path.join(CACHE_DIR, "favorites.json");

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

function toggleFavoritePath(relPath) {
	const favs = loadFavorites();
	let isFavorite;
	if (favs.has(relPath)) {
		favs.delete(relPath);
		isFavorite = false;
	} else {
		favs.add(relPath);
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
	if (!folderName) return;
	const oldPath = path.join(uploadDir, folderName);
	if (!fs.existsSync(oldPath)) return;

	const parentDir = path.dirname(oldPath);
	const baseName = path.basename(oldPath);
	const newBaseName = baseName.startsWith("!") ? baseName.substring(1) : `!${baseName}`;
	const newPath = path.join(parentDir, newBaseName);

	try {
		fs.renameSync(oldPath, newPath);
	} catch (e) {
		console.error(`Failed to rename folder: ${oldPath}`, e);
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
	const folderPath = path.join(uploadDir, folderName);
	if (path.resolve(folderPath).startsWith(path.resolve(uploadDir) + path.sep) && fs.existsSync(folderPath)) {
		try {
			fs.rmSync(folderPath, { recursive: true, force: true });
			console.log(`🗑️ Folder deleted: ${folderPath}`);
		} catch (e) {
			console.error("Failed to delete folder:", e);
		}
	}
}

// --- Media File Operations ---

function getMediaFiles(folderPath, sortBy = "exif_desc", uploadDir = null) {
	if (!fs.existsSync(folderPath)) return [];

	const dateCache = loadDateCache();
	const favSet = loadFavorites();
	const baseRoot = uploadDir || path.join(__dirname, "..", "..", "uploads");
	const files = fs.readdirSync(folderPath);
	const mediaExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".ogg", ".mov"];

	const mediaFiles = files
		.map((file) => {
			const filePath = path.join(folderPath, file);
			try {
				const stats = fs.statSync(filePath);
				if (!stats.isFile()) return null;
				const ext = path.extname(file).toLowerCase();
				if (!mediaExts.includes(ext)) return null;

				const relPath = path.relative(baseRoot, filePath).split(path.sep).join("/");
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
					birthtime: stats.birthtime,
					takenAt,
					dateLabel,
					isFavorite: favSet.has(relPath),
					isFile: true
				};
			} catch (e) {
				console.error(`Failed to stat file ${file}:`, e);
				return null;
			}
		})
		.filter(Boolean);

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

function togglePhotoVisibility(uploadDir, folderName, fileName) {
	if (!folderName || !fileName) return;
	const oldPath = path.join(uploadDir, folderName, fileName);
	if (!fs.existsSync(oldPath)) return;

	const parentDir = path.dirname(oldPath);
	const baseName = path.basename(oldPath);
	const newBaseName = baseName.startsWith("!") ? baseName.substring(1) : `!${baseName}`;
	const newPath = path.join(parentDir, newBaseName);

	try {
		fs.renameSync(oldPath, newPath);
	} catch (e) {
		console.error(`Failed to rename photo: ${oldPath}`, e);
	}
}

function deletePhoto(uploadDir, folderName, fileName) {
	if (!folderName || !fileName) return;
	const filePath = path.join(uploadDir, folderName, fileName);
	if (path.resolve(filePath).startsWith(path.resolve(uploadDir) + path.sep) && fs.existsSync(filePath)) {
		try {
			fs.unlinkSync(filePath);
			console.log(`🗑️ File deleted: ${filePath}`);
		} catch (e) {
			console.error("Failed to delete photo:", e);
		}
	}
}

function deleteAllPhotosInFolder(uploadDir, folderName) {
	const folderPath = path.join(uploadDir, folderName);
	if (!path.resolve(folderPath).startsWith(path.resolve(uploadDir) + path.sep) || !fs.existsSync(folderPath)) return;

	const files = fs.readdirSync(folderPath);
	const mediaExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".ogg", ".mov"];
	files.forEach((file) => {
		const filePath = path.join(folderPath, file);
		if (mediaExtensions.includes(path.extname(file).toLowerCase())) {
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
	getDirectories,
	getSubdirectories,
	toggleFolderVisibility,
	renameAllDirectories,
	deleteFolder,
	getMediaFiles,
	togglePhotoVisibility,
	deletePhoto,
	deleteAllPhotosInFolder,
	renameAllPhotosInFolder,
	loadFavorites,
	toggleFavoritePath
};
