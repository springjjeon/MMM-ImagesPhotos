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
    // 업로드 폴더 내의 하위 폴더 목록 읽기
    let folders = [];
    if (fs.existsSync(uploadDir)) {
        folders = fs.readdirSync(uploadDir).filter(file => {
            return fs.statSync(path.join(uploadDir, file)).isDirectory();
        });
    }

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
                        const isHidden = folder.startsWith('!'); // '!'로 시작하면 숨겨진 폴더
                        const displayName = isHidden ? folder.substring(1) : folder;
                        return `
                            <li style="padding: 15px 10px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 16px; ${isHidden ? 'color: #aaa; text-decoration: line-through;' : 'font-weight: bold; color: #333;'}">
                                    ${isHidden ? '🙈' : '👁️'} ${displayName}
                                </span>
                                <form action="/toggle-folder" method="post" style="margin: 0;">
                                    <input type="hidden" name="folderName" value="${folder}">
                                    <button type="submit" style="padding: 8px 15px; font-size: 14px; background: ${isHidden ? '#4CAF50' : '#ff9800'}; color: white; border: none; border-radius: 5px; width: auto; cursor: pointer;">
                                        ${isHidden ? '보이기' : '숨기기'}
                                    </button>
                                </form>
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

    let newFolderName = folderName;
    if (folderName.startsWith('!')) {
        newFolderName = folderName.substring(1); // 숨김 기호 제거 (보이기)
    } else {
        newFolderName = '!' + folderName; // 숨김 기호 추가 (숨기기)
    }
    const newPath = path.join(uploadDir, newFolderName);

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

// 전체 보이기 로직
app.post('/show-all-folders', (req, res) => {
    if (fs.existsSync(uploadDir)) {
        const folders = fs.readdirSync(uploadDir).filter(file => fs.statSync(path.join(uploadDir, file)).isDirectory());
        folders.forEach(folder => {
            if (folder.startsWith('!')) {
                const oldPath = path.join(uploadDir, folder);
                const newPath = path.join(uploadDir, folder.substring(1));
                try { fs.renameSync(oldPath, newPath); } catch (e) { console.error('폴더명 변경 실패:', e); }
            }
        });
    }
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

// 전체 숨기기 로직
app.post('/hide-all-folders', (req, res) => {
    if (fs.existsSync(uploadDir)) {
        const folders = fs.readdirSync(uploadDir).filter(file => fs.statSync(path.join(uploadDir, file)).isDirectory());
        folders.forEach(folder => {
            if (!folder.startsWith('!')) {
                const oldPath = path.join(uploadDir, folder);
                const newPath = path.join(uploadDir, '!' + folder);
                try { fs.renameSync(oldPath, newPath); } catch (e) { console.error('폴더명 변경 실패:', e); }
            }
        });
    }
    exec('pm2 restart MagicMirror || pm2 restart mm', () => {
        res.redirect('/');
    });
});

app.listen(port, () => {
    console.log(`✅ 업로드 서버가 ${port} 포트에서 실행 중입니다.`);
});
