
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const createMainRouter = require('./routes/main');
const createManagementRouter = require('./routes/management');

const app = express();
const port = process.env.UPLOAD_PORT || 8999;

// --- Folder and Path Setup ---
// 1. 환경 변수로 설정된 폴더 경로 사용
// 2. config.json 파일에 설정된 경로 사용
// 3. 기본값: '../uploads'
let baseFolderName = 'uploads';
let uploadDir = path.join(__dirname, '..', baseFolderName);

// 환경 변수 확인
if (process.env.UPLOAD_DIR) {
    uploadDir = path.isAbsolute(process.env.UPLOAD_DIR) 
        ? process.env.UPLOAD_DIR 
        : path.join(__dirname, '..', process.env.UPLOAD_DIR);
    baseFolderName = path.basename(uploadDir);
    console.log(`✅ Using upload directory from UPLOAD_DIR env: ${uploadDir}`);
}
// config.json 파일 확인
else if (fs.existsSync(path.join(__dirname, 'config.json'))) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
        if (config.uploadDir) {
            uploadDir = path.isAbsolute(config.uploadDir) 
                ? config.uploadDir 
                : path.join(__dirname, '..', config.uploadDir);
            baseFolderName = path.basename(uploadDir);
            console.log(`✅ Using upload directory from config.json: ${uploadDir}`);
        }
    } catch (err) {
        console.warn(`⚠️ Error reading config.json: ${err.message}, using default`);
    }
}
const subFolderName = 'mobileUpload';
const hiddenSubFolderName = '!' + subFolderName;

// Determine the mobile upload directory, preferring the hidden one if it exists.
let baseMobileUploadDir = path.join(uploadDir, subFolderName);
const baseMobileUploadDirHidden = path.join(uploadDir, hiddenSubFolderName);
if (!fs.existsSync(baseMobileUploadDir) && fs.existsSync(baseMobileUploadDirHidden)) {
    baseMobileUploadDir = baseMobileUploadDirHidden;
}

// Create the base mobile upload directory if it doesn't exist.
if (!fs.existsSync(baseMobileUploadDir)) {
    fs.mkdirSync(baseMobileUploadDir, { recursive: true });
    console.log(`✅ Default mobile upload folder created at [${path.basename(baseMobileUploadDir)}]`);
}

// --- Multer Configuration ---
// 임시 저장소: 나중에 사용자 선택 폴더로 이동
const tempUploadDir = path.join(__dirname, '..', '.temp-uploads');

// 임시 폴더 정리 함수 (시작 시 이전 파일 삭제)
function initTempUploadDir() {
    try {
        // 폴더가 없으면 생성
        if (!fs.existsSync(tempUploadDir)) {
            fs.mkdirSync(tempUploadDir, { recursive: true });
            console.log(`✅ Temp upload folder created at: ${tempUploadDir}`);
            return; // 새로 생성한 폴더는 정리할 파일이 없으므로 반환
        }
        
        // 폴더가 있으면 이전 임시 파일 정리
        try {
            const files = fs.readdirSync(tempUploadDir);
            let cleanedCount = 0;
            
            files.forEach(file => {
                try {
                    const filePath = path.join(tempUploadDir, file);
                    const stat = fs.lstatSync(filePath); // 심볼릭 링크 처리를 위해 lstatSync 사용
                    
                    if (stat.isFile() || stat.isSymbolicLink()) {
                        fs.unlinkSync(filePath);
                        cleanedCount++;
                    } else if (stat.isDirectory()) {
                        // 폴더도 재귀적으로 삭제
                        fs.rmSync(filePath, { recursive: true, force: true });
                        cleanedCount++;
                    }
                } catch (err) {
                    console.warn(`⚠️  Failed to remove temp item: ${file}`, err.message);
                }
            });
            
            if (cleanedCount > 0) {
                console.log(`✅ Cleaned up ${cleanedCount} old temporary file(s)`);
            }
        } catch (readErr) {
            console.warn(`⚠️  Failed to read temp directory: ${readErr.message}`);
        }
    } catch (err) {
        console.warn(`⚠️  Failed to initialize temp folder: ${err.message}`);
        // 폴더 초기화 실패는 무시하고 계속 진행
    }
}

// 서버 시작 시 임시 폴더 초기화
initTempUploadDir();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // 모든 파일을 임시 디렉토리로 저장
        // 업로드 시마다 임시 폴더가 존재하는지 확인하고 없으면 생성
        try {
            if (!fs.existsSync(tempUploadDir)) {
                fs.mkdirSync(tempUploadDir, { recursive: true });
            }
            cb(null, tempUploadDir);
        } catch (err) {
            console.error('❌ Failed to create temp upload directory:', err);
            cb(err);
        }
    },
    filename: function (req, file, cb) {
        // 중복 방지를 위해 타임스탬프 추가
        const uniqueName = Date.now() + '_' + Math.random().toString(36).substring(7) + '_' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB
    }
});

// --- Express App Setup ---
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically.
app.use('/uploads', express.static(uploadDir));

// --- Routers ---
const mainRouter = createMainRouter(uploadDir, upload, tempUploadDir);
const managementRouter = createManagementRouter(uploadDir);

app.use('/', mainRouter);
app.use('/manage', managementRouter);

// --- Server Start ---
app.listen(port, () => {
    console.log(`✅ Upload server is running on port ${port}.`);
});
