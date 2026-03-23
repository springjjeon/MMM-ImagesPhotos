const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const port = 8999; // 스마트폰에서 접속할 포트 번호 (MagicMirror 기본 포트와 충돌 방지를 위해 8999로 변경)

app.use(express.urlencoded({ extended: true })); // 폼 데이터 파싱을 위해 추가

// 사진이 저장될 폴더 지정 (원하는 폴더명으로 변경 가능, 예: 'uploads/Mobile')
const baseFolderName = 'uploads'; 
const uploadDir = path.join(__dirname, baseFolderName);

// 정적 파일 제공 (웹 브라우저에서 사진을 볼 수 있도록 설정)
app.use('/uploads', express.static(uploadDir));

const subFolderName = 'mobileUpload'; // 스마트폰에서 올린 사진이 모일 하위 폴더
const targetUploadDir = path.join(uploadDir, subFolderName);

// 업로드할 폴더가 없으면 자동으로 생성하여 파일이 한 폴더에 모이도록 보장
if (!fs.existsSync(targetUploadDir)) {
    fs.mkdirSync(targetUploadDir, { recursive: true });
    console.log(`✅ [${baseFolderName}/${subFolderName}] 폴더가 생성되었습니다.`);
}

// 파일 업로드 설정 (파일명 안 겹치게 현재 시간 추가)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, targetUploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '_' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 스마트폰에서 접속할 때 보여줄 웹페이지 (모바일 친화적 디자인)
app.get('/', (req, res) => {
    // 업로드 폴더 내의 하위 폴더 목록 읽기 (재귀 탐색)
    function getDirectories(dir, relativePath = '') {
        let results = [];
        if (!fs.existsSync(dir)) return results;
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
                results.push(itemRelativePath);
                results = results.concat(getDirectories(fullPath, itemRelativePath));
            }
        }
        return results;
    }

    const folders = getDirectories(uploadDir);

    // 폴더 관리 UI HTML 조립
    let folderListHtml = '';
    if (folders.length > 0) {
        folderListHtml = `
            <div class="container" style="margin-top: 20px;">
                <h2>📁 사진 폴더 관리</h2>
                <p style="color: #666; font-size: 14px;">폴더별로 매직미러에 표시할지 설정하세요.</p>
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <form action="/show-all-folders" method="post" style="margin: 0; flex: 1;">
                        <button type="submit" style="padding: 10px; font-size: 14px; background: #4CAF50; color: white; border: none; border-radius: 5px; width: 100%; cursor: pointer;">전체 보이기 👁️</button>
                    </form>
                    <form action="/hide-all-folders" method="post" style="margin: 0; flex: 1;">
                        <button type="submit" style="padding: 10px; font-size: 14px; background: #ff9800; color: white; border: none; border-radius: 5px; width: 100%; cursor: pointer;">전체 숨기기 🙈</button>
                    </form>
                </div>
                <ul style="list-style: none; padding: 0; text-align: left;">
                    ${folders.map(folder => {
                        const baseName = path.basename(folder);
                        const isHidden = baseName.startsWith('!'); 
                        const displayName = folder.replace(/!/g, '').split(path.sep).join(' / ');
                        return `
                            <li style="padding: 15px 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 16px; ${isHidden ? 'color: #aaa; text-decoration: line-through;' : 'font-weight: bold; color: #333;'}">
                                    ${isHidden ? '🙈' : '👁️'} ${displayName}
                                </span>
                                <div style="display: flex; gap: 5px;">
                                    <form action="/manage-photos" method="get" style="margin: 0;">
                                        <input type="hidden" name="folderName" value="${folder}">
                                        <button type="submit" style="padding: 8px 10px; font-size: 14px; background: #007BFF; color: white; border: none; border-radius: 5px; cursor: pointer;">
                                            사진 관리 🖼️
                                        </button>
                                    </form>
                                    <form action="/toggle-folder" method="post" style="margin: 0;">
                                        <input type="hidden" name="folderName" value="${folder}">
                                        <button type="submit" style="padding: 8px 10px; font-size: 14px; background: ${isHidden ? '#4CAF50' : '#ff9800'}; color: white; border: none; border-radius: 5px; width: auto; cursor: pointer;">
                                            ${isHidden ? '보이기' : '숨기기'}
                                        </button>
                                    </form>
                                </div>
                            </li>
                        `;
                    }).join('')}
                </ul>
            </div>
        `;
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>매직미러 사진 올리기</title>
            <style>
                body { font-family: 'Malgun Gothic', sans-serif; text-align: center; padding: 20px; background-color: #f4f4f9; }
                .container { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
                h2 { color: #333; margin-bottom: 20px; margin-top: 0; }
                input[type="file"] { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 5px; width: 80%; background: #fafafa; }
                button { padding: 15px 30px; font-size: 18px; background: #007BFF; color: white; border: none; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; }
                button:active { background: #0056b3; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>📸 매직미러 사진 올리기</h2>
                <form action="/upload" method="post" enctype="multipart/form-data">
                    <p style="color: #666; font-size: 14px;">한 번에 여러 장을 선택할 수 있습니다.</p>
                    <input type="file" name="photos" accept="image/*" multiple required>
                    <button type="submit">전송하기 🚀</button>
                </form>
            </div>
            ${folderListHtml}
        </body>
        </html>
    `);
});

// 업로드 버튼을 눌렀을 때 처리하는 로직
app.post('/upload', upload.array('photos', 50), (req, res) => {
    // 업로드 직후, 이전에 만들었던 한글/공백 정리 파이썬 스크립트 실행
    exec('python3 clean_names.py', (error, stdout, stderr) => {
        // 스크립트 실행 후 매직미러를 즉시 리프레시하기 위해 PM2 재시작 명령 실행
        exec('pm2 restart MagicMirror || pm2 restart mm', (pm2Error) => {
            res.send(`
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <div style="text-align:center; padding:50px; font-family: sans-serif;">
                    <h1 style="color: #4CAF50;">✅ 업로드 성공!</h1>
                    <p>사진이 성공적으로 전송되었습니다.</p>
                    <p>매직미러 화면을 새로고침(재시작) 하고 있습니다... 🔄</p>
                    <br>
                    <a href="/" style="padding: 15px 30px; background: #333; color: white; text-decoration: none; border-radius: 10px; display: inline-block;">새로 올리기</a>
                </div>
            `);
        });
    });
});

// 폴더 보이기/숨기기 상태 변경 로직
app.post('/toggle-folder', (req, res) => {
    const { folderName } = req.body;
    if (!folderName) return res.redirect('/');

    const oldPath = path.join(uploadDir, folderName);
    if (!fs.existsSync(oldPath)) return res.redirect('/');

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);

    let newBaseName = baseName;
    if (baseName.startsWith('!')) {
        newBaseName = baseName.substring(1); // 숨김 기호 제거 (보이기)
    } else {
        newBaseName = '!' + baseName; // 숨김 기호 추가 (숨기기)
    }
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error('폴더명 변경 실패:', e);
    }

    // 이름 변경 후 매직미러 리프레시하여 즉시 반영
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 하위 폴더까지 일괄 보이기/숨기기를 위한 재귀 함수
function renameAllDirectories(dirPath, showAll) {
    if (!fs.existsSync(dirPath)) return;
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
        const fullPath = path.join(dirPath, item);
        if (fs.statSync(fullPath).isDirectory()) {
            // 하위 폴더 먼저 처리 (자식 폴더명 변경이 부모 경로에 영향을 주지 않도록)
            renameAllDirectories(fullPath, showAll);
            
            const isHidden = item.startsWith('!');
            let newItem = item;
            if (showAll && isHidden) {
                newItem = item.substring(1);
            } else if (!showAll && !isHidden) {
                newItem = '!' + item;
            }
            
            if (newItem !== item) {
                try { fs.renameSync(fullPath, path.join(dirPath, newItem)); } 
                catch (e) { console.error('폴더명 일괄 변경 실패:', e); }
            }
        }
    }
}

// 전체 보이기 로직
app.post('/show-all-folders', (req, res) => {
    renameAllDirectories(uploadDir, true);
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 전체 숨기기 로직
app.post('/hide-all-folders', (req, res) => {
    renameAllDirectories(uploadDir, false);
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 특정 폴더의 사진 목록 보기 라우트
app.get('/manage-photos', (req, res) => {
    const folderName = req.query.folderName;
    if (!folderName) return res.redirect('/');

    const folderPath = path.join(uploadDir, folderName);
    if (!fs.existsSync(folderPath)) return res.redirect('/');

    const files = fs.readdirSync(folderPath);
    const imageFiles = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });

    let photoListHtml = imageFiles.map(file => {
        const isHidden = file.startsWith('!');
        const displayName = isHidden ? file.substring(1) : file;

        // URL 생성 시 폴더명과 파일명을 각각 인코딩 처리
        const encodedFolder = folderName.split(path.sep).map(p => encodeURIComponent(p)).join('/');
        const encodedFile = encodeURIComponent(file);
        const imageUrl = `/uploads/${encodedFolder}/${encodedFile}`;
        return `
            <div style="display:inline-block; margin: 10px; border: 1px solid #ccc; padding: 10px; border-radius: 10px; background: ${isHidden ? '#f0f0f0' : '#fff'}; width: 160px; vertical-align: top; box-sizing: border-box; opacity: ${isHidden ? '0.6' : '1'};">
                <img src="${imageUrl}" style="width: 100%; height: 130px; object-fit: cover; border-radius: 5px; display: block; margin-bottom: 10px;">
                <p style="font-size: 12px; color: #666; word-break: break-all; margin: 0 0 10px 0; height: 2.8em; overflow: hidden; text-align: center; text-decoration: ${isHidden ? 'line-through' : 'none'};">
                    ${isHidden ? '🙈 ' : ''}${displayName}
                </p>
                <div style="display: flex; gap: 5px;">
                    <form action="/toggle-photo" method="post" style="flex: 1; margin: 0;">
                        <input type="hidden" name="folderName" value="${folderName}">
                        <input type="hidden" name="fileName" value="${file}">
                        <button type="submit" style="width: 100%; padding: 8px 0; background: ${isHidden ? '#4CAF50' : '#ff9800'}; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 12px;">${isHidden ? '보이기' : '숨기기'}</button>
                    </form>
                    <form action="/delete-photo" method="post" onsubmit="return confirm('정말 이 사진을 삭제하시겠습니까?');" style="flex: 1; margin: 0;">
                        <input type="hidden" name="folderName" value="${folderName}">
                        <input type="hidden" name="fileName" value="${file}">
                        <button type="submit" style="width: 100%; padding: 8px 0; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; font-size: 12px;">삭제 🗑️</button>
                    </form>
                </div>
            </div>
        `;
    }).join('');

    if (imageFiles.length === 0) {
        photoListHtml = '<p style="color: #666; padding: 20px; font-size: 16px;">이 폴더에는 사진이 없습니다.</p>';
    }

    const displayName = folderName.replace(/!/g, '').split(path.sep).join(' / ');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>[${displayName}] 사진 관리</title>
            <style>
                body { font-family: 'Malgun Gothic', sans-serif; text-align: center; padding: 20px; background-color: #f4f4f9; }
                .container { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); max-width: 800px; margin: auto; }
                h2 { color: #333; margin-bottom: 20px; margin-top: 0; word-break: break-all; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🖼️ [${displayName}] 사진 관리</h2>
                <a href="/" style="display: inline-block; margin-bottom: 20px; padding: 10px 20px; background: #6c757d; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">⬅️ 뒤로 가기</a>
                <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;">
                    ${photoListHtml}
                </div>
            </div>
        </body>
        </html>
    `);
});

// 사진 삭제 라우트
app.post('/delete-photo', (req, res) => {
    const { folderName, fileName } = req.body;
    if (!folderName || !fileName) return res.redirect('/');

    const filePath = path.join(uploadDir, folderName, fileName);
    
    // 경로 조작 방지를 위한 보안 확인 및 파일 존재 여부 확인
    if (filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`🗑️ 파일 삭제됨: ${filePath}`);
        } catch (e) {
            console.error('사진 삭제 실패:', e);
        }
    }

    // 삭제 후 화면 즉시 반영을 위해 매직미러 재시작
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));
    });
});

// 사진 보이기/숨기기 라우트
app.post('/toggle-photo', (req, res) => {
    const { folderName, fileName } = req.body;
    if (!folderName || !fileName) return res.redirect('/');

    const oldPath = path.join(uploadDir, folderName, fileName);
    if (!fs.existsSync(oldPath)) return res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));

    const parentDir = path.dirname(oldPath);
    const baseName = path.basename(oldPath);

    let newBaseName = baseName;
    if (baseName.startsWith('!')) {
        newBaseName = baseName.substring(1); // 숨김 기호 제거 (보이기)
    } else {
        newBaseName = '!' + baseName; // 숨김 기호 추가 (숨기기)
    }
    const newPath = path.join(parentDir, newBaseName);

    try {
        fs.renameSync(oldPath, newPath);
    } catch (e) {
        console.error('사진 상태 변경 실패:', e);
    }

    // 이름 변경 후 매직미러 재시작 (화면에 즉시 반영)
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/manage-photos?folderName=' + encodeURIComponent(folderName));
    });
});

app.listen(port, () => {
    console.log(`✅ 업로드 서버가 ${port} 포트에서 실행 중입니다.`);
});
