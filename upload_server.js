const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const port = 8999; // 스마트폰에서 접속할 포트 번호 (MagicMirror 기본 포트와 충돌 방지를 위해 8999로 변경)

// 사진이 저장될 폴더 지정 (원하는 폴더명으로 변경 가능, 예: 'uploads/Mobile')
const targetFolderName = 'uploads'; 
const uploadDir = path.join(__dirname, targetFolderName);

// 업로드할 폴더가 없으면 자동으로 생성하여 파일이 한 폴더에 모이도록 보장
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`✅ [${targetFolderName}] 폴더가 생성되었습니다.`);
}

// 파일 업로드 설정 (파일명 안 겹치게 현재 시간 추가)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '_' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// 스마트폰에서 접속할 때 보여줄 웹페이지 (모바일 친화적 디자인)
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>매직미러 사진 올리기</title>
            <style>
                body { font-family: 'Malgun Gothic', sans-serif; text-align: center; padding: 20px; background-color: #f4f4f9; }
                .container { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
                h2 { color: #333; margin-bottom: 20px; }
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

app.listen(port, () => {
    console.log(`✅ 업로드 서버가 ${port} 포트에서 실행 중입니다.`);
});
