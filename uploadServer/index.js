const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");

const { getOrCreateThumbnail } = require("./lib/thumb-utils");
const createMainRouter = require("./routes/main");
const createManagementRouter = require("./routes/management");

const app = express();
const port = process.env.UPLOAD_PORT || 8999;

// --- Folder and Path Setup ---
let baseFolderName = "uploads";
let uploadDir = path.join(__dirname, "..", baseFolderName);

if (process.env.UPLOAD_DIR) {
	uploadDir = path.isAbsolute(process.env.UPLOAD_DIR)
		? process.env.UPLOAD_DIR
		: path.join(__dirname, "..", process.env.UPLOAD_DIR);
	baseFolderName = path.basename(uploadDir);
	console.log(`✅ Using upload directory from UPLOAD_DIR env: ${uploadDir}`);
} else if (fs.existsSync(path.join(__dirname, "config.json"))) {
	try {
		const config = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
		if (config.uploadDir) {
			uploadDir = path.isAbsolute(config.uploadDir)
				? config.uploadDir
				: path.join(__dirname, "..", config.uploadDir);
			baseFolderName = path.basename(uploadDir);
			console.log(`✅ Using upload directory from config.json: ${uploadDir}`);
		}
	} catch (err) {
		console.warn(`⚠️ Error reading config.json: ${err.message}, using default`);
	}
}

const subFolderName = "mobileUpload";
const hiddenSubFolderName = "!" + subFolderName;

let baseMobileUploadDir = path.join(uploadDir, subFolderName);
const baseMobileUploadDirHidden = path.join(uploadDir, hiddenSubFolderName);
if (!fs.existsSync(baseMobileUploadDir) && fs.existsSync(baseMobileUploadDirHidden)) {
	baseMobileUploadDir = baseMobileUploadDirHidden;
}

if (!fs.existsSync(baseMobileUploadDir)) {
	fs.mkdirSync(baseMobileUploadDir, { recursive: true });
	console.log(`✅ Default mobile upload folder created at [${path.basename(baseMobileUploadDir)}]`);
}

// --- Multer Configuration ---
const tempUploadDir = path.join(__dirname, "..", ".temp-uploads");

function initTempUploadDir() {
	try {
		if (!fs.existsSync(tempUploadDir)) {
			fs.mkdirSync(tempUploadDir, { recursive: true });
			return;
		}
		const files = fs.readdirSync(tempUploadDir);
		let cleanedCount = 0;
		files.forEach((file) => {
			try {
				const filePath = path.join(tempUploadDir, file);
				const stat = fs.lstatSync(filePath);
				if (stat.isFile() || stat.isSymbolicLink()) {
					fs.unlinkSync(filePath);
					cleanedCount++;
				} else if (stat.isDirectory()) {
					fs.rmSync(filePath, { recursive: true, force: true });
					cleanedCount++;
				}
			} catch (err) {
				console.warn(`⚠️ Failed to delete temp item ${file}: ${err.message}`);
			}
		});
		if (cleanedCount > 0) {
			console.log(`🧹 Cleaned ${cleanedCount} old temp file(s)`);
		}
	} catch (err) {
		console.error(`⚠️ Error initializing temp folder: ${err.message}`);
	}
}

initTempUploadDir();

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		if (!fs.existsSync(tempUploadDir)) {
			fs.mkdirSync(tempUploadDir, { recursive: true });
		}
		cb(null, tempUploadDir);
	},
	filename: (req, file, cb) => {
		const originalName = Buffer.from(file.originalname, "latin1").toString("utf8");
		const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
		const uniqueSuffix = Date.now() + "_" + Math.random().toString(36).substring(2, 7);
		cb(null, `${uniqueSuffix}_${safeName}`);
	}
});

const upload = multer({
	storage,
	limits: { fileSize: 500 * 1024 * 1024 }
});

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

// --- Local QR Code Endpoint (Offline-Safe) ---
app.get("/qr", async (req, res) => {
	const data = (req.query.data || "").toString().trim();
	const fallbackUrl = `http://${req.headers.host || `127.0.0.1:${port}`}`;
	const target = data || fallbackUrl;
	try {
		const pngBuffer = await QRCode.toBuffer(target, {
			type: "png",
			width: 220,
			margin: 1,
			errorCorrectionLevel: "M"
		});
		res.setHeader("Content-Type", "image/png");
		res.setHeader("Cache-Control", "public, max-age=86400");
		res.send(pngBuffer);
	} catch (err) {
		console.error("[UploadServer] QR generation error:", err.message);
		res.status(500).send("QR Error");
	}
});

// --- Cached 360px Thumbnail Endpoint ---
app.use("/thumb", async (req, res) => {
	try {
		const relPath = decodeURIComponent((req.path || "").replace(/^\/+/, ""));
		if (!relPath) return res.status(400).send("Missing path");
		const thumbPath = await getOrCreateThumbnail(uploadDir, relPath);
		res.setHeader("Cache-Control", "public, max-age=86400");
		res.sendFile(thumbPath);
	} catch (err) {
		const relPath = decodeURIComponent((req.path || "").replace(/^\/+/, ""));
		const origPath = path.resolve(uploadDir, relPath);
		if (origPath.startsWith(path.resolve(uploadDir) + path.sep) && fs.existsSync(origPath)) {
			return res.sendFile(origPath);
		}
		res.status(404).send("Not found");
	}
});

// --- Routers ---
const mainRouter = createMainRouter(uploadDir, upload, tempUploadDir);
const managementRouter = createManagementRouter(uploadDir);

app.use("/", mainRouter);
app.use("/manage", managementRouter);

// --- Server Start ---
app.listen(port, () => {
	console.log(`✅ Upload server is running on port ${port}.`);
});
